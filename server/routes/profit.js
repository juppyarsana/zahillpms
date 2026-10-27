// Profit — /api/profit (owner, or the `profit` permission; accounting module)
//   GET /?month=YYYY-MM   the Accounting P&L in four steps: revenue →
//                         department profit → GOP → net profit, what each
//                         department keeps, what moved, what the books still
//                         miss (services/profitInsights.js)
const router = require('express').Router();
const { buildProfit } = require('../services/profitInsights');
const { todayWITA } = require('../services/roomChargeService');

router.get('/', async (req, res) => {
  try {
    const data = await buildProfit(req.propertyId, req.query.month || todayWITA().slice(0, 7));
    if (data.error) return res.status(400).json({ error: data.error });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
