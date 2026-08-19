const router = require('express').Router();
const db = require('../db');
const authDisplay = require('../middleware/authDisplay');
const moduleGuard = require('../middleware/moduleGuard');
const mqttClient = require('../mqtt');
const sse = require('../sse');
const { getWeather } = require('../weather');
const salesService = require('../services/salesService');
const activityBookingService = require('../services/activityBookingService');
const salesGate = moduleGuard('sales');
const activitiesGate = moduleGuard('activities');

// GET /api/display/room/:roomId/state
// roomId = controller_id (e.g. "1")
router.get('/room/:roomId/state', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows: unitRows } = await db.query(
      `SELECT u.id, u.name, u.controller_id, u.property_id,
              rcs.connected, rcs.rgb, rcs.last_seen
       FROM units u
       LEFT JOIN room_controller_status rcs ON rcs.controller_id = u.controller_id
       WHERE u.controller_id = $1 AND u.property_id = $2`,
      [roomId, req.propertyId]
    );
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });
    const unit = unitRows[0];

    const { rows: bookingRows } = await db.query(
      `SELECT b.id, g.name AS guest_name, b.check_in_date, b.check_out_date, b.num_guests, b.special_requests
       FROM bookings b
       JOIN guests g ON g.id = b.guest_id
       WHERE b.unit_id = $1
         AND b.status IN ('confirmed', 'checked_in')
         AND b.check_in_date <= CURRENT_DATE
         AND b.check_out_date >= CURRENT_DATE
       ORDER BY b.check_in_date DESC
       LIMIT 1`,
      [unit.id]
    );

    const { rows: relayRows } = await db.query(
      `SELECT relay_num, label, icon, state, enabled
       FROM unit_relays
       WHERE unit_id = $1
       ORDER BY relay_num`,
      [unit.id]
    );

    const { rows: cardRows } = await db.query(
      `SELECT c.id, c.title, c.body, c.category, c.meta, c.image_url,
              CASE WHEN a.is_available THEN a.id END AS activity_id,
              CASE WHEN a.is_available THEN a.price END AS activity_price
       FROM guest_board_cards c
       LEFT JOIN activities a ON a.id = c.activity_id
       WHERE c.active = true AND c.property_id = $1
       ORDER BY
         CASE c.category WHEN 'notice' THEN 0 WHEN 'activity' THEN 1 WHEN 'dining' THEN 2 WHEN 'property' THEN 3 END,
         c.sort_order, c.id`,
      [unit.property_id]
    );

    const { rows: propertyRows } = await db.query(
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.logo_url, ps.brand_color
       FROM properties p
       LEFT JOIN property_settings ps ON ps.property_id = p.id
       WHERE p.id = $1`,
      [unit.property_id]
    );

    const { rows: moduleRows } = await db.query(
      'SELECT module, is_enabled FROM property_modules WHERE property_id = $1 AND module = ANY($2)',
      [unit.property_id, ['sales', 'activities', 'room_controller', 'calling']]
    );
    const enabledModules = new Map(moduleRows.map(m => [m.module, m.is_enabled]));

    const weather = await getWeather();

    res.json({
      unit: { id: unit.id, name: unit.name, controller_id: unit.controller_id },
      controller: { connected: unit.connected ?? false, rgb: unit.rgb ?? {}, last_seen: unit.last_seen },
      booking: bookingRows[0] || null,
      relays: relayRows,
      cards: cardRows,
      weather,
      property: propertyRows[0] || null,
      orderingEnabled: enabledModules.get('sales') || false,
      activitiesEnabled: enabledModules.get('activities') || false,
      roomControllerEnabled: enabledModules.get('room_controller') || false,
      callingEnabled: enabledModules.get('calling') || false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/display/room/:roomId/stream — SSE for real-time state updates
// Auth via ?token= query param (EventSource can't send Authorization header)
router.get('/room/:roomId/stream', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
  if (!rows[0]) return res.status(404).json({ error: 'Room not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx response buffering
  res.flushHeaders();

  sse.addClient(roomId, res);

  // Keep-alive comment every 25s to survive Nginx / proxy idle timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(roomId, res);
  });
});

// POST /api/display/room/:roomId/relay
// Body: { relay_num, state: true|false }
router.post('/room/:roomId/relay', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  const { relay_num, state } = req.body;
  if (relay_num == null || state == null) {
    return res.status(400).json({ error: 'relay_num and state required' });
  }
  try {
    const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
    const topic = `zahill/room/${roomId}/relay/${relay_num}/set`;
    try {
      await mqttClient.publish(topic, state ? 'on' : 'off');
    } catch (mqttErr) {
      console.warn('[DISPLAY] MQTT publish failed:', mqttErr.message);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/display/room/:roomId/rgb
// Body: { r, g, b }
router.post('/room/:roomId/rgb', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  const { r, g, b } = req.body;
  if (r == null || g == null || b == null) {
    return res.status(400).json({ error: 'r, g, b required' });
  }
  try {
    const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
    const topic = `zahill/room/${roomId}/rgb/set`;
    try {
      await mqttClient.publish(topic, JSON.stringify({ r, g, b }));
    } catch (mqttErr) {
      console.warn('[DISPLAY] MQTT publish failed:', mqttErr.message);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/display/room/:roomId/ir
// Body: { slot: 0-4 }
router.post('/room/:roomId/ir', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  const { slot } = req.body;
  if (slot == null || slot < 0 || slot > 4) {
    return res.status(400).json({ error: 'slot must be 0–4' });
  }
  try {
    const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
    const topic = `zahill/room/${roomId}/ir/send`;
    try {
      await mqttClient.publish(topic, String(slot));
    } catch (mqttErr) {
      console.warn('[DISPLAY] MQTT publish failed:', mqttErr.message);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/display/room/:roomId/menu — guest self-ordering menu
router.get('/room/:roomId/menu', authDisplay, salesGate, async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });

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

// POST /api/display/room/:roomId/order — guest places a room-service order
// Body: { items: [{ product_id, quantity }] }
// Prices are looked up server-side, not trusted from the request — unlike
// the staff POS (routes/sales.js), this endpoint is reachable by a guest
// device, so it must not accept a client-supplied unit_price.
router.post('/room/:roomId/order', authDisplay, salesGate, async (req, res) => {
  const { roomId } = req.params;
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }
  try {
    const { rows: unitRows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });

    const { rows: bookingRows } = await db.query(
      `SELECT id FROM bookings
       WHERE unit_id = $1 AND status IN ('confirmed', 'checked_in')
         AND check_in_date <= CURRENT_DATE AND check_out_date >= CURRENT_DATE
       ORDER BY check_in_date DESC LIMIT 1`,
      [unitRows[0].id]
    );
    if (!bookingRows[0]) return res.status(404).json({ error: 'No active stay found for this room' });

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
      bookingId: bookingRows[0].id,
      paymentMethod: 'room_charge',
      orderType: 'room_service',
      items: pricedItems,
      servedBy: null,
    });
    if (result.code === 'OUT_OF_STOCK') return res.status(409).json({ error: result.error, code: result.code, items: result.items });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json({ ok: true, total: result.sale.total_amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/display/room/:roomId/activities — guest-bookable activity catalog
router.get('/room/:roomId/activities', authDisplay, activitiesGate, async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });

    const { rows: activities } = await db.query(
      `SELECT id, name, category, description, price, duration_minutes
       FROM activities
       WHERE property_id = $1 AND is_available = true
       ORDER BY sort_order, name`,
      [req.propertyId]
    );
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/display/room/:roomId/activities/book — guest requests an activity
// Body: { activity_id, scheduled_date, scheduled_time, num_participants, notes }
// Always creates a 'requested' booking, never auto-confirmed — see
// activityBookingService for why. Price is resolved server-side there, same
// guest-device-reachable caution as the F&B order endpoint above.
router.post('/room/:roomId/activities/book', authDisplay, activitiesGate, async (req, res) => {
  const { roomId } = req.params;
  const { activity_id, scheduled_date, scheduled_time, num_participants, notes } = req.body;
  if (!activity_id || !scheduled_date) return res.status(400).json({ error: 'activity_id and scheduled_date required' });
  try {
    const { rows: unitRows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });

    const { rows: bookingRows } = await db.query(
      `SELECT id FROM bookings
       WHERE unit_id = $1 AND status IN ('confirmed', 'checked_in')
         AND check_in_date <= CURRENT_DATE AND check_out_date >= CURRENT_DATE
       ORDER BY check_in_date DESC LIMIT 1`,
      [unitRows[0].id]
    );
    if (!bookingRows[0]) return res.status(404).json({ error: 'No active stay found for this room' });

    const result = await activityBookingService.createBooking(req.propertyId, {
      activityId: activity_id,
      bookingId: bookingRows[0].id,
      scheduledDate: scheduled_date,
      scheduledTime: scheduled_time,
      numParticipants: num_participants,
      paymentMethod: 'room_charge',
      notes,
      bookedVia: 'guest_self',
      autoConfirm: false,
    });
    if (result.code === 'CAPACITY_FULL') return res.status(409).json({ error: result.error, code: result.code });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/display/room/:roomId/orders — guest's own food orders + activity
// bookings for the current stay, so a placed order/request isn't a one-time
// toast that vanishes — the guest can check back on status. Not module-gated
// (read-only, scoped to the guest's own stay); each section is just empty if
// that module was never on.
router.get('/room/:roomId/orders', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows: unitRows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });

    const { rows: bookingRows } = await db.query(
      `SELECT id FROM bookings
       WHERE unit_id = $1 AND status IN ('confirmed', 'checked_in')
         AND check_in_date <= CURRENT_DATE AND check_out_date >= CURRENT_DATE
       ORDER BY check_in_date DESC LIMIT 1`,
      [unitRows[0].id]
    );
    if (!bookingRows[0]) return res.json({ foodOrders: [], activityBookings: [] });
    const bookingId = bookingRows[0].id;

    const { rows: foodOrders } = await db.query(
      `SELECT s.id, s.total_amount, s.kitchen_status, s.created_at,
              COALESCE(json_agg(json_build_object('name', p.name, 'quantity', si.quantity) ORDER BY si.id) FILTER (WHERE si.id IS NOT NULL), '[]') AS items
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.booking_id = $1 AND s.property_id = $2 AND s.order_type = 'room_service'
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      [bookingId, req.propertyId]
    );

    const { rows: activityBookings } = await db.query(
      `SELECT ab.id, ab.scheduled_date, ab.scheduled_time, ab.num_participants, ab.status, ab.total_amount, ab.created_at,
              a.name AS activity_name
       FROM activity_bookings ab
       JOIN activities a ON a.id = ab.activity_id
       WHERE ab.booking_id = $1 AND ab.property_id = $2
       ORDER BY ab.created_at DESC`,
      [bookingId, req.propertyId]
    );

    res.json({ foodOrders, activityBookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
