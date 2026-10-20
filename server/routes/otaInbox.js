// OTA bookings for front desk (migration 123): the pop-up, the Dashboard box
// and the 🌐 OTA bookings page. `auth` + `channel_manager` module (index.js),
// owner or the `reservations` permission. Logic in services/otaInbox.js.
const router = require('express').Router();
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const inbox = require('../services/otaInbox');
const channelBookings = require('../services/channelBookings');

router.use(requireOwnerOrMenu('reservations'));

// GET /api/ota-inbox/unseen — the pop-up (polled): { unseen, open }
router.get('/unseen', async (req, res) => {
  try { res.json(await inbox.unseen(req.propertyId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ota-inbox — { today, open, recent, last_pull_at, last_webhook_at }
router.get('/', async (req, res) => {
  try { res.json(await inbox.overview(req.propertyId)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ota-inbox/seen { ids: [...] } | { all: true }
router.post('/seen', async (req, res) => {
  try { res.json({ ok: true, marked: await inbox.markSeen(req.propertyId, req.user.id, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ota-inbox/:id/handled — FO dealt with an item that needed them.
router.post('/:id/handled', async (req, res) => {
  try {
    await channelBookings.markHandled(req.propertyId, req.params.id, req.user.id);
    await inbox.markSeen(req.propertyId, req.user.id, { ids: [req.params.id] });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// POST /api/ota-inbox/check — read the OTA bookings from Channex now.
router.post('/check', async (req, res) => {
  try {
    const out = await channelBookings.pullProperty(req.propertyId);
    if (out.skipped) return res.status(400).json({ error: 'The channel manager is not linked yet', code: 'NO_PROPERTY' });
    res.json({ ok: true, ...out });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

module.exports = router;
