// Insights → Rooms, Guests, Bookings — /api/insight/* (owner, or the
// `reports` permission; reservations module). Not /api/insights (Market
// Insights on the Dashboard).
//   GET /rooms?period=month|quarter|year&at=YYYY-MM|YYYY
//   GET /guests?…    GET /bookings?…
// (services/insightPages.js, period from services/insightPeriod.js)
const router = require('express').Router();
const { insightPeriod } = require('../services/insightPeriod');
const { buildRooms, buildGuests, buildBookings } = require('../services/insightPages');

const page = build => async (req, res) => {
  try {
    const P = insightPeriod(req.query);
    if (P.error) return res.status(400).json({ error: P.error });
    res.json({ period: P, ...(await build(req.propertyId, P)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.get('/rooms', page(buildRooms));
router.get('/guests', page(buildGuests));
router.get('/bookings', page(buildBookings));

module.exports = router;
