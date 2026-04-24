const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/units
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM units ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/units/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM units WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json(rows[0]);
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
       WHERE id = $7 RETURNING *`,
      [name, type, description, base_rate, max_guests, status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
