// Costs by department — /api/costs (owner, or the `costs` permission)
//   GET /?month=YYYY-MM   the month (default: this month) vs the month before,
//                         departments → categories → entries, department
//                         profit, six-month trend (services/costsService.js)
const router = require('express').Router();
const { buildCosts } = require('../services/costsService');
const { todayWITA } = require('../services/roomChargeService');

router.get('/', async (req, res) => {
  try {
    const month = req.query.month || todayWITA().slice(0, 7);
    const data = await buildCosts(req.propertyId, month);
    if (data.error) return res.status(400).json({ error: data.error });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
