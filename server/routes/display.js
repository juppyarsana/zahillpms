const router = require('express').Router();
const db = require('../db');
const authDisplay = require('../middleware/authDisplay');
const moduleGuard = require('../middleware/moduleGuard');
const mqttClient = require('../mqtt');
const sse = require('../sse');
const { getWeather } = require('../weather');
const salesService = require('../services/salesService');
const activityBookingService = require('../services/activityBookingService');
const telegramService = require('../services/telegramService');
const roomCheck = require('../services/roomCheckService');
const posRoomOrders = require('../services/posRoomOrders');
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
              -- short area ("Kintamani, Bali") reads better on a display than the full street address
              COALESCE(NULLIF(TRIM(ps.market_area), ''), ps.property_address) AS location
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

    // The Dining tab only makes sense if there's F&B to order — since
    // migration 067 the sales module also carries hotel extras (extra bed,
    // transfers, …) that guests never self-order from the tablet.
    const { rows: [fnbRow] } = await db.query(
      'SELECT EXISTS (SELECT 1 FROM products WHERE property_id = $1 AND is_available = true AND category = ANY($2)) AS has_fnb',
      [unit.property_id, salesService.FNB_CATEGORIES]
    );

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
      // Dining orders from the POS when its link is set (migration 094),
      // otherwise from the PMS's own food menu as before.
      orderingEnabled: posRoomOrders.linked(await posRoomOrders.config(unit.property_id))
        || ((enabledModules.get('sales') || false) && fnbRow.has_fnb),
      activitiesEnabled: enabledModules.get('activities') || false,
      roomControllerEnabled: enabledModules.get('room_controller') || false,
      callingEnabled: enabledModules.get('calling') || false,
      operationsEnabled: enabledModules.get('operations') || false,
      // Room check / minibar (migration 091): the tablet shows a discreet
      // Housekeeping entry when the property has a PIN (never sent here), and
      // marks it when front desk is waiting for this room.
      roomCheck: {
        enabled: !!(await roomCheck.pinFor(req.propertyId)),
        requested: !!(await roomCheck.openRequestForUnit(req.propertyId, unit.id)),
      },
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
      telegramService.sendAlert(req.propertyId, 'alert_guest_requests', `🧹 <b>Clean Room requested</b>

🛏 ${telegramService.escapeHtml(unit.name)}`, { html: true }).catch(() => {});
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
    telegramService.sendAlert(req.propertyId, 'alert_guest_requests', `🔕 <b>Do Not Disturb</b>

🛏 ${telegramService.escapeHtml(unit.name)}`, { html: true }).catch(() => {});
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

// ─── Dining through the POS (migration 094) ──────────────────
// When the POS link is set, the tablet's Dining menu, orders and their status
// come from the POS (see services/posRoomOrders.js). The PMS decides who pays:
// only a room with a checked-in guest can order, and the order goes to the POS
// with that stay's booking — the tablet never chooses.
async function posLinkFor(req) {
  const cfg = await posRoomOrders.config(req.propertyId);
  return posRoomOrders.linked(cfg) ? cfg : null;
}
async function checkedInStay(propertyId, roomId) {
  const { rows: [r] } = await db.query(
    `SELECT u.id AS unit_id, u.name AS room, b.id AS booking_id, g.name AS guest_name
     FROM units u
     LEFT JOIN bookings b ON b.unit_id = u.id AND b.status = 'checked_in'
     LEFT JOIN guests g ON g.id = b.guest_id
     WHERE u.controller_id = $1 AND u.property_id = $2
     ORDER BY b.check_in_date DESC NULLS LAST LIMIT 1`, [roomId, propertyId]);
  return r || null;
}
function posFail(res, err) {
  if (err instanceof posRoomOrders.PosError) {
    return res.status(err.status === 503 ? 503 : err.status >= 500 ? 502 : err.status).json({ error: err.message, code: err.code });
  }
  res.status(500).json({ error: err.message });
}
const POS_CLOSED_MSG = {
  off: 'Room service ordering is not available — please call the front desk',
  paused: 'Room service is paused right now — please call the front desk',
  closed: 'Room service is closed now — please call the front desk',
};

