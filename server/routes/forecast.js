// Forecast — /api/forecast
//   GET /?from=YYYY-MM-DD&days=14   the days ahead, one row per day (JSON)
// Owner, or the forecast permission. Revenue columns only for the owner or
// the month_summary permission (the same people who see the Dashboard's
// month revenue).
const router = require('express').Router();
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { buildForecast, MAX_DAYS } = require('../services/forecast');

const seesMoney = user => user?.role === 'owner'
  || (Array.isArray(user?.allowed_menus) && user.allowed_menus.includes('month_summary'));

router.get('/', requireOwnerOrMenu('forecast'), async (req, res) => {
  const days = req.query.days === undefined ? 14 : parseInt(req.query.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return res.status(400).json({ error: `days must be 1 to ${MAX_DAYS}` });
  }
  try {
    const data = await buildForecast(req.propertyId, { from: req.query.from, days, withMoney: seesMoney(req.user) });
    if (!data) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
