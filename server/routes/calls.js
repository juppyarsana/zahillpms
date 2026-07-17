const router = require('express').Router();
const db = require('../db');
const authDisplay = require('../middleware/authDisplay');
const auth = require('../middleware/auth');
const authQueryToken = require('../middleware/authQueryToken');
const moduleGuard = require('../middleware/moduleGuard');
const sse = require('../sse');
const gate = moduleGuard('room_controller');

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

    const { rows } = await db.query(
      `INSERT INTO calls (unit_id) VALUES ($1) RETURNING id`,
      [unit.id]
    );
    const callId = rows[0].id;

    const handle = setTimeout(() => markMissed(callId).catch(() => {}), RING_TIMEOUT_MS);
    ringTimeouts.set(callId, handle);

    sse.notify(staffChannel(unit.property_id), { type: 'incoming_call', callId, unitName: unit.name, roomId });
    res.status(201).json({ callId });
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
       WHERE id = $1 AND status = 'ringing'
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

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
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

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(key, res);
  });
});

module.exports = router;
