// Insights → Rooms, Guests, Bookings — /api/insight/* (owner, or the
// `reports` permission; reservations module). Not /api/insights (Market
// Insights on the Dashboard).
//   GET /rooms?period=month|quarter|year&at=YYYY-MM|YYYY
//   GET /guests?…    GET /bookings?…
//   GET /stays?…&basis=stays|arrivals|made&source=&room_type=&rate_plan=&nationality=
//       &lead_min=&lead_max=&nights_min=&nights_max=&guests_min=&guests_max=&returning=1&status=cancelled|no_show
//       the reservations behind one figure (drill-down)
// (services/insightPages.js, period from services/insightPeriod.js)
const router = require('express').Router();
const { insightPeriod } = require('../services/insightPeriod');
const { buildRooms, buildGuests, buildBookings, buildStayList } = require('../services/insightPages');

const page = build => async (req, res) => {
  try {
    const P = insightPeriod(req.query);
    if (P.error) return res.status(400).json({ error: P.error });
    res.json({ period: P, ...(await build(req.propertyId, P, req.query)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.get('/rooms', page(buildRooms));
router.get('/guests', page(buildGuests));
router.get('/bookings', page(buildBookings));
router.get('/stays', page((pid, P, q) => buildStayList(pid, P, q)));

module.exports = router;
