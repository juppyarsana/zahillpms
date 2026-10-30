// OTA dashboard — /api/ota-dashboard (channel_manager module; owner or the
// `ota_dashboard` permission, index.js). Logic in services/otaDashboard.js.
//   GET    /             the page
//   GET    /count        slow dates in the next 30 nights (the menu's red count)
//   GET    /night/:date  one night: the story, the suggestion, the prices
//   PUT    /night/:date  { lines: [{ room_type_id, rate_plan_id, price }] }
//   DELETE /night/:date  remove the manual prices of that night
//   PUT    /rules        { targets, minimums } — owner only
const router = require('express').Router();
const requireRole = require('../middleware/role');
const ota = require('../services/otaDashboard');

function send(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error('[ota-dashboard]', err.message);
  res.status(500).json({ error: 'Could not load the OTA dashboard' });
}

router.get('/', async (req, res) => {
  try { res.json(await ota.buildDashboard(req.propertyId)); } catch (err) { send(res, err); }
});

router.get('/count', async (req, res) => {
  try { res.json({ slow: await ota.slowCount(req.propertyId) }); } catch (err) { send(res, err); }
});

router.get('/night/:date', async (req, res) => {
  try { res.json(await ota.nightDetail(req.propertyId, req.params.date)); } catch (err) { send(res, err); }
});

router.put('/night/:date', async (req, res) => {
  try { res.json(await ota.saveNight(req.propertyId, req.user, req.params.date, req.body?.lines)); } catch (err) { send(res, err); }
});

router.delete('/night/:date', async (req, res) => {
  try { res.json(await ota.removeNight(req.propertyId, req.user, req.params.date)); } catch (err) { send(res, err); }
});

router.put('/rules', requireRole('owner'), async (req, res) => {
  try { res.json(await ota.saveRules(req.propertyId, req.user, req.body)); } catch (err) { send(res, err); }
});

module.exports = router;
