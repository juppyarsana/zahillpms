const router = require('express').Router();
const auth = require('../middleware/auth');
const moduleGuard = require('../middleware/moduleGuard');
const rr = require('../services/restaurantRequests');

// Restaurant requests on a reservation (migration 088) — breakfast box / other,
// shown in the hotel POS. Mounted at /api/bookings (reservations module) before
// routes/bookings.js; needs the POS (pos_integration). Any front desk user.
const gate = [auth, moduleGuard('pos_integration')];

function sendErr(res, err) {
  if (err instanceof rr.RequestError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: err.message });
}

// GET /api/bookings/:id/restaurant-requests → { requests, mornings:[{date, breakfast_pax}], today }
router.get('/:id/restaurant-requests', gate, async (req, res) => {
  try { res.json(await rr.listForBooking(req.propertyId, req.params.id)); } catch (err) { sendErr(res, err); }
});

// POST { kind, service_date, ready_time?, quantity?, note? }
router.post('/:id/restaurant-requests', gate, async (req, res) => {
  try { res.status(201).json(await rr.create(req.propertyId, req.params.id, req.body, req.user)); } catch (err) { sendErr(res, err); }
});

// PUT { service_date, ready_time?, quantity?, note? } — only while open.
router.put('/:id/restaurant-requests/:reqId', gate, async (req, res) => {
  try { res.json(await rr.update(req.propertyId, req.params.id, req.params.reqId, req.body, req.user)); } catch (err) { sendErr(res, err); }
});

// DELETE — cancel (kept, marked cancelled); only while open.
router.delete('/:id/restaurant-requests/:reqId', gate, async (req, res) => {
  try { res.json(await rr.cancel(req.propertyId, req.params.id, req.params.reqId, req.user)); } catch (err) { sendErr(res, err); }
});

module.exports = router;
