const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const salesService = require('../services/salesService');

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
  const { booking_id, payment_method, items, order_type, table_number, table_id } = req.body;
  if (!payment_method || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'payment_method and items required' });
  }
  try {
    if (booking_id) {
      const { rows: [booking] } = await db.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [booking_id, req.propertyId]);
      if (!booking) return res.status(404).json({ error: 'Booking not found' });
    }
    const result = await salesService.createSale(req.propertyId, {
      bookingId: booking_id, paymentMethod: payment_method, items,
      orderType: order_type, tableNumber: table_number, tableId: table_id, servedBy: req.user.id,
    });
    if (result.code === 'OUT_OF_STOCK') return res.status(409).json({ error: result.error, code: result.code, items: result.items });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json(result.sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
