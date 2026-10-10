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

// ─── The installed app's name and icon, per property ─────────
// The client is one deployment for every property, so the manifest built
// into it can only carry one name and one icon. Once a device knows its
// property (the slug remembered at login) the page points its manifest link
// here instead (client/src/lib/pwaBrand.js): the property's own name, and
// icons made from the logo uploaded in Superadmin. `id`, `start_url` and
// `scope` stay those of the built-in manifest, so it is the same app to the
// phone — only what it is called and looks like changes.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const LOGO_DIR = path.join(__dirname, '../uploads/property-logos');
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
// fill = how much of the square the logo takes. A maskable icon is cropped to
// a circle by the phone, so it needs a wide safe border and a solid
// background; iOS paints transparency black, so its icon is solid too.
const ICONS = {
  192:      { size: 192, fill: 0.86, background: CLEAR },
  512:      { size: 512, fill: 0.86, background: CLEAR },
  maskable: { size: 512, fill: 0.58, background: WHITE },
  apple:    { size: 180, fill: 0.72, background: WHITE },
};
const iconCache = new Map();   // "<logo file>:<kind>" → PNG (a handful per property)

async function brandBySlug(slug) {
  const { rows: [p] } = await db.query(
    `SELECT COALESCE(NULLIF(ps.property_name, ''), p.name) AS name, ps.logo_url
       FROM properties p LEFT JOIN property_settings ps ON ps.property_id = p.id
      WHERE p.slug = $1 AND p.is_active = true`, [slug]);
  if (!p) return null;
  const file = p.logo_url ? path.join(LOGO_DIR, path.basename(p.logo_url)) : null;
  return { name: p.name, logoFile: file && fs.existsSync(file) ? file : null };
}

// GET /api/public/properties/:slug/manifest.webmanifest — always a usable
// manifest: an unknown slug or a property without a logo gets the built-in
// name / icons, so a stale remembered slug never leaves the app uninstallable.
router.get('/properties/:slug/manifest.webmanifest', async (req, res) => {
  try {
    const brand = await brandBySlug(req.params.slug);
    const name = brand?.name || 'Zahill PMS';
    const base = `/api/public/properties/${encodeURIComponent(req.params.slug)}/icon`;
    const v = brand?.logoFile ? `?v=${encodeURIComponent(path.basename(brand.logoFile, '.png'))}` : '';
    const icons = brand?.logoFile
      ? [
          { src: `${base}/192.png${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}/512.png${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}/maskable.png${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      : [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ];
    res.set('Content-Type', 'application/manifest+json');
    res.set('Cache-Control', 'no-cache');
    res.send(JSON.stringify({
      name,
      // under the icon on the home screen — phones cut it at about 12 letters
      short_name: name.length <= 12 ? name : name.split(/\s+/)[0].slice(0, 12),
      description: 'Property Management System',
      theme_color: '#5C1A2E',
      background_color: brand?.logoFile ? '#FFFFFF' : '#5C1A2E',
      display: 'standalone',
      orientation: 'any',
      scope: '/',
      start_url: '/',
      id: '/',
      prefer_related_applications: false,
      icons,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/public/properties/:slug/icon/:kind.png — 192 | 512 | maskable | apple
router.get('/properties/:slug/icon/:kind.png', async (req, res) => {
  const spec = ICONS[req.params.kind];
  if (!spec) return res.status(404).json({ error: 'Unknown icon' });
  try {
    const brand = await brandBySlug(req.params.slug);
    // No logo (or a slug this server doesn't know): the app's built-in icon.
    if (!brand?.logoFile) return res.redirect(req.params.kind === 'maskable' ? '/pwa-maskable-512x512.png' : req.params.kind === '512' ? '/pwa-512x512.png' : '/pwa-192x192.png');
    const key = `${path.basename(brand.logoFile)}:${req.params.kind}`;
    let png = iconCache.get(key);
    if (!png) {
      const inner = Math.round(spec.size * spec.fill);
      // Trimmed first: a logo stored with an empty border would come out tiny.
      const art = await sharp(brand.logoFile).trim({ threshold: 10 }).png().toBuffer().catch(() => brand.logoFile);
      const logo = await sharp(art).resize({ width: inner, height: inner, fit: 'inside' }).png().toBuffer();
      png = await sharp({ create: { width: spec.size, height: spec.size, channels: 4, background: spec.background } })
        .composite([{ input: logo, gravity: 'centre' }]).png().toBuffer();
      iconCache.set(key, png);
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
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
