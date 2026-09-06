const router = require('express').Router();
const db = require('../db');
const authDisplay = require('../middleware/authDisplay');
const auth = require('../middleware/auth');
const authQueryToken = require('../middleware/authQueryToken');
const moduleGuard = require('../middleware/moduleGuard');
const sse = require('../sse');
const { getTurnCredentials } = require('../services/turnCredentials');
const gate = moduleGuard('calling');

const staffChannel = (propertyId) => `staff:broadcast:${propertyId}`;
const RING_TIMEOUT_MS = 45_000;
const ringTimeouts = new Map(); // callId -> timeout handle

function clearRingTimeout(callId) {
  const handle = ringTimeouts.get(callId);
  if (handle) {
    clearTimeout(handle);
    ringTimeouts.delete(callId);
  }
}

// Calls have no property_id column of their own — always resolved via their unit.
async function getCallUnit(callId) {
  const { rows } = await db.query(
    `SELECT u.id, u.controller_id, u.property_id FROM calls c JOIN units u ON u.id = c.unit_id WHERE c.id = $1`,
    [callId]
  );
  return rows[0] || null;
}

async function markMissed(callId) {
  ringTimeouts.delete(callId);
  const { rows } = await db.query(
    `UPDATE calls SET status = 'missed' WHERE id = $1 AND status = 'ringing' RETURNING *`,
    [callId]
  );
  if (!rows[0]) return;
  const unit = await getCallUnit(callId);
  if (unit?.controller_id) sse.notify('room:' + unit.controller_id, { type: 'missed', callId });
  if (unit?.property_id) sse.notify(staffChannel(unit.property_id), { type: 'missed', callId });
}

// GET /api/calls/turn-credentials — staff side. Short-lived (1h) TURN
// credentials, minted fresh per request rather than a static secret shipped
// in the bundle — see services/turnCredentials.js. Returns an empty list
// (STUN-only fallback) until TURN_SECRET/TURN_URLS are configured.
router.get('/turn-credentials', auth, gate, (req, res) => {
  const creds = getTurnCredentials(req.propertyId);
  res.json({ iceServers: creds ? [creds] : [] });
});

// GET /api/calls/room/:roomId/turn-credentials — room display side
router.get('/room/:roomId/turn-credentials', authDisplay, gate, async (req, res) => {
  const { roomId } = req.params;
  const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
  if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
  const creds = getTurnCredentials(req.propertyId);
  res.json({ iceServers: creds ? [creds] : [] });
});

