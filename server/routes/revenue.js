// Revenue — /api/revenue (owner, or the `reports` permission; financial module)
//   GET /?month=YYYY-MM   the month (default: this month, up to today) vs the
//                         month before and the same days last year: totals,
//                         where it came from, every day, channels, room types
//                         (services/revenueInsights.js — built on the Reports
//                         page's own figures)
const router = require('express').Router();
const { buildRevenue } = require('../services/revenueInsights');
const { todayWITA } = require('../services/roomChargeService');

router.get('/', async (req, res) => {
  try {
    const data = await buildRevenue(req.propertyId, req.query.month || todayWITA().slice(0, 7));
    if (data.error) return res.status(400).json({ error: data.error });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
