// Channel Manager — Channex (migrations 060, 117). Owner-only, behind the
// `channel_manager` module (index.js). Stage 1 = setup: link the Channex
// property, then each room type and meal plan. Logic in
// services/channelManagerService.js; Channex calls in services/channexAdapter.js.

const router = require('express').Router();
const requireRole = require('../middleware/role');
const cm = require('../services/channelManagerService');

router.use(requireRole('owner'));

function send(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error('[channel-manager]', err.message);
  // Channex refusing something comes back as a plain error with its reply.
  res.status(502).json({ error: err.message });
}

// GET /api/channel-manager/setup
router.get('/setup', async (req, res) => {
  try { res.json(await cm.getSetup(req.propertyId)); } catch (err) { send(res, err); }
});

// PUT /api/channel-manager/property { external_id } | { create: true }
router.put('/property', async (req, res) => {
  try {
    const external_id = await cm.linkProperty(req.propertyId, { external_id: req.body.external_id, create: !!req.body.create });
    res.json({ ok: true, external_id });
  } catch (err) { send(res, err); }
});

// DELETE /api/channel-manager/property
router.delete('/property', async (req, res) => {
  try { await cm.unlinkProperty(req.propertyId); res.json({ ok: true }); } catch (err) { send(res, err); }
});

// PUT /api/channel-manager/room-types/:id { external_id } | { create: true }
router.put('/room-types/:id', async (req, res) => {
  try {
    const external_id = await cm.linkRoomType(req.propertyId, req.params.id, { external_id: req.body.external_id, create: !!req.body.create });
    res.json({ ok: true, external_id });
  } catch (err) { send(res, err); }
});

// POST /api/channel-manager/room-types/:id/refresh — room count + guests to Channex again
router.post('/room-types/:id/refresh', async (req, res) => {
  try { await cm.refreshRoomType(req.propertyId, req.params.id); res.json({ ok: true }); } catch (err) { send(res, err); }
});

// DELETE /api/channel-manager/room-types/:id — forget the link (and its meal plans)
router.delete('/room-types/:id', async (req, res) => {
  try { await cm.unlinkRoomType(req.propertyId, req.params.id); res.json({ ok: true }); } catch (err) { send(res, err); }
});

// PUT /api/channel-manager/room-types/:id/rate-plans/:ratePlanId { external_id } | { create: true }
router.put('/room-types/:id/rate-plans/:ratePlanId', async (req, res) => {
  try {
    const external_id = await cm.linkRatePlan(req.propertyId, req.params.id, req.params.ratePlanId,
      { external_id: req.body.external_id, create: !!req.body.create });
    res.json({ ok: true, external_id });
  } catch (err) { send(res, err); }
});

// DELETE /api/channel-manager/room-types/:id/rate-plans/:ratePlanId
router.delete('/room-types/:id/rate-plans/:ratePlanId', async (req, res) => {
  try { await cm.unlinkRatePlan(req.propertyId, req.params.id, req.params.ratePlanId); res.json({ ok: true }); } catch (err) { send(res, err); }
});

module.exports = router;
