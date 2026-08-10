const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const authQueryToken = require('../middleware/authQueryToken');
const moduleGuard = require('../middleware/moduleGuard');
const sse = require('../sse');
const gate = moduleGuard('sales');

// Mounted without a blanket `auth` (like calls.js) because /stream needs
// authQueryToken (EventSource can't set an Authorization header) while the
// other two routes use the normal staff `auth` — moduleGuard('sales') is
// applied per-route instead.

const STATUSES = ['preparing', 'ready', 'served'];

// GET /api/kitchen/active — tickets not yet served, oldest first
router.get('/active', auth, gate, async (req, res) => {
  try {
    const { rows: sales } = await db.query(
      `SELECT s.id, s.order_type, s.table_number, s.kitchen_status, s.created_at,
              b.guest_id, u.name AS unit_name, g.name AS guest_name
       FROM sales s
       LEFT JOIN bookings b ON b.id = s.booking_id
       LEFT JOIN units u ON u.id = b.unit_id
       LEFT JOIN guests g ON g.id = b.guest_id
       WHERE s.property_id = $1 AND s.kitchen_status IS NOT NULL AND s.kitchen_status != 'served'
       ORDER BY s.created_at ASC`,
      [req.propertyId]
    );
    if (sales.length === 0) return res.json([]);

    const { rows: items } = await db.query(
      `SELECT si.sale_id, si.quantity, p.name, p.category
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ANY($1) AND p.category IN ('drinks','food')`,
      [sales.map(s => s.id)]
    );
    const itemsBySale = new Map();
    for (const item of items) {
      if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
      itemsBySale.get(item.sale_id).push({ name: item.name, quantity: item.quantity });
    }

    res.json(sales.map(s => ({ ...s, items: itemsBySale.get(s.id) || [] })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/kitchen/:id/status
router.patch('/:id/status', auth, gate, async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  try {
    const { rows } = await db.query(
      `UPDATE sales SET kitchen_status = $1
       WHERE id = $2 AND property_id = $3 AND kitchen_status IS NOT NULL
       RETURNING *`,
      [status, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ticket not found' });
    sse.notify('kitchen:' + req.propertyId);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kitchen/stream — SSE for the kitchen display screen
router.get('/stream', authQueryToken, gate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const key = 'kitchen:' + req.user.propertyId;
  sse.addClient(key, res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(key, res);
  });
});

module.exports = router;