// GET /api/display/room/:roomId/menu — guest self-ordering menu. From the POS
// (when linked): { source: 'pos', status, message, hours, items, prices };
// otherwise the PMS's own food products (an array, as before).
router.get('/room/:roomId/menu', authDisplay, async (req, res, next) => {
  try {
    const cfg = await posLinkFor(req);
    if (!cfg) return next();
    const stay = await checkedInStay(req.propertyId, req.params.roomId);
    if (!stay) return res.status(404).json({ error: 'Room not found' });
    const m = await posRoomOrders.menu(cfg);
    res.set('Cache-Control', 'no-store');
    res.json({
      source: 'pos',
      status: m.status,
      message: POS_CLOSED_MSG[m.status] || null,
      hours: m.hours || null,
      // nett: the POS item's price already includes service & tax (nothing added on top)
      items: (m.menu || []).map(i => ({ id: i.id, name: i.name, category: i.cat || 'Menu', description: i.sub || '', emoji: i.emoji || '', price: i.price, nett: !!i.nett })),
      prices: m.prices || { include: true, service: 0, tax: 0 },
      // how the guest may pay: 'room' (charged to the room) + cash / card on delivery
      payments: Array.isArray(m.payments) ? m.payments : ['room'],
    });
  } catch (err) { posFail(res, err); }
});

