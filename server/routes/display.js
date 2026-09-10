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
const opsGate = moduleGuard('operations');

// --- Telemetry field coercion (POST /room/:roomId/telemetry) ---------------
const clampInt = (v, lo, hi) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : undefined;
};
const clampNum = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : undefined;
};
const asBool = (v) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined);
const asEnum = (v, allowed) => (allowed.includes(v) ? v : undefined);
const asStr = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const cleanSsid = (v) => {
  const s = asStr(v, 66);
  if (!s) return undefined;
  const u = s.replace(/^"|"$/g, '');
  return (u === '<unknown ssid>' || u === '0x' || !u) ? null : u.slice(0, 64);
};
const cleanBssid = (v) => {
  const s = asStr(v, 17);
  return (!s || s === '02:00:00:00:00:00') ? null : s;
};

// Only these body keys are ever written. Absent key -> row value untouched
// (partial payloads are fine). Present-but-invalid -> silently dropped.
// Explicit null -> written through (clears the column).
const TELEMETRY_FIELDS = {
  battery_level: (v) => clampInt(v, 0, 100),
  battery_charging: asBool,
  power_source: (v) => asEnum(v, ['ac', 'usb', 'wireless', 'none']),
  battery_temp_c: (v) => clampNum(v, -20, 100),
  network_type: (v) => asEnum(v, ['wifi', 'ethernet', 'cellular', 'none']),
  internet_ok: asBool,
  wifi_ssid: cleanSsid,
  wifi_bssid: cleanBssid,
  wifi_rssi: (v) => clampInt(v, -120, 0),
  wifi_link_speed_mbps: (v) => clampInt(v, 0, 10000),
  wifi_frequency_mhz: (v) => clampInt(v, 0, 7200),
  ip_address: (v) => asStr(v, 45),
  storage_free_mb: (v) => clampInt(v, 0, 50000000),
  storage_total_mb: (v) => clampInt(v, 0, 50000000),
  uptime_seconds: (v) => clampInt(v, 0, 4000000000),
  app_version: (v) => asStr(v, 32),
  webview_version: (v) => asStr(v, 64),
  android_version: (v) => asStr(v, 32),
  device_model: (v) => asStr(v, 64),
  screen_on: asBool,
};

