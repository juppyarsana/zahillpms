const router = require('express').Router();
const db = require('../db');
const authDisplay = require('../middleware/authDisplay');
const auth = require('../middleware/auth');
const authQueryToken = require('../middleware/authQueryToken');
const moduleGuard = require('../middleware/moduleGuard');
const sse = require('../sse');
const { getTurnCredentials } = require('../services/turnCredentials');
const telegramService = require('../services/telegramService');
const lines = require('../services/callLines');
const gate = moduleGuard('calling');

// The PMS staff screens answer the front desk line; the restaurant line is the
// POS's (routes/posCalls.js). Ringing, timeouts and the shared actions are in
// services/callLines.js (migration 160).
const FD = 'front_desk';
const who = req => ({ userId: req.user.id, name: req.user.name });

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
// Body: { roomId (controller_id), line?: 'front_desk' (default) | 'restaurant' }
router.post('/', authDisplay, gate, async (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  const line = req.body.line || FD;
  try {
    const r = await lines.placeFromRoom(req.propertyId, roomId, line);
    const where = line === 'restaurant' ? 'the restaurant' : 'the front desk';
    telegramService.sendAlert(req.propertyId, line === 'restaurant' ? 'alert_room_service' : 'alert_guest_requests', `📞 <b>Room calling ${where}</b>

🛏 ${telegramService.escapeHtml(r.unitName)}${r.guestName ? ` · ${telegramService.escapeHtml(r.guestName)}` : ''}`, { html: true }).catch(() => {});
    res.status(201).json({ callId: r.callId });
  } catch (err) { lines.sendError(res, err); }
});

// POST /api/calls/to-room — staff calls a specific room
// Body: { unitId }
router.post('/to-room', auth, gate, async (req, res) => {
  const { unitId } = req.body;
  if (!unitId) return res.status(400).json({ error: 'unitId required' });
  try {
    res.status(201).json(await lines.placeToRoom(req.propertyId, { unitId }, FD, who(req)));
  } catch (err) { lines.sendError(res, err); }
});

// POST /api/calls/:id/answer-from-room — room answers a staff-initiated call
router.post('/:id/answer-from-room', authDisplay, gate, async (req, res) => {
  const { id } = req.params;
  try {
    const c = await lines.callInfo(id);
    if (!c || c.property_id !== req.propertyId) return res.status(404).json({ error: 'Call not found' });
    const { rows } = await db.query(
      `UPDATE calls SET status = 'answered', answered_at = NOW()
       WHERE id = $1 AND status = 'ringing' AND direction = 'staff_to_room'
       RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Call no longer ringing' });
    lines.clearRing(id);
    sse.notify(lines.channelFor(c.property_id, c.line), { type: 'answered_from_room', callId: id });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/answer — staff claims a ringing call (first click wins)
router.post('/:id/answer', auth, gate, async (req, res) => {
  try {
    res.json(await lines.answer(req.propertyId, req.params.id, FD, who(req)));
  } catch (err) { lines.sendError(res, err); }
});

// POST /api/calls/:id/end — staff hangs up
router.post('/:id/end', auth, gate, async (req, res) => {
  try {
    await lines.end(req.propertyId, req.params.id, FD);
    res.json({ ok: true });
  } catch (err) { lines.sendError(res, err); }
});

// POST /api/calls/:id/end-from-room — room hangs up / cancels a ringing call
router.post('/:id/end-from-room', authDisplay, gate, async (req, res) => {
  const { id } = req.params;
  try {
    const c = await lines.callInfo(id);
    if (!c || c.property_id !== req.propertyId) return res.status(404).json({ error: 'Call not found' });
    const { rows } = await db.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW()
       WHERE id = $1 AND status IN ('ringing','answered')
       RETURNING *`,
      [id]
    );
    if (rows[0]) {
      lines.clearRing(id);
      sse.notify(lines.channelFor(c.property_id, c.line), { type: 'ended', callId: id });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calls/:id/signal — relay a WebRTC message from staff -> room
// Body: { roomId, payload }
router.post('/:id/signal', auth, gate, async (req, res) => {
  try {
    await lines.signalToRoom(req.propertyId, req.params.id, req.body.roomId, req.body.payload);
    res.json({ ok: true });
  } catch (err) { lines.sendError(res, err); }
});

// POST /api/calls/:id/signal-from-room — relay a WebRTC message from room -> staff
// Body: { payload }
router.post('/:id/signal-from-room', authDisplay, gate, async (req, res) => {
  const { id } = req.params;
  const { payload } = req.body;
  if (!payload) return res.status(400).json({ error: 'payload required' });
  try {
    const c = await lines.callInfo(id);
    if (!c || c.property_id !== req.propertyId) return res.status(404).json({ error: 'Call not found' });
    sse.notify(lines.channelFor(c.property_id, c.line), { type: 'signal', callId: id, payload });
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
    res.json(await lines.pending(req.propertyId, FD));
  } catch (err) { lines.sendError(res, err); }
});

// GET /api/calls/missed — the front desk's missed calls (last 24 h), POST …/:id/missed-done
router.get('/missed', auth, gate, async (req, res) => {
  try { res.json(await lines.missedCalls(req.propertyId, FD)); } catch (err) { lines.sendError(res, err); }
});
router.post('/:id/missed-done', auth, gate, async (req, res) => {
  try { await lines.missedDone(req.propertyId, req.params.id, FD, who(req)); res.json({ ok: true }); } catch (err) { lines.sendError(res, err); }
});

// GET /api/calls/room/:roomId/stream — SSE for the room tablet
router.get('/room/:roomId/stream', authDisplay, gate, async (req, res) => {
  const { roomId } = req.params;
  const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, req.propertyId]);
  if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
  lines.stream(req, res, 'room:' + roomId);
});

// GET /api/calls/staff/stream — SSE for staff (front desk line, scoped to their property)
router.get('/staff/stream', authQueryToken, gate, (req, res) => {
  lines.stream(req, res, lines.channelFor(req.user.propertyId, FD));
});

module.exports = router;
