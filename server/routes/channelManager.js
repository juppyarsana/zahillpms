// Channel Manager — Channex (migrations 060, 117). Owner-only, behind the
// `channel_manager` module (index.js). Stage 1 = setup: link the Channex
// property, then each room type and meal plan. Logic in
// services/channelManagerService.js; Channex calls in services/channexAdapter.js.

const router = require('express').Router();
const requireRole = require('../middleware/role');
const cm = require('../services/channelManagerService');
const channelSync = require('../services/channelSync');
const channelBookings = require('../services/channelBookings');
const channelHealth = require('../services/channelHealth');
const channelWebhook = require('../services/channelWebhook');
const ratePrices = require('../services/channelRatePrices');

router.use(requireRole('owner'));

function send(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error('[channel-manager]', err.message);
  // Channex refusing something comes back as a plain error with its reply.
  res.status(502).json({ error: err.message });
}

// OTA prices for one meal plan (migration 125).
// GET /api/channel-manager/prices → { options, prices }
router.get('/prices', async (req, res) => {
  try {
    const [options, prices] = await Promise.all([ratePrices.options(req.propertyId), ratePrices.list(req.propertyId)]);
    res.json({ options, prices });
  } catch (err) { send(res, err); }
});

// POST /api/channel-manager/prices { lines: [{ room_type_id, rate_plan_id, date_from, date_to, price }] }
// All lines in one go — they reach Channex in one call.
router.post('/prices', async (req, res) => {
  try { res.status(201).json(await ratePrices.save(req.propertyId, req.user.id, req.body?.lines)); }
  catch (err) { send(res, err); }
});

// DELETE /api/channel-manager/prices { ids }
router.delete('/prices', async (req, res) => {
  try { res.json(await ratePrices.remove(req.propertyId, req.body?.ids)); }
  catch (err) { send(res, err); }
});

// GET /api/channel-manager/setup
router.get('/setup', async (req, res) => {
  try {
    const [setup, sync] = await Promise.all([cm.getSetup(req.propertyId), channelSync.status(req.propertyId)]);
    res.json({ ...setup, sync, sync_days: channelSync.SYNC_DAYS });
  } catch (err) { send(res, err); }
});

// GET /api/channel-manager/sync — the send status alone (the page polls it;
// /setup also reads Channex, too heavy to repeat).
router.get('/sync', async (req, res) => {
  try { res.json({ sync: await channelSync.status(req.propertyId) }); } catch (err) { send(res, err); }
});

// GET /api/channel-manager/checklist — stage 4: the go-live checklist.
router.get('/checklist', async (req, res) => {
  try { res.json(await channelHealth.checklist(req.propertyId)); } catch (err) { send(res, err); }
});

// GET /api/channel-manager/compare?days=30 — the next nights as Channex holds
// them vs what the PMS sends.
router.get('/compare', async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  try { res.json(await channelHealth.compare(req.propertyId, days)); } catch (err) { send(res, err); }
});

// GET /api/channel-manager/bookings — stage 3: reservations read from Channex
// ({ open: needing FO, recent, last_pull_at, last_pull_error }).
router.get('/bookings', async (req, res) => {
  try {
    const [list, webhook] = await Promise.all([channelBookings.list(req.propertyId), channelWebhook.status(req.propertyId)]);
    res.json({ ...list, webhook });
  } catch (err) { send(res, err); }
});

// POST /api/channel-manager/webhook — (re)register the Channex webhook so
// bookings arrive within seconds (migration 123).
router.post('/webhook', async (req, res) => {
  try {
    const out = await channelWebhook.ensure(req.propertyId);
    if (out.state === 'no_url') return res.status(400).json({ error: 'This server has no public https address (SERVER_PUBLIC_URL) — bookings are read every minute instead', code: 'NO_URL' });
    if (out.state === 'not_linked') return res.status(400).json({ error: 'Link the channel manager property first', code: 'NO_PROPERTY' });
    if (out.state === 'error') return res.status(502).json({ error: out.error, webhook: await channelWebhook.status(req.propertyId) });
    res.json({ ok: true, webhook: await channelWebhook.status(req.propertyId) });
  } catch (err) { send(res, err); }
});

// POST /api/channel-manager/bookings/pull — read the feed now.
router.post('/bookings/pull', async (req, res) => {
  try {
    const result = await channelBookings.pullProperty(req.propertyId);
    if (result.busy) return res.status(409).json({ error: 'Already reading — try again in a moment', code: 'BUSY' });
    if (result.skipped) return res.status(400).json({ error: 'Link the channel manager property first', code: 'NO_PROPERTY' });
    res.json({ ok: true, result, ...(await channelBookings.list(req.propertyId)) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/channel-manager/revisions/:id/handled — FO dealt with it by hand.
router.post('/revisions/:id/handled', async (req, res) => {
  try { await channelBookings.markHandled(req.propertyId, req.params.id, req.user.id); res.json({ ok: true }); }
  catch (err) { send(res, err); }
});

// POST /api/channel-manager/sync — send every night's free rooms and prices
// again now (stage 2). Waits for the send and returns what went.
router.post('/sync', async (req, res) => {
  try {
    const result = await channelSync.runSync(req.propertyId, 'manual');
    if (result.busy) return res.status(409).json({ error: 'A send is already running — try again in a moment', code: 'BUSY' });
    if (result.tooSoon) {
      const at = result.next.toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit' });
      return res.status(409).json({ error: `Everything was sent less than an hour ago — changes keep going by themselves. Send everything again after ${at}.`, code: 'TOO_SOON', sync: await channelSync.status(req.propertyId) });
    }
    if (result.skipped) return res.status(400).json({ error: 'Link the channel manager property first', code: 'NO_PROPERTY' });
    res.json({ ok: true, result, sync: await channelSync.status(req.propertyId) });
  } catch (err) {
    res.status(502).json({ error: err.message, sync: await channelSync.status(req.propertyId).catch(() => null) });
  }
});

// PUT /api/channel-manager/property { external_id } | { create: true }
router.put('/property', async (req, res) => {
  try {
    const external_id = await cm.linkProperty(req.propertyId, { external_id: req.body.external_id, create: !!req.body.create });
    channelWebhook.ensure(req.propertyId).catch(err => console.error('[CHANNEL WEBHOOK] link', err.message));
    res.json({ ok: true, external_id });
  } catch (err) { send(res, err); }
});

// DELETE /api/channel-manager/property
router.delete('/property', async (req, res) => {
  try {
    await cm.unlinkProperty(req.propertyId);
    await channelWebhook.remove(req.propertyId).catch(() => {});
    res.json({ ok: true });
  } catch (err) { send(res, err); }
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