// POST /api/calls — room places a call
// Body: { roomId } (controller_id)
router.post('/', authDisplay, gate, async (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  try {
    const { rows: unitRows } = await db.query(
      'SELECT id, name, property_id FROM units WHERE controller_id = $1 AND property_id = $2',
      [roomId, req.propertyId]
    );
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });
    const unit = unitRows[0];

    // Best-effort guest name for the staff-facing incoming-call banner —
    // null for a vacant room calling (e.g. from IdleScreen), which is fine.
    const { rows: bookingRows } = await db.query(
      `SELECT g.name AS guest_name
       FROM bookings b JOIN guests g ON g.id = b.guest_id
       WHERE b.unit_id = $1 AND b.status IN ('confirmed', 'checked_in')
         AND b.check_in_date <= CURRENT_DATE AND b.check_out_date >= CURRENT_DATE
       ORDER BY b.check_in_date DESC LIMIT 1`,
      [unit.id]
    );
    const guestName = bookingRows[0]?.guest_name || null;

    const { rows } = await db.query(
      `INSERT INTO calls (unit_id) VALUES ($1) RETURNING id`,
      [unit.id]
    );
    const callId = rows[0].id;

    const handle = setTimeout(() => markMissed(callId).catch(() => {}), RING_TIMEOUT_MS);
    ringTimeouts.set(callId, handle);

    sse.notify(staffChannel(unit.property_id), { type: 'incoming_call', callId, unitName: unit.name, roomId, guestName });
    res.status(201).json({ callId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/to-room — staff calls a specific room
// Body: { unitId }
router.post('/to-room', auth, gate, async (req, res) => {
  const { unitId } = req.body;
  if (!unitId) return res.status(400).json({ error: 'unitId required' });
  try {
    const { rows: unitRows } = await db.query(
      'SELECT id, name, controller_id FROM units WHERE id = $1 AND property_id = $2',
      [unitId, req.propertyId]
    );
    if (!unitRows[0]) return res.status(404).json({ error: 'Room not found' });
    const unit = unitRows[0];
    if (!unit.controller_id) return res.status(400).json({ error: 'Room has no controller assigned' });

    const { rows } = await db.query(
      `INSERT INTO calls (unit_id, direction, initiated_by) VALUES ($1, 'staff_to_room', $2) RETURNING id`,
      [unit.id, req.user.id]
    );
    const callId = rows[0].id;

    const handle = setTimeout(() => markMissed(callId).catch(() => {}), RING_TIMEOUT_MS);
    ringTimeouts.set(callId, handle);

    sse.notify('room:' + unit.controller_id, { type: 'incoming_call_from_staff', callId, staffName: req.user.name });
    res.status(201).json({ callId, unitName: unit.name, roomId: unit.controller_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/answer-from-room — room answers a staff-initiated call
router.post('/:id/answer-from-room', authDisplay, gate, async (req, res) => {
  const { id } = req.params;
  try {
    const unit = await getCallUnit(id);
    if (!unit || unit.property_id !== req.propertyId) return res.status(404).json({ error: 'Call not found' });
    const { rows } = await db.query(
      `UPDATE calls SET status = 'answered', answered_at = NOW()
       WHERE id = $1 AND status = 'ringing' AND direction = 'staff_to_room'
       RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Call no longer ringing' });
    clearRingTimeout(id);
    sse.notify(staffChannel(unit.property_id), { type: 'answered_from_room', callId: id });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/answer — staff claims a ringing call (first click wins)
router.post('/:id/answer', auth, gate, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `UPDATE calls SET status = 'answered', answered_by = $2, answered_at = NOW()
       WHERE id = $1 AND status = 'ringing' AND direction = 'room_to_staff'
         AND unit_id IN (SELECT id FROM units WHERE property_id = $3)
       RETURNING *`,
      [id, req.user.id, req.propertyId]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Call already answered' });
    clearRingTimeout(id);

    const call = rows[0];
    const { rows: unitRows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [call.unit_id]);
    const roomId = unitRows[0]?.controller_id;

    if (roomId) sse.notify('room:' + roomId, { type: 'answered', callId: id, staffName: req.user.name });
    sse.notify(staffChannel(req.propertyId), { type: 'call_taken', callId: id, staffName: req.user.name });
    res.json(call);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/end — staff hangs up
router.post('/:id/end', auth, gate, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW()
       WHERE id = $1 AND status IN ('ringing','answered')
         AND unit_id IN (SELECT id FROM units WHERE property_id = $2)
       RETURNING *`,
      [id, req.propertyId]
    );
    if (!rows[0]) return res.json({ ok: true });
    clearRingTimeout(id);

    const { rows: unitRows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [rows[0].unit_id]);
    const roomId = unitRows[0]?.controller_id;
    if (roomId) sse.notify('room:' + roomId, { type: 'ended', callId: id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/end-from-room — room hangs up / cancels a ringing call
router.post('/:id/end-from-room', authDisplay, gate, async (req, res) => {
  const { id } = req.params;
  try {
    const unit = await getCallUnit(id);
    if (!unit || unit.property_id !== req.propertyId) return res.status(404).json({ error: 'Call not found' });
    const { rows } = await db.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW()
       WHERE id = $1 AND status IN ('ringing','answered')
       RETURNING *`,
      [id]
    );
    if (rows[0]) {
      clearRingTimeout(id);
      if (unit?.property_id) sse.notify(staffChannel(unit.property_id), { type: 'ended', callId: id });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/signal — relay a WebRTC message from staff -> room
// Body: { roomId, payload }
router.post('/:id/signal', auth, gate, async (req, res) => {
  const { id } = req.params;
  const { roomId, payload } = req.body;
  if (!roomId || !payload) return res.status(400).json({ error: 'roomId and payload required' });
  try {
    const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
    sse.notify('room:' + roomId, { type: 'signal', callId: id, payload });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/signal-from-room — relay a WebRTC message from room -> staff
// Body: { payload }
router.post('/:id/signal-from-room', authDisplay, gate, async (req, res) => {
  const { id } = req.params;
  const { payload } = req.body;
  if (!payload) return res.status(400).json({ error: 'payload required' });
  try {
    const unit = await getCallUnit(id);
    if (!unit || unit.property_id !== req.propertyId) return res.status(404).json({ error: 'Call not found' });
    sse.notify(staffChannel(unit.property_id), { type: 'signal', callId: id, payload });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calls/pending — polling fallback for the staff calls SSE stream.
// A room-to-staff call that arrived while every staff session's SSE
// connection was silently dead would otherwise just ring out unnoticed —
// CallContext.jsx polls this every ~10s so an incoming call is never
// missed purely because of a dead push connection, same guarantee the
// Room Display state poll already gives incoming staff-to-room calls.
router.get('/pending', auth, gate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, u.name AS unit_name, u.controller_id AS room_id
       FROM calls c JOIN units u ON u.id = c.unit_id
       WHERE u.property_id = $1 AND c.status = 'ringing' AND c.direction = 'room_to_staff'
       ORDER BY c.created_at ASC LIMIT 1`,
      [req.propertyId]
    );
    if (!rows[0]) return res.json(null);
    const call = rows[0];

    const { rows: bookingRows } = await db.query(
      `SELECT g.name AS guest_name
       FROM bookings b JOIN guests g ON g.id = b.guest_id
       WHERE b.unit_id = (SELECT unit_id FROM calls WHERE id = $1)
         AND b.status IN ('confirmed', 'checked_in')
         AND b.check_in_date <= CURRENT_DATE AND b.check_out_date >= CURRENT_DATE
       ORDER BY b.check_in_date DESC LIMIT 1`,
      [call.id]
    );

    res.json({ callId: call.id, unitName: call.unit_name, roomId: call.room_id, guestName: bookingRows[0]?.guest_name || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calls/room/:roomId/stream — SSE for the room tablet
router.get('/room/:roomId/stream', authDisplay, gate, async (req, res) => {
  const { roomId } = req.params;
  const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
  if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const key = 'room:' + roomId;
  sse.addClient(key, res);

  // Real `data:` event, not an SSE comment (invisible to onmessage) — lets
  // the client detect a silently-dead connection and force a reconnect.
  const heartbeat = setInterval(() => {
    try { res.write('data: {"type":"heartbeat"}\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(key, res);
  });
});

// GET /api/calls/staff/stream — SSE for staff (broadcast channel, scoped to their property)
router.get('/staff/stream', authQueryToken, gate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const key = staffChannel(req.user.propertyId);
  sse.addClient(key, res);

  // Real `data:` event, not an SSE comment (invisible to onmessage) — lets
  // the client detect a silently-dead connection and force a reconnect.
  const heartbeat = setInterval(() => {
    try { res.write('data: {"type":"heartbeat"}\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(key, res);
  });
});

module.exports = router;
