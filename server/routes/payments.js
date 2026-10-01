const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { recomputeBookingStatus } = require('../services/paymentStatusService');

// GET /api/payments/pending
router.get('/pending', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.*, b.check_in_date, b.check_out_date, b.total_amount as booking_total,
             g.name as guest_name, g.whatsapp as guest_whatsapp, u.name as unit_name
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.property_id = $1
        AND p.status = 'pending'
        AND p.amount > 0
        AND b.status NOT IN ('cancelled','no_show')
      ORDER BY b.check_in_date, p.type
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments
router.post('/', auth, async (req, res) => {
  const { booking_id, type, amount, method, notes } = req.body;
  if (!booking_id || !type || !amount) return res.status(400).json({ error: 'booking_id, type, amount required' });
  try {
    const { rows: [booking] } = await db.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [booking_id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const { rows } = await db.query(
      `INSERT INTO payments (booking_id, type, amount, method, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [booking_id, type, amount, method, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');

// Changing a pending room line's amount only moves money between the room's
// pending lines — they always add up to what is still unpaid of the booking's
// price. (It used to change the one line on its own, which looked like a price
// change but left the price, the bill and every document as they were.)
// Returns { error, status } or { note }.
async function resplitPendingLine(client, line, amount) {
  const { rows: [b] } = await client.query(
    'SELECT id, total_amount, discount_amount FROM bookings WHERE id = $1 FOR UPDATE', [line.booking_id]);
  const { rows: lines } = await client.query(
    `SELECT id, type, amount, status FROM payments
      WHERE booking_id = $1 AND type IN ('deposit', 'balance') ORDER BY (type = 'deposit') DESC, created_at, id`, [line.booking_id]);
  const payable = parseFloat(b.total_amount) - parseFloat(b.discount_amount || 0);
  const received = lines.filter(l => l.status === 'received').reduce((s, l) => s + parseFloat(l.amount), 0);
  const unpaid = Math.round((payable - received) * 100) / 100;
  if (unpaid <= 0.05) return { status: 409, error: { error: 'The room is already paid in full — there is nothing to split', code: 'NOTHING_UNPAID' } };
  if (!(amount > 0) || amount > unpaid + 0.05) {
    return { status: 400, error: { code: 'OVER_UNPAID', unpaid,
      error: `This line can be between Rp 1 and ${rp(unpaid)} — what is still unpaid of the price. To change the price itself, use Edit Price.` } };
  }
  const rest = Math.max(0, Math.round((unpaid - amount) * 100) / 100);
  const others = lines.filter(l => l.status === 'pending' && l.id !== line.id);
  // The rest goes on one other pending line (a balance line first); spare ones go.
  const keep = others.find(l => l.type === 'balance') || others[0];
  await client.query('UPDATE payments SET amount = $1 WHERE id = $2', [amount, line.id]);
  for (const o of others) {
    if (o === keep && rest > 0.05) await client.query('UPDATE payments SET amount = $1 WHERE id = $2', [rest, o.id]);
    else await client.query('DELETE FROM payments WHERE id = $1', [o.id]);
  }
  if (!keep && rest > 0.05) {
    await client.query(`INSERT INTO payments (booking_id, type, amount, status) VALUES ($1, 'balance', $2, 'pending')`, [line.booking_id, rest]);
  }
  // The booking's deposit follows its deposit lines (recomputeBookingStatus
  // and the Registration Card read it) — none left means no deposit asked.
  await client.query(
    `UPDATE bookings SET deposit_amount = (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = $1 AND type = 'deposit'),
            updated_at = NOW() WHERE id = $1`, [line.booking_id]);
  return { note: `Payment lines changed: ${line.type} ${rp(parseFloat(line.amount))} → ${rp(amount)}${rest > 0.05 ? `, the rest ${rp(rest)} on ${keep ? `the ${keep.type}` : 'a new balance'} line` : ''}. Price unchanged (${rp(payable)}).` };
}

// PUT /api/payments/:id
router.put('/:id', auth, async (req, res) => {
  const { status, method, received_at, notes, amount } = req.body;
  const reference = String(req.body.reference || '').trim().slice(0, 120) || null;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // An amount on its own = re-split the room's pending lines (see above).
    if (amount != null && amount !== '' && !status) {
      const { rows: [line] } = await client.query(
        `SELECT p.* FROM payments p JOIN bookings b ON b.id = p.booking_id
          WHERE p.id = $1 AND b.property_id = $2 FOR UPDATE OF p`, [req.params.id, req.propertyId]);
      if (!line) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
      if (line.status !== 'pending' || !['deposit', 'balance'].includes(line.type)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Only a pending deposit or balance line can be changed', code: 'NOT_PENDING' });
      }
      const r = await resplitPendingLine(client, line, Math.round(parseFloat(amount) * 100) / 100);
      if (r.error) { await client.query('ROLLBACK'); return res.status(r.status).json(r.error); }
      await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
        [line.booking_id, r.note.slice(0, 1000), req.user.id]);
      await client.query('COMMIT');
      const { rows: [updated] } = await db.query('SELECT * FROM payments WHERE id = $1', [line.id]);
      return res.json(updated);
    }

    const { rows } = await client.query(
      `UPDATE payments SET
        status = COALESCE($1, status),
        method = COALESCE($2, method),
        received_at = COALESCE($3, received_at),
        received_by = COALESCE($4, received_by),
        notes = COALESCE($5, notes),
        amount = COALESCE($6, amount),
        reference = COALESCE($9, reference)
       WHERE id = $7 AND booking_id IN (SELECT id FROM bookings WHERE property_id = $8) RETURNING *`,
      [status, method, received_at || null, status === 'received' ? req.user.id : null, notes, amount || null, req.params.id, req.propertyId, reference]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }

    if (status === 'received') {
      // Recompute booking status from actual payment records (order-independent)
      await recomputeBookingStatus(client, rows[0].booking_id);
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
