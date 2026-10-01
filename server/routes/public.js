const router = require('express').Router();
const db = require('../db');

// GET /api/public/properties/:slug/branding — no auth. Used by the login
// screen to show the right property's logo/name before credentials are
// submitted. Cosmetic only — does not affect how /api/auth/login resolves
// the user.
router.get('/properties/:slug/branding', async (req, res) => {
  try {
    const { rows: [property] } = await db.query(
      `SELECT COALESCE(ps.property_name, p.name) AS name, ps.logo_url, ps.brand_color
       FROM properties p
       LEFT JOIN property_settings ps ON ps.property_id = p.id
       WHERE p.slug = $1 AND p.is_active = true`,
      [req.params.slug]
    );
    if (!property) return res.status(404).json({ error: 'Property not found' });
    res.json(property);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Room check from a phone (migration 091): the link in the Telegram message
// front desk's request sends to housekeeping. The token is the credential —
// random, one per request, dead once answered or closed.
const roomCheck = require('../services/roomCheckService');

router.get('/room-check/:token', async (req, res) => {
  try {
    const rc = await roomCheck.byToken(req.params.token);
    if (!rc) return res.status(404).json({ error: 'This room check is already answered or closed', code: 'GONE' });
    res.json({ room: rc.room, property_name: rc.property_name, items: await roomCheck.minibarItems(rc.property_id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/room-check/:token', async (req, res) => {
  try {
    const rc = await roomCheck.byToken(req.params.token);
    if (!rc) return res.status(404).json({ error: 'This room check is already answered or closed', code: 'GONE' });
    const check = await roomCheck.submit(rc.property_id, { unitId: rc.unit_id, checkId: rc.id, items: req.body.items, note: req.body.note, via: 'link' });
    res.status(201).json({ room: check.room, total: check.total, items: check.items.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

module.exports = router;
