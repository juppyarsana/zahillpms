// The front desk phone app (migration 162, fo-phone/ + the /fo-phone page).
// Auth = the phone's own key (services/foPhones.js). Same front desk line as
// the PMS screens: a call rings the PCs and the phones, first to answer wins.
//
//   GET  /api/phone/me                     { device, property, calling }
//   GET  /api/phone/stream?key=            SSE: incoming_call, signal, call_taken, ended, missed, answered_from_room, missed_changed
//   GET  /api/phone/pending                a room call ringing the front desk now, or null
//   GET  /api/phone/turn-credentials       { iceServers }
//   GET  /api/phone/rooms                  rooms that can be called + guest in them
//   GET  /api/phone/missed                 missed calls of the last 24 h
//   POST /api/phone/to-room                { unit_id }
//   POST /api/phone/to-restaurant          the restaurant line (migration 165); GET /api/phone/restaurant-line { enabled }
//   POST /api/phone/:id/answer | /end | /missed-done
//   POST /api/phone/:id/signal             { roomId, payload }
const router = require('express').Router();
const db = require('../db');
const { authDevice } = require('../services/foPhones');
const lines = require('../services/callLines');
const { getTurnCredentials } = require('../services/turnCredentials');

router.use(authDevice);
const who = req => ({ name: req.device.name });
const line = req => req.device.line || 'front_desk';

async function callingOn(propertyId) {
  const { rows } = await db.query("SELECT 1 FROM property_modules WHERE property_id = $1 AND module = 'calling' AND is_enabled", [propertyId]);
  return !!rows[0];
}

router.get('/me', async (req, res) => {
  try {
    const { rows: [p] } = await db.query(
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.logo_url FROM properties p
       LEFT JOIN property_settings ps ON ps.property_id = p.id WHERE p.id = $1`, [req.propertyId]);
    res.json({ device: { id: req.device.id, name: req.device.name, line: line(req) }, property: p, calling: await callingOn(req.propertyId) });
  } catch (err) { lines.sendError(res, err); }
});

router.use(async (req, res, next) => {
  try {
    if (!(await callingOn(req.propertyId))) return res.status(403).json({ error: 'Calling is switched off for this hotel', code: 'CALLING_OFF' });
    next();
  } catch (err) { lines.sendError(res, err); }
});

router.get('/stream', (req, res) => lines.stream(req, res, lines.channelFor(req.propertyId, line(req))));
router.get('/pending', async (req, res) => { try { res.json(await lines.pending(req.propertyId, line(req))); } catch (err) { lines.sendError(res, err); } });
router.get('/turn-credentials', (req, res) => { const c = getTurnCredentials(req.propertyId); res.json({ iceServers: c ? [c] : [] }); });
router.get('/missed', async (req, res) => { try { res.json(await lines.missedCalls(req.propertyId, line(req))); } catch (err) { lines.sendError(res, err); } });
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
router.post('/to-room', async (req, res) => {
  if (!req.body?.unit_id) return res.status(400).json({ error: 'unit_id required' });
  try { res.status(201).json(await lines.placeToRoom(req.propertyId, { unitId: req.body.unit_id }, line(req), who(req))); } catch (err) { lines.sendError(res, err); }
});
router.get('/restaurant-line', async (req, res) => { try { res.json({ enabled: await lines.restaurantLineOn(req.propertyId) }); } catch (err) { lines.sendError(res, err); } });
router.post('/to-restaurant', async (req, res) => {
  try { res.status(201).json(await lines.placeToLine(req.propertyId, line(req), 'restaurant', who(req))); } catch (err) { lines.sendError(res, err); }
});
router.post('/:id/answer', async (req, res) => { try { res.json(await lines.answer(req.propertyId, req.params.id, line(req), who(req))); } catch (err) { lines.sendError(res, err); } });
router.post('/:id/end', async (req, res) => { try { await lines.end(req.propertyId, req.params.id, line(req)); res.json({ ok: true }); } catch (err) { lines.sendError(res, err); } });
router.post('/:id/missed-done', async (req, res) => { try { await lines.missedDone(req.propertyId, req.params.id, line(req), who(req)); res.json({ ok: true }); } catch (err) { lines.sendError(res, err); } });
router.post('/:id/signal', async (req, res) => {
  try { await lines.signal(req.propertyId, req.params.id, req.body?.roomId, req.body?.payload, line(req)); res.json({ ok: true }); } catch (err) { lines.sendError(res, err); }
});

module.exports = router;
