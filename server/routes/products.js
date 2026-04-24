const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/products
router.get('/', auth, async (req, res) => {
  const { category, available } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (category) { params.push(category); query += ` AND category = $${params.length}`; }
  if (available !== undefined) { params.push(available === 'true'); query += ` AND is_available = $${params.length}`; }
  query += ' ORDER BY category, name';
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products
router.post('/', auth, requireRole('owner'), async (req, res) => {
  const { name, category, price, description } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO products (name, category, price, description) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, category || 'other', price, description]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, category, price, description, is_available } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE products SET
        name = COALESCE($1, name), category = COALESCE($2, category),
        price = COALESCE($3, price), description = COALESCE($4, description),
        is_available = COALESCE($5, is_available)
       WHERE id = $6 RETURNING *`,
      [name, category, price, description, is_available, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
