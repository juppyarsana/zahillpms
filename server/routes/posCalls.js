// The restaurant phone line, for the POS (migration 160).
//
// The POS server holds ONE stream (GET /stream) and passes calls on to its own
// screens; the screens never hold a PMS credential. Auth = the property's POS
// API key (authPos), like the rest of /api/pos. Only works while the restaurant
// line is on (Property Details → POS Integration) with the calling and POS
// integration modules.
//
//   GET  /api/pos/calls/status               { enabled }
//   GET  /api/pos/calls/stream               SSE: incoming_call, signal, call_taken, ended, missed, answered_from_room
//   GET  /api/pos/calls/pending              the oldest room call ringing the restaurant, or null
//   GET  /api/pos/calls/turn-credentials     { iceServers }
//   GET  /api/pos/calls/rooms                rooms that can be called (Room ID set) + guest in them
//   GET  /api/pos/calls/missed               missed calls of the last 24 h { open, calls }
//   POST /api/pos/calls/:id/missed-done      { by } — handled another way
//   POST /api/pos/calls/to-room              { unit_id | room_id, by }
//   POST /api/pos/calls/:id/answer           { by }
//   POST /api/pos/calls/:id/end
//   POST /api/pos/calls/:id/signal           { roomId, payload } (no roomId = to the front desk, line-to-line call)
//   POST /api/pos/calls/to-front-desk        the restaurant calls the front desk (migration 165)
const router = require('express').Router();
const db = require('../db');
const authPos = require('../middleware/authPos');
const lines = require('../services/callLines');
const { getTurnCredentials } = require('../services/turnCredentials');

const LINE = 'restaurant';
const by = req => ({ name: String(req.body?.by || 'Restaurant').trim().slice(0, 80) || 'Restaurant' });

router.use(authPos);

router.get('/status', async (req, res) => {
  try { res.json({ enabled: await lines.restaurantLineOn(req.propertyId) }); }
  catch (err) { lines.sendError(res, err); }
});

// Everything else needs the line on.
router.use(async (req, res, next) => {
  try {
    if (!(await lines.restaurantLineOn(req.propertyId))) return res.status(403).json({ error: 'The restaurant line is not set up', code: 'LINE_OFF' });
    next();
  } catch (err) { lines.sendError(res, err); }
});

router.get('/stream', (req, res) => lines.stream(req, res, lines.channelFor(req.propertyId, LINE)));

router.get('/pending', async (req, res) => {
  try { res.json(await lines.pending(req.propertyId, LINE)); } catch (err) { lines.sendError(res, err); }
});

router.get('/turn-credentials', (req, res) => {
  const creds = getTurnCredentials(req.propertyId);
  res.json({ iceServers: creds ? [creds] : [] });
});

router.get('/rooms', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.controller_id AS room_id, COALESCE(rt.name, u.type) AS room_type,
              (SELECT g.name FROM bookings b JOIN guests g ON g.id = b.guest_id
                WHERE b.unit_id = u.id AND b.status = 'checked_in' ORDER BY b.check_in_date DESC LIMIT 1) AS guest_name
       FROM units u LEFT JOIN room_types rt ON rt.id = u.room_type_id
       WHERE u.property_id = $1 AND u.controller_id IS NOT NULL
       ORDER BY rt.sort_order NULLS LAST, u.name`, [req.propertyId]);
    res.json(rows);
  } catch (err) { lines.sendError(res, err); }
});

router.get('/missed', async (req, res) => {
  try { res.json(await lines.missedCalls(req.propertyId, LINE)); } catch (err) { lines.sendError(res, err); }
});
router.post('/:id/missed-done', async (req, res) => {
  try { await lines.missedDone(req.propertyId, req.params.id, LINE, by(req)); res.json({ ok: true }); } catch (err) { lines.sendError(res, err); }
});

router.post('/to-room', async (req, res) => {
  const { unit_id: unitId, room_id: roomId } = req.body || {};
  if (!unitId && !roomId) return res.status(400).json({ error: 'unit_id or room_id required' });
  try { res.status(201).json(await lines.placeToRoom(req.propertyId, { unitId, roomId }, LINE, by(req))); }
  catch (err) { lines.sendError(res, err); }
});

router.post('/to-front-desk', async (req, res) => {
  try { res.status(201).json(await lines.placeToLine(req.propertyId, LINE, 'front_desk', by(req))); }
  catch (err) { lines.sendError(res, err); }
});

router.post('/:id/answer', async (req, res) => {
  try { res.json(await lines.answer(req.propertyId, req.params.id, LINE, by(req))); } catch (err) { lines.sendError(res, err); }
});

router.post('/:id/end', async (req, res) => {
  try { await lines.end(req.propertyId, req.params.id, LINE); res.json({ ok: true }); } catch (err) { lines.sendError(res, err); }
});

router.post('/:id/signal', async (req, res) => {
  try { await lines.signal(req.propertyId, req.params.id, req.body?.roomId, req.body?.payload, LINE); res.json({ ok: true }); }
  catch (err) { lines.sendError(res, err); }
});

module.exports = router;
