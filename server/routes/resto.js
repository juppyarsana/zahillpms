const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const auth = require('../middleware/auth');
const authQueryToken = require('../middleware/authQueryToken');
const requireRole = require('../middleware/role');
const moduleGuard = require('../middleware/moduleGuard');
const sse = require('../sse');
const salesService = require('../services/salesService');
const tableSessionService = require('../services/tableSessionService');
const restoSettleService = require('../services/restoSettleService');
const gate = moduleGuard('resto_ordering');

// Resto staff surface (resto-display/'s /staff/* screens) — real staff JWT
// (same login/users/roles as the PMS client), restricted per-menu-key on the
// client side only (allowed_menus: resto_take_order / resto_confirm_queue /
// resto_tables — same convention the PMS itself uses, see SettingsRoles.jsx).
// Mounted with no app-level auth in server/index.js; auth + gate applied
// per-route here, same pattern as routes/kitchen.js and routes/calls.js.

function restoPublicUrl() {
  const base = process.env.RESTO_PUBLIC_URL || (process.env.RESTO_URL || '').split(',')[0] || 'http://localhost:5178';
  return base.replace(/\/$/, '');
}

// GET /api/resto/context
router.get('/context', auth, gate, async (req, res) => {
  try {
    const { rows: propertyRows } = await db.query(
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.logo_url, ps.brand_color
         FROM properties p
         LEFT JOIN property_settings ps ON ps.property_id = p.id
        WHERE p.id = $1`,
      [req.propertyId]
    );
    const { rows: paymentMethods } = await db.query(
      'SELECT id, label FROM payment_methods WHERE property_id = $1 AND is_active = true ORDER BY sort_order, id',
      [req.propertyId]
    );
    const { rows: categories } = await db.query(
      `SELECT DISTINCT category FROM products WHERE property_id = $1 AND is_available = true ORDER BY category`,
      [req.propertyId]
    );
    res.json({ property: propertyRows[0] || null, payment_methods: paymentMethods, categories: categories.map(c => c.category) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resto/menu
router.get('/menu', auth, gate, async (req, res) => {
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

// GET /api/resto/rooms — currently checked-in rooms, for the "charge to
// room" option when settling a table. Scoped to this property; a resto_staff
// login reaches this fine (only needs a valid property JWT + the module).
router.get('/rooms', auth, gate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.id, u.name AS unit_name, g.name AS guest_name
         FROM bookings b
         JOIN units u ON u.id = b.unit_id
         LEFT JOIN guests g ON g.id = b.guest_id
        WHERE b.property_id = $1 AND b.status = 'checked_in'
        ORDER BY u.name`,
      [req.propertyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resto/orders — staff-tablet order taking (Take Order screen).
// Fires straight to the kitchen — a staff member entering it is the
// verification, same logic as the existing PMS POS. payment_method is
// optional: omit it (or send 'unpaid') to open a tab that's settled when the
// table closes — the default for dine-in. Pass a real method for an
// immediate-pay takeaway.
router.post('/orders', auth, gate, async (req, res) => {
  const { table_id, order_type, payment_method, items, booking_id } = req.body;
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
      bookingId: booking_id || null,
      paymentMethod: payment_method || 'unpaid',
      orderType: order_type || 'dine_in',
      items: pricedItems,
      tableId: table_id || null,
      servedBy: req.user.id,
      holdForConfirmation: false,
      orderSource: 'resto_staff',
    });
    if (result.code === 'OUT_OF_STOCK') return res.status(409).json({ error: result.error, code: result.code, items: result.items });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json({ sale: result.sale });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resto/pending — room-service confirm queue, same join shape as
// routes/kitchen.js's /active.
router.get('/pending', auth, gate, async (req, res) => {
  try {
    const { rows: sales } = await db.query(
      `SELECT s.id, s.total_amount, s.created_at,
              u.name AS unit_name, g.name AS guest_name
         FROM sales s
         LEFT JOIN bookings b ON b.id = s.booking_id
         LEFT JOIN units u ON u.id = b.unit_id
         LEFT JOIN guests g ON g.id = b.guest_id
        WHERE s.property_id = $1 AND s.confirmation_status = 'pending'
        ORDER BY s.created_at ASC`,
      [req.propertyId]
    );
    if (sales.length === 0) return res.json([]);

    const { rows: items } = await db.query(
      `SELECT si.sale_id, si.quantity, p.name
         FROM sale_items si JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = ANY($1)`,
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

// POST /api/resto/orders/:id/confirm
router.post('/orders/:id/confirm', auth, gate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE sales SET confirmation_status = 'confirmed', confirmed_by = $1, confirmed_at = NOW()
        WHERE id = $2 AND property_id = $3 AND confirmation_status = 'pending'
        RETURNING *`,
      [req.user.id, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Order is not awaiting confirmation' });
    sse.notify('kitchen:' + req.propertyId);
    sse.notify('resto:' + req.propertyId);
    res.json({ ok: true, sale: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resto/orders/:id/reject — reverses stock via a compensating
// stock_movements row and nulls kitchen_status so a rejected order can never
// resurface on the kitchen board.
router.post('/orders/:id/reject', auth, gate, async (req, res) => {
  const { reason } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [sale] } = await client.query(
      `SELECT id FROM sales WHERE id = $1 AND property_id = $2 AND confirmation_status = 'pending' FOR UPDATE`,
      [req.params.id, req.propertyId]
    );
    if (!sale) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Order is not awaiting confirmation' });
    }
    const { rows: saleItems } = await client.query(
      `SELECT si.product_id, si.quantity, p.track_stock
         FROM sale_items si JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = $1 FOR UPDATE OF p`,
      [sale.id]
    );
    for (const item of saleItems) {
      if (!item.track_stock) continue;
      await client.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [item.quantity, item.product_id]);
      await client.query(
        `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, reference_id, note, created_by)
         VALUES ($1,$2,$3,'adjustment',$4,'Room-service order rejected',$5)`,
        [req.propertyId, item.product_id, item.quantity, sale.id, req.user.id]
      );
    }
    const { rows: [updated] } = await client.query(
      `UPDATE sales SET confirmation_status = 'rejected', rejection_reason = $1, confirmed_by = $2, confirmed_at = NOW(), kitchen_status = NULL
        WHERE id = $3 RETURNING *`,
      [reason || null, req.user.id, sale.id]
    );
    // Reverse the folio charge salesService.createSale posted at order time
    // (see that file — a room-service order bills the guest immediately,
    // same reasoning as decrementing stock immediately) — a declined order
    // must not stay on the guest's bill.
    await client.query(
      `UPDATE folio_charges SET is_voided = true, voided_by = $1, voided_at = NOW()
        WHERE sale_id = $2 AND is_voided = false`,
      [req.user.id, sale.id]
    );
    await client.query('COMMIT');
    sse.notify('resto:' + req.propertyId);
    res.json({ ok: true, sale: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/resto/tables
router.get('/tables', auth, gate, async (req, res) => {
  try {
    const { rows: tables } = await db.query(
      `SELECT t.id, t.name, t.capacity, t.status,
              ts.id AS session_id, ts.opened_at AS session_opened_at
         FROM restaurant_tables t
         LEFT JOIN table_sessions ts ON ts.table_id = t.id AND ts.status = 'open'
        WHERE t.property_id = $1
        ORDER BY t.name`,
      [req.propertyId]
    );
    const openSessionIds = tables.filter(t => t.session_id).map(t => t.session_id);
    let totalsBySession = new Map();
    let countsBySession = new Map();
    let unpaidBySession = new Map();
    if (openSessionIds.length > 0) {
      const { rows: totals } = await db.query(
        `SELECT table_session_id, COUNT(*) AS order_count,
                COALESCE(SUM(total_amount), 0) AS session_total,
                COALESCE(SUM(total_amount) FILTER (WHERE payment_method = 'unpaid'), 0) AS unpaid_total
           FROM sales
          WHERE table_session_id = ANY($1) AND confirmation_status IS DISTINCT FROM 'rejected'
          GROUP BY table_session_id`,
        [openSessionIds]
      );
      for (const t of totals) {
        totalsBySession.set(t.table_session_id, parseFloat(t.session_total));
        countsBySession.set(t.table_session_id, parseInt(t.order_count));
        unpaidBySession.set(t.table_session_id, parseFloat(t.unpaid_total));
      }
    }
    res.json(tables.map(t => ({
      id: t.id, name: t.name, capacity: t.capacity, status: t.status,
      session: t.session_id ? { id: t.session_id, opened_at: t.session_opened_at } : null,
      order_count: t.session_id ? (countsBySession.get(t.session_id) || 0) : 0,
      session_total: t.session_id ? (totalsBySession.get(t.session_id) || 0) : 0,
      unpaid_total: t.session_id ? (unpaidBySession.get(t.session_id) || 0) : 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resto/tables/:id/session — "Seat Party"
router.post('/tables/:id/session', auth, gate, async (req, res) => {
  try {
    const result = await tableSessionService.openSession(req.propertyId, req.params.id, req.user.id);
    if (result.error) return res.status(404).json({ error: result.error });
    sse.notify('resto:' + req.propertyId);
    res.json({ session: result.session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resto/tables/:id/session — "View Bill"
router.get('/tables/:id/session', auth, gate, async (req, res) => {
  try {
    const session = await tableSessionService.getOpenSession(req.propertyId, req.params.id);
    if (!session) return res.json({ session: null, orders: [], total: 0 });
    const summary = await tableSessionService.sessionSummary(req.propertyId, session.id);
    res.json({ session: { id: session.id, opened_at: session.opened_at }, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resto/tables/:id/settle — pick ONE payment method for every
// unpaid order on the table's open session, then close it. body:
// { payment_method, booking_id? } — booking_id required when payment_method
// is 'room_charge'. See services/restoSettleService.js.
router.post('/tables/:id/settle', auth, gate, async (req, res) => {
  const { payment_method, booking_id } = req.body;
  try {
    const result = await restoSettleService.settleAndClose(req.propertyId, req.params.id, {
      paymentMethod: payment_method,
      bookingId: booking_id || null,
      userId: req.user.id,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    sse.notify('resto:' + req.propertyId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resto/tables/:id/close — closes the open session + frees the
// table. Idempotent if there's no open session. Refuses (409) if the session
// still has unpaid orders — settle those first (/settle), or this would
// strand real revenue as 'unpaid' forever.
router.post('/tables/:id/close', auth, gate, async (req, res) => {
  try {
    if (await restoSettleService.hasUnpaid(req.propertyId, req.params.id)) {
      return res.status(409).json({ error: 'This table has unpaid orders — settle the bill first', code: 'UNPAID' });
    }
    await tableSessionService.closeSession(req.propertyId, req.params.id, req.user.id);
    sse.notify('resto:' + req.propertyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resto/tables/:id/qr
router.get('/tables/:id/qr', auth, gate, async (req, res) => {
  try {
    const { rows: [table] } = await db.query(
      'SELECT id, name, qr_token FROM restaurant_tables WHERE id = $1 AND property_id = $2',
      [req.params.id, req.propertyId]
    );
    if (!table) return res.status(404).json({ error: 'Table not found' });
    res.json({ table_id: table.id, name: table.name, qr_token: table.qr_token, url: `${restoPublicUrl()}/t/${table.qr_token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resto/tables/:id/qr/reset — owner-only, since it invalidates a
// printed sticker immediately.
router.post('/tables/:id/qr/reset', auth, requireRole('owner'), gate, async (req, res) => {
  try {
    const newToken = crypto.randomBytes(32).toString('hex');
    const { rows: [table] } = await db.query(
      `UPDATE restaurant_tables SET qr_token = $1, qr_token_rotated_at = NOW()
        WHERE id = $2 AND property_id = $3 RETURNING id, name, qr_token`,
      [newToken, req.params.id, req.propertyId]
    );
    if (!table) return res.status(404).json({ error: 'Table not found' });
    res.json({ qr_token: table.qr_token, url: `${restoPublicUrl()}/t/${table.qr_token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resto/stream — SSE for the resto staff app (confirm queue + table
// board). Query-token auth since EventSource can't set custom headers.
// Sends a REAL data: heartbeat event (not kitchen.js's invisible SSE-comment
// form) so useResilientEventSource's staleness watchdog can see it.
router.get('/stream', authQueryToken, gate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const key = 'resto:' + req.propertyId;
  sse.addClient(key, res);

  const heartbeat = setInterval(() => {
    try { res.write('data: {"type":"heartbeat"}\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(key, res);
  });
});

module.exports = router;
