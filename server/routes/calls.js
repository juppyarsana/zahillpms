const router = require('express').Router();
const db = require('../db');
const authDisplay = require('../middleware/authDisplay');
const auth = require('../middleware/auth');
const authQueryToken = require('../middleware/authQueryToken');
const sse = require('../sse');

const STAFF_CHANNEL = 'staff:broadcast';
const RING_TIMEOUT_MS = 45_000;
const ringTimeouts = new Map(); // callId -> timeout handle

function clearRingTimeout(callId) {
  const handle = ringTimeouts.get(callId);
  if (handle) {
    clearTimeout(handle);
    ringTimeouts.delete(callId);
  }
}

async function markMissed(callId) {
  ringTimeouts.delete(callId);
  const { rows } = await db.query(
    `UPDATE calls SET status = 'missed' WHERE id = $1 AND status = 'ringing' RETURNING *`,
    [callId]
  );
  if (!rows[0]) return;
  const { rows: unitRows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [rows[0].unit_id]);
  if (unitRows[0]?.controller_id) sse.notify('room:' + unitRows[0].controller_id, { type: 'missed', callId });
  sse.notify(STAFF_CHANNEL, { type: 'missed', callId });
}

// POST /api/calls — room places a call
// Body: { roomId } (controller_id)
router.post('/', authDisplay, async (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  try {
    const { rows: unitRows } = await db.query(
      'SELECT id, name FROM units WHERE controller_id = $1',
      [roomId]
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

    sse.notify(STAFF_CHANNEL, { type: 'incoming_call', callId, unitName: unit.name, roomId });
    res.status(201).json({ callId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/answer — staff claims a ringing call (first click wins)
router.post('/:id/answer', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `UPDATE calls SET status = 'answered', answered_by = $2, answered_at = NOW()
       WHERE id = $1 AND status = 'ringing'
       RETURNING *`,
      [id, req.user.id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Call already answered' });
    clearRingTimeout(id);

    const call = rows[0];
    const { rows: unitRows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [call.unit_id]);
    const roomId = unitRows[0]?.controller_id;

    if (roomId) sse.notify('room:' + roomId, { type: 'answered', callId: id, staffName: req.user.name });
    sse.notify(STAFF_CHANNEL, { type: 'call_taken', callId: id, staffName: req.user.name });
    res.json(call);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/end — staff hangs up
router.post('/:id/end', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW()
       WHERE id = $1 AND status IN ('ringing','answered')
       RETURNING *`,
      [id]
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
router.post('/:id/end-from-room', authDisplay, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW()
       WHERE id = $1 AND status IN ('ringing','answered')
       RETURNING *`,
      [id]
    );
    if (rows[0]) {
      clearRingTimeout(id);
      sse.notify(STAFF_CHANNEL, { type: 'ended', callId: id });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/signal — relay a WebRTC message from staff -> room
// Body: { roomId, payload }
router.post('/:id/signal', auth, (req, res) => {
  const { id } = req.params;
  const { roomId, payload } = req.body;
  if (!roomId || !payload) return res.status(400).json({ error: 'roomId and payload required' });
  sse.notify('room:' + roomId, { type: 'signal', callId: id, payload });
  res.json({ ok: true });
});

// POST /api/calls/:id/signal-from-room — relay a WebRTC message from room -> staff
// Body: { payload }
router.post('/:id/signal-from-room', authDisplay, (req, res) => {
  const { id } = req.params;
  const { payload } = req.body;
  if (!payload) return res.status(400).json({ error: 'payload required' });
  sse.notify(STAFF_CHANNEL, { type: 'signal', callId: id, payload });
  res.json({ ok: true });
});

// GET /api/calls/room/:roomId/stream — SSE for the room tablet
router.get('/room/:roomId/stream', authDisplay, (req, res) => {
  const { roomId } = req.params;
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

// GET /api/calls/staff/stream — SSE for staff (broadcast channel)
router.get('/staff/stream', authQueryToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sse.addClient(STAFF_CHANNEL, res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sse.removeClient(STAFF_CHANNEL, res);
  });
});

module.exports = router;
