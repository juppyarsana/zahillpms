const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { recomputeBookingStatus } = require('../services/paymentStatusService');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { computeProforma, round2 } = require('../services/folioService');
const { sendControlAlert } = require('../services/ownerAlerts');

// Corrections (owner or the `corrections` permission, reason required — see
// routes/corrections.js): refund, undo / correct / move a received payment.
const canCorrect = requireOwnerOrMenu('corrections');

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

// POST /api/payments — adds a payment line by hand (no screen uses it; the
// screens go through Record Payment). Owner / corrections only.
router.post('/', auth, canCorrect, async (req, res) => {
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

    // Otherwise this only marks a PENDING deposit / balance line received
    // (Mark Received). A line already received is changed with a correction
    // (undo / correct / refund below) — it used to be editable here by any
    // staff with no record.
    {
      const { rows: [cur] } = await client.query(
        `SELECT p.status, p.type FROM payments p JOIN bookings b ON b.id = p.booking_id
          WHERE p.id = $1 AND b.property_id = $2 FOR UPDATE OF p`, [req.params.id, req.propertyId]);
      if (!cur) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
      if (cur.status !== 'pending' || !['deposit', 'balance'].includes(cur.type) || status !== 'received') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This payment is already recorded — use a correction (undo, correct or refund) to change it', code: 'USE_CORRECTION' });
      }
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
      [status, method, received_at || null, status === 'received' ? req.user.id : null, notes, null, req.params.id, req.propertyId, reference]
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

// ── Corrections (migration 098) ─────────────────────────────────────────
// Nothing is deleted: a refund is its own received row with a negative
// amount; a payment recorded by mistake is voided (kept, never counted) or,
// for a room deposit / balance line, put back to pending (still owed).

const reasonOf = req => String(req.body?.reason || '').trim().slice(0, 500);
const whenOf = v => (v ? String(v) : null);

async function lockPayment(client, id, propertyId) {
  const { rows: [p] } = await client.query(
    `SELECT p.*, b.property_id, b.status AS booking_status, u.name AS unit_name, g.name AS guest_name,
            COALESCE(pm.label, p.method) AS method_label
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
       LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = b.property_id
      WHERE p.id = $1 AND b.property_id = $2 FOR UPDATE OF p`, [id, propertyId]);
  return p;
}
async function methodLabel(client, propertyId, method) {
  const { rows: [pm] } = await client.query(
    'SELECT label FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true', [method, propertyId]);
  return pm ? pm.label : null;
}
async function logEvent(client, bookingId, note, userId) {
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [bookingId, note.slice(0, 1000), userId]);
}
const KIND = { deposit: 'Room deposit', balance: 'Room balance', incidental: 'Extras payment', refund: 'Refund' };

// What can be given back on a booking: for a cancelled / no-show booking
// everything received (less earlier refunds); otherwise the credit on the
// whole-stay bill (payments beyond nights + extras + service & tax).
async function refundable(bookingId, propertyId) {
  const { rows: [b] } = await db.query('SELECT status FROM bookings WHERE id = $1 AND property_id = $2', [bookingId, propertyId]);
  if (!b) return null;
  const { rows: [r] } = await db.query(
    "SELECT COALESCE(SUM(amount), 0)::float AS received FROM payments WHERE booking_id = $1 AND status = 'received'", [bookingId]);
  if (['cancelled', 'no_show'].includes(b.status)) return { status: b.status, received: r.received, amount: Math.max(0, round2(r.received)) };
  const est = await computeProforma(bookingId, propertyId);
  const owed = est.group ? est.group.own_total : est.total;
  // bill = what the whole stay comes to — shown when there is no credit, so
  // front desk sees why ("paid 1.000.000 of 3.600.000").
  return { status: b.status, received: r.received, bill: round2(owed), amount: Math.max(0, round2(r.received - owed)) };
}

// GET /api/payments/refundable?booking_id= — how much can be refunded now.
router.get('/refundable', auth, async (req, res) => {
  try {
    const r = await refundable(req.query.booking_id, req.propertyId);
    if (!r) return res.status(404).json({ error: 'Booking not found' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/refund { booking_id, amount, method, refunded_at?, reference?, refund_of?, reason }
// Money given back to the guest: a received 'refund' row of −amount on the
// day it was given back. Never more than the booking's credit.
router.post('/refund', auth, canCorrect, async (req, res) => {
  const reason = reasonOf(req);
  const amount = round2(parseFloat(req.body.amount));
  const { booking_id, method } = req.body;
  if (!reason) return res.status(400).json({ error: 'A reason is required', code: 'REASON_REQUIRED' });
  if (!booking_id || !(amount > 0)) return res.status(400).json({ error: 'booking_id and an amount above 0 are required' });
  if (!method) return res.status(400).json({ error: 'Choose how the money was given back' });
  const client = await db.pool.connect();
  try {
    const can = await refundable(booking_id, req.propertyId);
    if (!can) return res.status(404).json({ error: 'Booking not found' });
    if (amount > can.amount + 0.05) {
      return res.status(409).json({
        code: 'OVER_CREDIT', refundable: can.amount,
        error: can.amount > 0
          ? `Only ${rp(can.amount)} can be refunded — that is the credit on this booking`
          : 'This booking has no credit to refund. If the bill is wrong, correct it first (Edit Price, void the line, undo the payment).',
      });
    }
    await client.query('BEGIN');
    await client.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [booking_id]);
    const label = await methodLabel(client, req.propertyId, method);
    if (!label) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid payment method' }); }
    let refundOf = null;
    if (req.body.refund_of) {
      const { rows: [o] } = await client.query(
        "SELECT id FROM payments WHERE id = $1 AND booking_id = $2 AND status = 'received' AND amount > 0", [req.body.refund_of, booking_id]);
      refundOf = o ? o.id : null;
    }
    const { rows: [row] } = await client.query(
      `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes, reference, refund_of)
       VALUES ($1, 'refund', $2, 'received', $3, COALESCE($4::timestamptz, NOW()), $5, $6, $7, $8) RETURNING *`,
      [booking_id, -amount, method, whenOf(req.body.refunded_at), req.user.id, `Refund: ${reason}`.slice(0, 250),
       String(req.body.reference || '').trim().slice(0, 120) || null, refundOf]);
    await logEvent(client, booking_id, `Refund ${rp(amount)} given back (${label}). Reason: ${reason}`, req.user.id);
    await client.query('COMMIT');
    sendControlAlert(req.propertyId, { bookingIds: booking_id, userId: req.user.id, reason, headline: `💸 Refund ${rp(amount)} (${label})` });
    res.status(201).json(row);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Takes a received payment back, inside the caller's transaction.
//   room deposit / balance → pending again (still owed), status recomputed
//   extras payment for chosen lines → those lines unpaid again, payment voided
//   activity paid directly → the activity is "not paid yet" again, payment voided
//   a plain extras payment / a refund → voided
// A Sales till payment is undone by voiding the sale. Returns { error } or { note }.
async function takeBack(client, p, { userId, reason }) {
  if (p.status !== 'received') return { status: 409, error: `Only a received payment can be undone — this one is ${p.status}` };
  const amt = rp(Math.abs(parseFloat(p.amount)));
  if (['deposit', 'balance'].includes(p.type)) {
    await client.query(
      `UPDATE payments SET status = 'pending', method = NULL, received_at = NULL, received_by = NULL, reference = NULL, recorded_at = NULL
       WHERE id = $1`, [p.id]);
    await recomputeBookingStatus(client, p.booking_id);
    return { note: `${KIND[p.type]} ${amt} (${p.method_label}) taken back — the line is unpaid again` };
  }
  if (p.sale_id) return { status: 409, code: 'USE_VOID_SALE', error: 'This payment belongs to a Sales till sale — void the sale (Sales → History) to take it back' };
  const voidIt = () => client.query(
    "UPDATE payments SET status = 'voided', voided_at = NOW(), voided_by = $1, void_reason = $2 WHERE id = $3", [userId, reason, p.id]);
  if (p.activity_booking_id) {
    const { rows: [ab] } = await client.query('SELECT id, folio_charge_id FROM activity_bookings WHERE id = $1 FOR UPDATE', [p.activity_booking_id]);
    if (ab?.folio_charge_id) {
      await client.query('UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW() WHERE id = $2 AND is_voided = false', [userId, ab.folio_charge_id]);
    }
    await client.query(
      `UPDATE activity_bookings SET payment_method = NULL, service_charge_amount = NULL, tax_amount = NULL, folio_charge_id = NULL, updated_at = NOW()
       WHERE id = $1`, [p.activity_booking_id]);
    await voidIt();
    return { note: `Activity payment ${amt} (${p.method_label}) taken back — the activity is "not paid yet" again` };
  }
  const { rowCount: lines } = await client.query('UPDATE folio_charges SET paid_payment_id = NULL WHERE paid_payment_id = $1', [p.id]);
  const { rowCount: nights } = await client.query('UPDATE booking_addons SET paid_payment_id = NULL WHERE paid_payment_id = $1', [p.id]);
  await voidIt();
  if (p.type === 'refund') return { note: `Refund ${amt} (${p.method_label}) voided — it was recorded by mistake` };
  return { note: `Extras payment ${amt} (${p.method_label}) taken back${lines + nights ? ` — ${lines + nights} item${lines + nights === 1 ? '' : 's'} unpaid again` : ''}` };
}

// POST /api/payments/:id/undo { reason } — a payment recorded by mistake
// (wrong booking, never received, wrong amount: undo, then record it right).
router.post('/:id/undo', auth, canCorrect, async (req, res) => {
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ error: 'A reason is required', code: 'REASON_REQUIRED' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const p = await lockPayment(client, req.params.id, req.propertyId);
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
    const out = await takeBack(client, p, { userId: req.user.id, reason });
    if (out.error) { await client.query('ROLLBACK'); return res.status(out.status).json({ error: out.error, code: out.code }); }
    await logEvent(client, p.booking_id, `${out.note}. Reason: ${reason}`, req.user.id);
    await client.query('COMMIT');
    sendControlAlert(req.propertyId, { bookingIds: p.booking_id, userId: req.user.id, reason, headline: `↩️ ${out.note}` });
    res.json({ ok: true, note: out.note });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/payments/:id/correct { method?, received_at?, reference?, notes?, reason }
// The money is right, a detail was typed wrong. (A wrong amount: undo the
// payment and record it again.) A Sales / activity payment's method is kept
// in step on the sale / activity.
router.put('/:id/correct', auth, canCorrect, async (req, res) => {
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ error: 'A reason is required', code: 'REASON_REQUIRED' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const p = await lockPayment(client, req.params.id, req.propertyId);
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
    if (p.status !== 'received') { await client.query('ROLLBACK'); return res.status(409).json({ error: `Only a received payment can be corrected — this one is ${p.status}` }); }
    const changes = [];
    let method = p.method;
    if (req.body.method && req.body.method !== p.method) {
      const label = await methodLabel(client, req.propertyId, req.body.method);
      if (!label) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid payment method' }); }
      changes.push(`method ${p.method_label} → ${label}`);
      method = req.body.method;
    }
    const day = v => (v ? new Date(v).toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' }) : '');
    let receivedAt = null;
    if (req.body.received_at && day(req.body.received_at) !== day(p.received_at)) {
      receivedAt = String(req.body.received_at);
      changes.push(`date ${day(p.received_at)} → ${day(req.body.received_at)}`);
    }
    const clean = (v, max) => String(v ?? '').trim().slice(0, max) || null;
    const reference = req.body.reference !== undefined ? clean(req.body.reference, 120) : p.reference;
    if (reference !== (p.reference || null)) changes.push(`reference ${p.reference || '—'} → ${reference || '—'}`);
    const notes = req.body.notes !== undefined ? clean(req.body.notes, 250) : p.notes;
    if (notes !== (p.notes || null)) changes.push('notes updated');
    if (!changes.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Nothing was changed' }); }
    const { rows: [row] } = await client.query(
      `UPDATE payments SET method = $1, received_at = COALESCE($2::timestamptz, received_at), reference = $3, notes = $4 WHERE id = $5 RETURNING *`,
      [method, receivedAt, reference, notes, p.id]);
    if (method !== p.method) {
      if (p.sale_id) await client.query('UPDATE sales SET payment_method = $1 WHERE id = $2', [method, p.sale_id]);
      if (p.activity_booking_id) await client.query('UPDATE activity_bookings SET payment_method = $1, updated_at = NOW() WHERE id = $2', [method, p.activity_booking_id]);
    }
    const what = `${KIND[p.type] || 'Payment'} ${rp(Math.abs(parseFloat(p.amount)))} corrected: ${changes.join('; ')}`;
    await logEvent(client, p.booking_id, `${what}. Reason: ${reason}`, req.user.id);
    await client.query('COMMIT');
    sendControlAlert(req.propertyId, { bookingIds: p.booking_id, userId: req.user.id, reason, headline: `✏️ ${what}` });
    res.json(row);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/payments/:id/move { to_booking_id, reason } — money recorded on
// the wrong booking (or left on a cancelled room): taken back there and
// recorded on the other booking with the same method, date, reference and
// receiver — its unpaid room lines first (deposit, then balance), anything
// beyond them as an extras payment. A payment for chosen items, a Sales sale
// or an activity belongs to those items and can't be moved.
router.post('/:id/move', auth, canCorrect, async (req, res) => {
  const reason = reasonOf(req);
  const to = req.body.to_booking_id;
  if (!reason) return res.status(400).json({ error: 'A reason is required', code: 'REASON_REQUIRED' });
  if (!to) return res.status(400).json({ error: 'Choose the booking to move the payment to' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const p = await lockPayment(client, req.params.id, req.propertyId);
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
    if (p.booking_id === to) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The payment is already on that booking' }); }
    if (p.type === 'refund' || p.sale_id || p.activity_booking_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This payment belongs to a sale, an activity or a refund — it can\'t be moved', code: 'NOT_MOVABLE' });
    }
    const { rows: [tied] } = await client.query(
      `SELECT 1 FROM folio_charges WHERE paid_payment_id = $1 UNION ALL SELECT 1 FROM booking_addons WHERE paid_payment_id = $1 LIMIT 1`, [p.id]);
    if (tied) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This payment paid specific items of this booking — undo it and record it on the other booking instead', code: 'NOT_MOVABLE' }); }
    const { rows: [target] } = await client.query(
      `SELECT b.id, b.status, u.name AS unit_name, g.name AS guest_name FROM bookings b
         JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
        WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE OF b`, [to, req.propertyId]);
    if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'The other booking was not found' }); }
    if (['cancelled', 'no_show'].includes(target.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Room ${target.unit_name}'s booking is ${target.status.replace('_', '-')} — money can't be moved onto it` });
    }

    const back = await takeBack(client, p, { userId: req.user.id, reason });
    if (back.error) { await client.query('ROLLBACK'); return res.status(back.status).json({ error: back.error, code: back.code }); }

    // On the other booking: unpaid room lines first, the rest as extras.
    let left = round2(parseFloat(p.amount));
    const { rows: pending } = await client.query(
      `SELECT id, amount FROM payments WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'pending' AND amount > 0
        ORDER BY (type = 'deposit') DESC, created_at, id`, [to]);
    const parts = [];
    for (const l of pending) {
      if (left <= 0.005) break;
      const take = Math.min(left, parseFloat(l.amount));
      parts.push({ payment_id: l.id, amount: take });
      left = round2(left - take);
    }
    const opts = { method: p.method, receivedAt: p.received_at ? new Date(p.received_at).toISOString() : null,
      notes: `Moved from room ${p.unit_name} (${p.guest_name})`, userId: p.received_by || req.user.id, reference: p.reference || null };
    const room = await require('./folio').payRoomLines(client, { id: to }, parts, opts);
    if (room.error) { await client.query('ROLLBACK'); return res.status(room.status).json({ error: room.error }); }
    if (left > 0.005) {
      await client.query(
        `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes, reference)
         VALUES ($1, 'incidental', $2, 'received', $3, COALESCE($4::timestamptz, NOW()), $5, $6, $7)`,
        [to, left, opts.method, opts.receivedAt, opts.userId, opts.notes, opts.reference]);
    }
    const amt = rp(parseFloat(p.amount));
    const split = left > 0.005 ? ` (${rp(room.total)} on the room, ${rp(left)} as extras / credit)` : '';
    await logEvent(client, p.booking_id, `Payment ${amt} (${p.method_label}) moved to room ${target.unit_name} (${target.guest_name}). Reason: ${reason}`, req.user.id);
    await logEvent(client, to, `Payment ${amt} (${p.method_label}) moved here from room ${p.unit_name} (${p.guest_name})${split}. Reason: ${reason}`, req.user.id);
    await client.query('COMMIT');
    sendControlAlert(req.propertyId, { bookingIds: [p.booking_id, to], userId: req.user.id, reason,
      headline: `🔀 Payment ${amt} moved: room ${p.unit_name} → room ${target.unit_name}` });
    res.json({ ok: true, room_amount: room.total, extras_amount: left > 0.005 ? left : 0 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

