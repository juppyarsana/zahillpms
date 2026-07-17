const router = require('express').Router();
const db = require('../db');
const authDisplay = require('../middleware/authDisplay');
const mqttClient = require('../mqtt');
const sse = require('../sse');
const { getWeather } = require('../weather');

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
      `SELECT id, title, body, category, meta, image_url
       FROM guest_board_cards
       WHERE active = true AND property_id = $1
       ORDER BY
         CASE category WHEN 'notice' THEN 0 WHEN 'activity' THEN 1 WHEN 'dining' THEN 2 WHEN 'property' THEN 3 END,
         sort_order, id`,
      [unit.property_id]
    );

    const weather = await getWeather();

    res.json({
      unit: { id: unit.id, name: unit.name, controller_id: unit.controller_id },
      controller: { connected: unit.connected ?? false, rgb: unit.rgb ?? {}, last_seen: unit.last_seen },
      booking: bookingRows[0] || null,
      relays: relayRows,
      cards: cardRows,
      weather,
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

module.exports = router;
