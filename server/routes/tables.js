const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/tables
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM restaurant_tables WHERE property_id = $1 ORDER BY name',
      [req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tables
router.post('/', auth, requireRole('owner'), async (req, res) => {
  const { name, capacity } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO restaurant_tables (name, capacity, property_id) VALUES ($1,$2,$3) RETURNING *',
      [name, capacity || null, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tables/:id
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, capacity } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE restaurant_tables SET name = COALESCE($1, name), capacity = COALESCE($2, capacity)
       WHERE id = $3 AND property_id = $4 RETURNING *`,
      [name, capacity, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Table not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tables/:id/status — front-of-house clears a table once it's bussed
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  if (!['available', 'occupied'].includes(status)) {
    return res.status(400).json({ error: "status must be 'available' or 'occupied'" });
  }
  try {
    const { rows } = await db.query(
      'UPDATE restaurant_tables SET status = $1 WHERE id = $2 AND property_id = $3 RETURNING *',
      [status, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Table not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tables/:id
router.delete('/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM restaurant_tables WHERE id = $1 AND property_id = $2 RETURNING id',
      [req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Table not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
