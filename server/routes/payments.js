const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

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
      WHERE p.status = 'pending'
        AND b.status NOT IN ('cancelled','no_show')
      ORDER BY b.check_in_date, p.type
    `);
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
    const { rows } = await db.query(
      `INSERT INTO payments (booking_id, type, amount, method, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [booking_id, type, amount, method, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/payments/:id
router.put('/:id', auth, async (req, res) => {
  const { status, method, received_at, notes, amount } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE payments SET
        status = COALESCE($1, status),
        method = COALESCE($2, method),
        received_at = COALESCE($3, received_at),
        received_by = COALESCE($4, received_by),
        notes = COALESCE($5, notes),
        amount = COALESCE($6, amount)
       WHERE id = $7 RETURNING *`,
      [status, method, received_at || null, status === 'received' ? req.user.id : null, notes, amount || null, req.params.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }

    // Auto-confirm booking when full deposit is received
    if (status === 'received' && rows[0].type === 'deposit') {
      await client.query(
        `UPDATE bookings SET status = 'confirmed', updated_at = NOW()
         WHERE id = $1 AND status = 'pending' AND deposit_amount <= $2`,
        [rows[0].booking_id, rows[0].amount]
      );
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