// GET /api/display/room/:roomId/state
// roomId = controller_id (e.g. "1")
router.get('/room/:roomId/state', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows: unitRows } = await db.query(
      `SELECT u.id, u.name, u.controller_id, u.property_id, u.bed_config,
              u.housekeeping_status,
              rcs.connected, rcs.rgb, rcs.last_seen
       FROM units u
       LEFT JOIN room_controller_status rcs ON rcs.controller_id = u.controller_id
       WHERE u.controller_id = $1 AND u.property_id = $2`,
      [roomId, req.propertyId]
    );
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });
    const unit = unitRows[0];

    const { rows: bookingRows } = await db.query(
      `SELECT b.id, g.name AS guest_name, b.check_in_date, b.check_out_date, b.num_guests, b.special_requests, b.bed_preference
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
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.logo_url, ps.brand_color,
              ps.property_address AS location
       FROM properties p
       LEFT JOIN property_settings ps ON ps.property_id = p.id
       WHERE p.id = $1`,
      [unit.property_id]
    );

    const { rows: moduleRows } = await db.query(
      'SELECT module, is_enabled FROM property_modules WHERE property_id = $1 AND module = ANY($2)',
      [unit.property_id, ['sales', 'activities', 'room_controller', 'calling', 'operations']]
    );
    const enabledModules = new Map(moduleRows.map(m => [m.module, m.is_enabled]));

    // Oldest unread message first — so a burst of sends doesn't skip earlier
    // ones; the next poll picks up the next one after this one's dismissed.
    const { rows: messageRows } = await db.query(
      `SELECT id, body, created_at FROM guest_messages
       WHERE unit_id = $1 AND read_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [unit.id]
    );

    const weather = await getWeather();

    // Polling fallback for the calls SSE stream — a staff-to-room call that
    // arrived while the room's calls SSE connection was silently dead would
    // otherwise just ring out and get marked missed with the tablet never
    // showing anything. This is the same "state poll doubles as a
    // guarantee" pattern the `message` field above already uses.
    const { rows: incomingCallRows } = await db.query(
      `SELECT c.id, u_staff.name AS staff_name
       FROM calls c
       LEFT JOIN users u_staff ON u_staff.id = c.initiated_by
       WHERE c.unit_id = $1 AND c.status = 'ringing' AND c.direction = 'staff_to_room'
       ORDER BY c.created_at ASC LIMIT 1`,
      [unit.id]
    );

    res.json({
      unit: { id: unit.id, name: unit.name, controller_id: unit.controller_id, bed_config: unit.bed_config, housekeeping_status: unit.housekeeping_status },
      controller: { connected: unit.connected ?? false, rgb: unit.rgb ?? {}, last_seen: unit.last_seen },
      booking: bookingRows[0] || null,
      relays: relayRows,
      cards: cardRows,
      message: messageRows[0] || null,
      incomingCall: incomingCallRows[0] ? { callId: incomingCallRows[0].id, staffName: incomingCallRows[0].staff_name } : null,
      weather,
      property: propertyRows[0] || null,
      orderingEnabled: enabledModules.get('sales') || false,
      activitiesEnabled: enabledModules.get('activities') || false,
      roomControllerEnabled: enabledModules.get('room_controller') || false,
      callingEnabled: enabledModules.get('calling') || false,
      operationsEnabled: enabledModules.get('operations') || false,
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

  // Heartbeat every 25s — survives Nginx/proxy idle timeouts AND, sent as a
  // real `data:` event (not an SSE comment, which onmessage never sees),
  // lets the client detect a silently-dead connection and force a reconnect
  // instead of trusting the browser's own retry to notice in time.
  const heartbeat = setInterval(() => {
    try { res.write('data: {"type":"heartbeat"}\n\n'); } catch {}
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

// POST /api/display/room/:roomId/telemetry
// Room Display Kiosk APK -> device health. Its own channel, NOT piggybacked
// on GET /state's poll: a direct APK POST still reports "tablet alive,
// battery 12%" when the web app fails to load. last_seen_at is the heartbeat.
// Body: any subset of TELEMETRY_FIELDS. Empty body still bumps last_seen_at.
router.post('/room/:roomId/telemetry', authDisplay, async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows } = await db.query(
      'SELECT id FROM units WHERE controller_id = $1 AND property_id = $2',
      [roomId, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });

    const body = req.body || {};
    const cols = [];
    const vals = [];
    for (const [key, coerce] of Object.entries(TELEMETRY_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const raw = body[key];
      const clean = raw === null ? null : coerce(raw);
      if (clean === undefined) continue;
      cols.push(key);
      vals.push(clean);
    }

    // Dynamic column list — a fixed SQL string would null out every column
    // the tablet didn't send on this particular POST.
    const insertCols = ['property_id', 'controller_id', ...cols, 'last_seen_at', 'updated_at'];
    const placeholders = ['$1', '$2', ...cols.map((_, i) => `$${i + 3}`), 'NOW()', 'NOW()'];
    const setClauses = [
      ...cols.map((c) => `${c} = EXCLUDED.${c}`),
      'last_seen_at = NOW()',
      'updated_at = NOW()',
    ];
    await db.query(
      `INSERT INTO room_display_devices (${insertCols.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (property_id, controller_id) DO UPDATE SET ${setClauses.join(', ')}`,
      [req.propertyId, roomId, ...vals]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/display/room/:roomId/housekeeping
// Guest self-service requests ('dnd' / 'clean') surfaced on the Operations
// kanban as tasks, PLUS staff housekeeping actions ('mark_clean' /
// 'mark_dirty') that flip units.housekeeping_status directly.
// Body: { type: 'dnd' | 'clean' | 'mark_clean' | 'mark_dirty', action?, task_id? }
// 'clean' is one-shot — staff just mark it done whenever they get to it, no
// guest-side cancel. 'dnd' is a toggle: 'request' opens a task, 'cancel'
// marks that same task done — the device round-trips task_id through its
// own localStorage (see QuickActions.jsx), same convention as roomId/token.
// 'mark_clean'/'mark_dirty' are the housekeeper's "Mark Room Clean" button
// (behind a confirm on the tablet) — set the room condition and, on clean,
// close any open housekeeping work order.
router.post('/room/:roomId/housekeeping', authDisplay, opsGate, async (req, res) => {
  const { roomId } = req.params;
  const { type, action, task_id } = req.body;
  if (!['dnd', 'clean', 'mark_clean', 'mark_dirty'].includes(type)) {
    return res.status(400).json({ error: 'type must be dnd, clean, mark_clean or mark_dirty' });
  }
  try {
    const { rows: unitRows } = await db.query('SELECT id, name FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });
    const unit = unitRows[0];

    if (type === 'mark_clean' || type === 'mark_dirty') {
      const next = type === 'mark_clean' ? 'clean' : 'dirty';
      await db.query(
        'UPDATE units SET housekeeping_status = $1, housekeeping_updated_at = NOW() WHERE id = $2 AND property_id = $3',
        [next, unit.id, req.propertyId]
      );
      if (next === 'clean') {
        await db.query(
          `UPDATE tasks SET status = 'done', updated_at = NOW()
           WHERE unit_id = $1 AND property_id = $2 AND type = 'housekeeping' AND status <> 'done'`,
          [unit.id, req.propertyId]
        );
      }
      sse.notify(roomId, { type: 'housekeeping' });
      return res.json({ ok: true, housekeeping_status: next });
    }

    if (type === 'clean') {
      const { rows } = await db.query(
        `INSERT INTO tasks (title, type, priority, unit_id, property_id)
         VALUES ($1, 'guest_request', 'medium', $2, $3) RETURNING id`,
        [`Please clean room — ${unit.name}`, unit.id, req.propertyId]
      );
      return res.status(201).json({ ok: true, task_id: rows[0].id });
    }

    if (action === 'cancel') {
      if (!task_id) return res.status(400).json({ error: 'task_id required to cancel' });
      const { rows } = await db.query(
        `UPDATE tasks SET status = 'done', updated_at = NOW()
         WHERE id = $1 AND unit_id = $2 AND property_id = $3 RETURNING id`,
        [task_id, unit.id, req.propertyId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
      return res.json({ ok: true });
    }

    const { rows } = await db.query(
      `INSERT INTO tasks (title, type, priority, unit_id, property_id)
       VALUES ($1, 'guest_request', 'high', $2, $3) RETURNING id`,
      [`Do Not Disturb — ${unit.name}`, unit.id, req.propertyId]
    );
    res.status(201).json({ ok: true, task_id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/display/room/:roomId/message/:messageId/dismiss — guest dismisses
// a front-desk message shown on the full-screen overlay
router.post('/room/:roomId/message/:messageId/dismiss', authDisplay, async (req, res) => {
  const { roomId, messageId } = req.params;
  try {
    const { rows: unitRows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });
    const { rows } = await db.query(
      `UPDATE guest_messages SET read_at = NOW()
       WHERE id = $1 AND unit_id = $2 AND property_id = $3 RETURNING id`,
      [messageId, unitRows[0].id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Message not found' });
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
      holdForConfirmation: true, // resto staff confirm before it fires to the kitchen — see routes/resto.js
      orderSource: 'room_display',
    });
    if (result.code === 'OUT_OF_STOCK') return res.status(409).json({ error: result.error, code: result.code, items: result.items });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json({ ok: true, total: result.sale.total_amount, status: 'pending_confirmation' });
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
      `SELECT s.id, s.total_amount, s.kitchen_status, s.confirmation_status, s.rejection_reason, s.created_at,
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
