const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/units
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM units WHERE property_id = $1 ORDER BY name', [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/units/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM units WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/units  (owner only)
router.post('/', auth, requireRole('owner'), async (req, res) => {
  const { name, type, description, base_rate, max_guests } = req.body;
  if (!name) return res.status(400).json({ error: 'Unit name is required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO units (name, type, description, base_rate, max_guests, property_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, type || '', description || '', base_rate || 0, max_guests || 2, req.propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/units/:id  (owner only)
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, type, description, base_rate, max_guests, status } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE units SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        description = COALESCE($3, description),
        base_rate = COALESCE($4, base_rate),
        max_guests = COALESCE($5, max_guests),
        status = COALESCE($6, status)
       WHERE id = $7 AND property_id = $8 RETURNING *`,
      [name, type, description, base_rate, max_guests, status, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/units/:id  (owner only — blocked if active bookings exist)
router.delete('/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    const { rows: active } = await db.query(
      `SELECT id FROM bookings
       WHERE unit_id = $1
         AND property_id = $2
         AND status IN ('pending','deposit_paid','confirmed','checked_in')
       LIMIT 1`,
      [req.params.id, req.propertyId]
    );
    if (active.length > 0) {
      return res.status(409).json({ error: 'Cannot delete — this unit has active or upcoming bookings' });
    }
    const { rows } = await db.query('DELETE FROM units WHERE id = $1 AND property_id = $2 RETURNING id', [req.params.id, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json({ message: 'Unit deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
