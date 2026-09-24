// One-off: trim the empty border off every property's current logo (the
// same processing new uploads now get — services/logoImage.js). Rewrites the
// file in place, so logo_url doesn't change; keeps the original next to it
// as <name>-untrimmed.png. Safe to run more than once (a trimmed logo stays
// the same). Usage: node maintenance/trimLogos.js   (from server/)
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const db = require('../db');
const { processLogo } = require('../services/logoImage');

const LOGO_DIR = path.join(__dirname, '../uploads/property-logos');

(async () => {
  const { rows } = await db.query(
    `SELECT p.name, ps.logo_url FROM property_settings ps JOIN properties p ON p.id = ps.property_id
     WHERE ps.logo_url IS NOT NULL`
  );
  for (const r of rows) {
    const file = path.join(LOGO_DIR, path.basename(r.logo_url));
    if (!fs.existsSync(file)) { console.log(`${r.name}: file missing (${r.logo_url}) — skipped`); continue; }
    const original = fs.readFileSync(file);
    const before = await sharp(original).metadata();
    const out = await processLogo(original);
    const after = await sharp(out).metadata();
    if (before.width === after.width && before.height === after.height) {
      console.log(`${r.name}: already tight (${before.width}x${before.height}) — unchanged`);
      continue;
    }
    const backup = file.replace(/\.png$/i, '') + '-untrimmed.png';
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
    fs.writeFileSync(file, out);
    console.log(`${r.name}: ${before.width}x${before.height} → ${after.width}x${after.height} (original kept as ${path.basename(backup)})`);
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
