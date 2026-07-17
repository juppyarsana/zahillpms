const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// GET /api/sales
router.get('/', auth, async (req, res) => {
  const { booking_id, date_from, date_to } = req.query;
  let query = `
    SELECT s.*, u.name as served_by_name
    FROM sales s LEFT JOIN users u ON s.served_by = u.id
    WHERE s.property_id = $1
  `;
  const params = [req.propertyId];
  if (booking_id) { params.push(booking_id); query += ` AND s.booking_id = $${params.length}`; }
  if (date_from) { params.push(date_from); query += ` AND s.created_at >= $${params.length}`; }
  if (date_to) { params.push(date_to); query += ` AND s.created_at <= $${params.length}`; }
  query += ' ORDER BY s.created_at DESC';
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales
router.post('/', auth, async (req, res) => {
  const { booking_id, payment_method, items } = req.body;
  if (!payment_method || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'payment_method and items required' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (booking_id) {
      const { rows: [booking] } = await client.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [booking_id, req.propertyId]);
      if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    }
    const productIds = items.map(i => i.product_id);
    const { rows: ownedProducts } = await client.query('SELECT id FROM products WHERE id = ANY($1) AND property_id = $2', [productIds, req.propertyId]);
    if (ownedProducts.length !== new Set(productIds).size) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'One or more products not found' });
    }
    const total = items.reduce((sum, i) => sum + parseFloat(i.unit_price) * parseInt(i.quantity), 0);
    const { rows: [sale] } = await client.query(
      'INSERT INTO sales (booking_id, payment_method, total_amount, served_by, property_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [booking_id || null, payment_method, total, req.user.id, req.propertyId]
    );
    for (const item of items) {
      const subtotal = parseFloat(item.unit_price) * parseInt(item.quantity);
      await client.query(
        'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ($1,$2,$3,$4,$5)',
        [sale.id, item.product_id, item.quantity, item.unit_price, subtotal]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(sale);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
