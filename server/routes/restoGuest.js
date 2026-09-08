const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const authTableQR = require('../middleware/authTableQR');
const moduleGuard = require('../middleware/moduleGuard');
const salesService = require('../services/salesService');
const tableSessionService = require('../services/tableSessionService');
const gate = moduleGuard('resto_ordering');

// Guest QR self-order surface (resto-display/'s /t/:qrToken screen). No staff
// login — authTableQR resolves the printed per-table QR token to
// { propertyId, tableId } only, never the shared property-wide display_token
// (see middleware/authTableQR.js for why). Mounted at /api/resto/guest in
// server/index.js, before the bare /api/resto mount.

// GET /api/resto/guest/:qrToken/context
router.get('/:qrToken/context', authTableQR, gate, async (req, res) => {
  try {
    const { rows: propertyRows } = await db.query(
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.logo_url, ps.brand_color
         FROM properties p
         LEFT JOIN property_settings ps ON ps.property_id = p.id
        WHERE p.id = $1`,
      [req.propertyId]
    );
    const session = await tableSessionService.getOpenSession(req.propertyId, req.tableId);
    res.json({
      table: { id: req.tableId, name: req.tableName },
      property: propertyRows[0] || null,
      session: session ? { id: session.id, opened_at: session.opened_at } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resto/guest/:qrToken/menu — same availability filter as Room
// Display's guest menu (routes/display.js) for consistency.
router.get('/:qrToken/menu', authTableQR, gate, async (req, res) => {
  try {
    const { rows: products } = await db.query(
      `SELECT id, name, category, price, description
         FROM products
        WHERE property_id = $1 AND is_available = true AND (track_stock = false OR stock_quantity > 0)
        ORDER BY category, name`,
      [req.propertyId]
    );
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resto/guest/:qrToken/order — fires straight to the kitchen, no
// confirmation gate (only Room Display's room-service orders get that, see
// routes/resto.js). Prices are resolved server-side, never trusted from a
// guest's phone. No payment step — the order lands as an "open tab"
// (payment_method 'unpaid', migration 050); resto staff settle the whole
// table when the party's done, and can charge it to a room.
router.post('/:qrToken/order', authTableQR, gate, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }
  try {
    const productIds = items.map(i => i.product_id);
    const { rows: products } = await db.query(
      'SELECT id, price FROM products WHERE id = ANY($1) AND property_id = $2 AND is_available = true',
      [productIds, req.propertyId]
    );
    if (products.length !== new Set(productIds).size) {
      return res.status(404).json({ error: 'One or more items are no longer available' });
    }
    const priceById = new Map(products.map(p => [p.id, p.price]));
    const pricedItems = items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: priceById.get(i.product_id) }));

    const result = await salesService.createSale(req.propertyId, {
      bookingId: null,
      paymentMethod: 'unpaid',
      orderType: 'dine_in',
      items: pricedItems,
      tableId: req.tableId,
      servedBy: null,
      holdForConfirmation: false,
      orderSource: 'guest_qr',
    });
    if (result.code === 'OUT_OF_STOCK') return res.status(409).json({ error: result.error, code: result.code, items: result.items });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json({ ok: true, sale_id: result.sale.id, session_id: result.sale.table_session_id, total: result.sale.total_amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resto/guest/:qrToken/orders?session_id= — leak guard: only
// returns data when session_id both belongs to this table AND is still
// open, otherwise a stale guest tab could see the NEXT party's orders once a
// new session opens on the same table.
router.get('/:qrToken/orders', authTableQR, gate, async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.json({ status: 'closed', session_id: null, orders: [], total: 0 });
  try {
    const { rows: [session] } = await db.query(
      'SELECT id, status FROM table_sessions WHERE id = $1 AND table_id = $2 AND property_id = $3',
      [session_id, req.tableId, req.propertyId]
    );
    if (!session || session.status !== 'open') {
      return res.json({ status: 'closed', session_id, orders: [], total: 0 });
    }
    const summary = await tableSessionService.sessionSummary(req.propertyId, session_id);
    res.json({ status: 'open', ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
