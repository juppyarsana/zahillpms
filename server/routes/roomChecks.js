const router = require('express').Router();
const db = require('../db');
const requireRole = require('../middleware/role');
const roomCheck = require('../services/roomCheckService');
const sse = require('../sse');

// Room check / minibar — the front desk side (migration 091). Mounted at
// /api/room-checks behind staff auth. Housekeeping's side is on the room
// tablet (routes/display.js) and the phone link (routes/public.js).
// Logic: services/roomCheckService.js.

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message, code: err.code });

// Tell the room's tablet (its Housekeeping entry shows that front desk is waiting).
async function pingTablet(propertyId, unitId) {
  const { rows: [u] } = await db.query('SELECT controller_id FROM units WHERE id = $1 AND property_id = $2', [unitId, propertyId]);
  if (u?.controller_id) sse.notify(u.controller_id, { type: 'room_check' });
}

// GET /api/room-checks/settings — the housekeeping PIN (owner).
router.get('/settings', requireRole('owner'), async (req, res) => {
  try {
    res.json({ pin: await roomCheck.pinFor(req.propertyId), minibar_items: (await roomCheck.minibarItems(req.propertyId)).length });
  } catch (err) { fail(res, err); }
});

// PUT /api/room-checks/settings { pin } — 4 to 6 digits, or '' to switch the
// tablet's Housekeeping entry off.
router.put('/settings', requireRole('owner'), async (req, res) => {
  const pin = String(req.body?.pin ?? '').trim();
  if (pin && !/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'The PIN is 4 to 6 digits' });
  try {
    await db.query('UPDATE property_settings SET housekeeping_pin = $1 WHERE property_id = $2', [pin || null, req.propertyId]);
    res.json({ pin: pin || null });
  } catch (err) { fail(res, err); }
});

// GET /api/room-checks?booking_id= — a booking's checks, newest first.
router.get('/', async (req, res) => {
  if (!req.query.booking_id) return res.status(400).json({ error: 'booking_id required' });
  try {
    res.json(await roomCheck.listForBooking(req.propertyId, req.query.booking_id));
  } catch (err) { fail(res, err); }
});

// POST /api/room-checks { booking_id } — ask housekeeping (Telegram + tablet).
router.post('/', async (req, res) => {
  try {
    const check = await roomCheck.request(req.propertyId, req.body.booking_id, req.user);
    pingTablet(req.propertyId, check.unit_id).catch(() => {});
    res.status(201).json(check);
  } catch (err) { fail(res, err); }
});

// POST /api/room-checks/:id/charge { items? } — add the answer to the bill.
router.post('/:id/charge', async (req, res) => {
  try {
    res.json(await roomCheck.charge(req.propertyId, req.params.id, req.user, req.body?.items));
  } catch (err) { fail(res, err); }
});

// POST /api/room-checks/:id/dismiss — set a request / answer aside.
router.post('/:id/dismiss', async (req, res) => {
  try {
    const check = await roomCheck.dismiss(req.propertyId, req.params.id, req.user);
    pingTablet(req.propertyId, check.unit_id).catch(() => {});
    res.json(check);
  } catch (err) { fail(res, err); }
});

module.exports = router;
