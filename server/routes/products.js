const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/products
router.get('/', auth, async (req, res) => {
  const { category, available } = req.query;
  let query = 'SELECT * FROM products WHERE property_id = $1';
  const params = [req.propertyId];
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
  const { name, category, price, description, track_stock, stock_quantity, low_stock_threshold } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO products (name, category, price, description, property_id, track_stock, stock_quantity, low_stock_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, category || 'other', price, description, req.propertyId, !!track_stock, stock_quantity || 0, low_stock_threshold || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, category, price, description, is_available, track_stock, low_stock_threshold } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE products SET
        name = COALESCE($1, name), category = COALESCE($2, category),
        price = COALESCE($3, price), description = COALESCE($4, description),
        is_available = COALESCE($5, is_available), track_stock = COALESCE($6, track_stock),
        low_stock_threshold = COALESCE($7, low_stock_threshold)
       WHERE id = $8 AND property_id = $9 RETURNING *`,
      [name, category, price, description, is_available, track_stock, low_stock_threshold, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/products/:id/stock — manual restock/adjustment/waste (sales
// decrement stock automatically inside salesService.createSale instead)
router.patch('/:id/stock', auth, requireRole('owner'), async (req, res) => {
  const { change_qty, reason, note } = req.body;
  const REASONS = ['restock', 'adjustment', 'waste'];
  if (!Number.isInteger(change_qty) || change_qty === 0) return res.status(400).json({ error: 'change_qty must be a non-zero integer' });
  if (!REASONS.includes(reason)) return res.status(400).json({ error: `reason must be one of ${REASONS.join(', ')}` });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [product] } = await client.query(
      'SELECT id, stock_quantity FROM products WHERE id = $1 AND property_id = $2 FOR UPDATE',
      [req.params.id, req.propertyId]
    );
    if (!product) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found' }); }
    if (product.stock_quantity + change_qty < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot reduce stock below 0 (currently ${product.stock_quantity})` });
    }
    const { rows: [updated] } = await client.query(
      'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2 RETURNING *',
      [change_qty, req.params.id]
    );
    await client.query(
      `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.propertyId, req.params.id, change_qty, reason, note || null, req.user.id]
    );
    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/products/:id/stock/movements — audit trail
router.get('/:id/stock/movements', auth, async (req, res) => {
  try {
    const { rows: [product] } = await db.query('SELECT id FROM products WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const { rows } = await db.query(
      `SELECT sm.*, u.name AS created_by_name
       FROM stock_movements sm LEFT JOIN users u ON u.id = sm.created_by
       WHERE sm.product_id = $1 AND sm.property_id = $2
       ORDER BY sm.created_at DESC LIMIT 50`,
      [req.params.id, req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
