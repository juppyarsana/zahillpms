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

module.exports = router;