router.get('/room/:roomId/menu', authDisplay, salesGate, async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });

    // "Order Food" is a food/drinks menu, not a general catalog browser —
    // scope it to those categories so a front-desk ancillary item (extra
    // bed, merchandise) never shows up as something a guest can "order" to
    // their room. Same filter as routes/resto.js / routes/restoGuest.js.
    const { rows: products } = await db.query(
      `SELECT id, name, category, price, description
       FROM products
       WHERE property_id = $1 AND is_available = true AND (track_stock = false OR stock_quantity > 0)
         AND category = ANY($2)
       ORDER BY category, name`,
      [req.propertyId, salesService.FNB_CATEGORIES]
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
// Through the POS: { items: [{ product_id, quantity, note? }], note?, client_ref,
// payment: 'room' (default) | 'cash' | 'card' — cash / card are paid on
// delivery: the POS leaves the bill open and staff bring it.
// — the POS answers pending (staff accept first) or accepted (straight to the
// kitchen); either way it is charged to the room only once the kitchen has it.
router.post('/room/:roomId/order', authDisplay, async (req, res, next) => {
  try {
    const cfg = await posLinkFor(req);
    if (!cfg) return next();
    const { items, note } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });
    const stay = await checkedInStay(req.propertyId, req.params.roomId);
    if (!stay) return res.status(404).json({ error: 'Room not found' });
    if (!stay.booking_id) return res.status(409).json({ error: 'Ordering opens once you are checked in — please call the front desk', code: 'NOT_CHECKED_IN' });
    const clientRef = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.body.client_ref || ''))
      ? String(req.body.client_ref)
      : require('crypto').randomBytes(12).toString('hex');
    const r = await posRoomOrders.placeOrder(cfg, {
      clientRef, booking_id: stay.booking_id, room: stay.room, guest: stay.guest_name,
      items: items.map(i => ({ menuItemId: i.product_id, qty: parseInt(i.quantity, 10) || 0, note: i.note || '' })),
      note: note || '',
      payment: ['room', 'cash', 'card'].includes(req.body.payment) ? req.body.payment : 'room',
    });
    res.status(r.replayed ? 200 : 201).json({ ok: true, total: r.total, payment: r.payment || 'room',
      status: r.status === 'pending' ? 'pending_confirmation' : 'accepted' });
  } catch (err) { posFail(res, err); }
});

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
      'SELECT id, price FROM products WHERE id = ANY($1) AND property_id = $2 AND is_available = true AND category = ANY($3)',
      [productIds, req.propertyId, salesService.FNB_CATEGORIES]
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
    if (result.code) return res.status(400).json({ error: result.error, code: result.code });
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

    // Orders sent to the POS (migration 094) — for the guest checked in now.
    // A POS that can't be reached just leaves them out (the rest still shows).
    let posOrders = [];
    const cfg = await posRoomOrders.config(req.propertyId);
    if (posRoomOrders.linked(cfg)) {
      const stay = await checkedInStay(req.propertyId, roomId);
      if (stay?.booking_id) {
        try {
          const list = await posRoomOrders.ordersFor(cfg, stay.booking_id);
          const recent = o => Date.now() - new Date(o.decidedAt || o.createdAt).getTime() < 60 * 60 * 1000;
          posOrders = list.map(o => ({
            id: o.id,
            total_amount: o.total,
            created_at: o.createdAt,
            items: (o.items || []).map(i => ({ name: i.name, quantity: i.qty })),
            confirmation_status: o.status === 'pending' ? 'pending' : o.status === 'rejected' ? 'rejected'
              : o.status === 'voided' ? 'cancelled' : 'confirmed',
            rejection_reason: o.reason || null,
            // Delivered when the runner taps it in the POS (or a cash / card
            // bill is closed); otherwise "Being prepared" for an hour after Accept.
            kitchen_status: o.status !== 'accepted' ? null : o.deliveredAt ? 'served' : recent(o) ? 'preparing' : 'accepted',
            payment: o.payment || 'room',
            paid: !!o.paidAt,
            source: 'pos',
          }));
        } catch (_) { /* POS down — show the rest */ }
      }
    }

    const { rows: bookingRows } = await db.query(
      `SELECT id FROM bookings
       WHERE unit_id = $1 AND status IN ('confirmed', 'checked_in')
         AND check_in_date <= CURRENT_DATE AND check_out_date >= CURRENT_DATE
       ORDER BY check_in_date DESC LIMIT 1`,
      [unitRows[0].id]
    );
    if (!bookingRows[0]) return res.json({ foodOrders: posOrders, activityBookings: [] });
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

    res.json({ foodOrders: [...posOrders, ...foodOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), activityBookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Room check / minibar (migration 091) ─────────────────────
// Housekeeping's discreet entry on the room tablet. Every call carries the
// property's housekeeping PIN (the guest may be using the tablet); a wrong
// PIN is 403. See services/roomCheckService.js.
async function roomCheckUnit(req, res) {
  const pin = await roomCheck.pinFor(req.propertyId);
  if (!pin) { res.status(409).json({ error: 'Housekeeping PIN is not set — the owner sets it in Property Details', code: 'NO_PIN' }); return null; }
  if (String(req.body?.pin || '') !== pin) { res.status(403).json({ error: 'Wrong PIN', code: 'WRONG_PIN' }); return null; }
  const { rows: [unit] } = await db.query('SELECT id, name FROM units WHERE controller_id = $1 AND property_id = $2', [req.params.roomId, req.propertyId]);
  if (!unit) { res.status(404).json({ error: 'Room not found' }); return null; }
  return unit;
}

// POST /room/:roomId/room-check/open { pin } — the minibar list + whether
// front desk is waiting for this room.
router.post('/room/:roomId/room-check/open', authDisplay, async (req, res) => {
  try {
    const unit = await roomCheckUnit(req, res);
    if (!unit) return;
    const [items, open, stay] = await Promise.all([
      roomCheck.minibarItems(req.propertyId), roomCheck.openRequestForUnit(req.propertyId, unit.id), roomCheck.stayForUnit(req.propertyId, unit.id)]);
    res.json({ room: unit.name, items, requested: !!open, has_stay: !!stay || !!open });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /room/:roomId/room-check { pin, items: [{ product_id, quantity }], note }
router.post('/room/:roomId/room-check', authDisplay, async (req, res) => {
  try {
    const unit = await roomCheckUnit(req, res);
    if (!unit) return;
    const check = await roomCheck.submit(req.propertyId, { unitId: unit.id, items: req.body.items, note: req.body.note, via: 'tablet' });
    sse.notify(req.params.roomId, { type: 'room_check' });
    res.status(201).json({ id: check.id, total: check.total, items: check.items.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

module.exports = router;
