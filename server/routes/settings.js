const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ── Booking Sources ──────────────────────────────────────────────────────────

router.get('/booking-sources', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM booking_sources ORDER BY sort_order, id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/booking-sources', auth, async (req, res) => {
  const { id, label, is_ota, color, sort_order } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO booking_sources (id, label, is_ota, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id.toLowerCase().replace(/\s+/g, '_'), label, !!is_ota, color || '#6b7280', sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A source with this ID already exists' : err.message,
    });
  }
});

router.put('/booking-sources/:id', auth, async (req, res) => {
  const { label, is_ota, color, is_active, sort_order } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE booking_sources SET
        label      = COALESCE($1, label),
        is_ota     = COALESCE($2, is_ota),
        color      = COALESCE($3, color),
        is_active  = COALESCE($4, is_active),
        sort_order = COALESCE($5, sort_order)
       WHERE id = $6 RETURNING *`,
      [label, is_ota ?? null, color, is_active ?? null, sort_order ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Source not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Payment Methods ──────────────────────────────────────────────────────────

router.get('/payment-methods', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM payment_methods ORDER BY sort_order, id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payment-methods', auth, async (req, res) => {
  const { id, label, sort_order } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO payment_methods (id, label, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [id.toLowerCase().replace(/\s+/g, '_'), label, sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505' ? 'A method with this ID already exists' : err.message,
    });
  }
});

router.put('/payment-methods/:id', auth, async (req, res) => {
  const { label, is_active, sort_order } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE payment_methods SET
        label      = COALESCE($1, label),
        is_active  = COALESCE($2, is_active),
        sort_order = COALESCE($3, sort_order)
       WHERE id = $4 RETURNING *`,
      [label, is_active ?? null, sort_order ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Method not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
