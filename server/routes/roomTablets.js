// Settings → Property → Room tablets (migration 115): connection history of
// the room tablets — drops per room per day, drops of many rooms at once,
// before / after a WiFi change, one room's signal and access points.
// Mounted with auth + requireOwnerOrMenu('room_tablets'). Logic in
// services/tabletLink.js.
const router = require('express').Router();
const tabletLink = require('../services/tabletLink');

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

// GET /api/room-tablets?days=14
router.get('/', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), tabletLink.KEEP_DAYS);
  try { res.json(await tabletLink.overview(req.propertyId, { days })); } catch (err) { fail(res, err); }
});

// GET /api/room-tablets/compare?since=2026-10-18T17:00&rooms=201,202
router.get('/compare', async (req, res) => {
  const raw = String(req.query.since || '');
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(raw)) return res.status(400).json({ error: 'since must be YYYY-MM-DD or YYYY-MM-DDTHH:MM' });
  const sinceMs = Date.parse((raw.length === 10 ? raw + 'T00:00' : raw) + ':00+08:00');
  if (!Number.isFinite(sinceMs) || sinceMs > Date.now()) return res.status(400).json({ error: 'Pick a time in the past' });
  const rooms = String(req.query.rooms || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
  try { res.json(await tabletLink.compare(req.propertyId, { sinceMs, rooms })); } catch (err) { fail(res, err); }
});

// GET /api/room-tablets/access-points
router.get('/access-points', async (req, res) => {
  try { res.json(await tabletLink.accessPoints(req.propertyId)); } catch (err) { fail(res, err); }
});

// PUT /api/room-tablets/access-points/:bssid { name } — empty name removes it
router.put('/access-points/:bssid', async (req, res) => {
  try { res.json({ name: await tabletLink.nameAccessPoint(req.propertyId, req.params.bssid, req.body?.name) }); } catch (err) { fail(res, err); }
});

// GET /api/room-tablets/room/:room?days=7
router.get('/room/:room', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), tabletLink.KEEP_DAYS);
  try { res.json(await tabletLink.roomDetail(req.propertyId, String(req.params.room).slice(0, 32), { days })); } catch (err) { fail(res, err); }
});

module.exports = router;
