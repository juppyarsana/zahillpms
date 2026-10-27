// Overview — /api/overview (owner, or the `overview` permission)
//   GET /   the owner's / manager's home: what needs them, tonight, revenue,
//           money in, still owed, biggest costs, next 14 nights
//           (services/overviewService.js)
const router = require('express').Router();
const { buildOverview } = require('../services/overviewService');

router.get('/', async (req, res) => {
  try {
    res.json(await buildOverview(req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
