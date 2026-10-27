const db = require('../db');

// Single write path for creating a catalog row in `activities` — used by both
// routes/activities.js's own POST / (staff entry point) and routes/board.js
// (Guest Board "Paid" toggle entry point), so a card and a catalog row never
// diverge on how they were inserted. `activities` stays the sole owner of
// commerce fields — see CLAUDE.md.
async function createActivity(propertyId, { name, category, price, description, duration_minutes, capacity_per_slot, tax_mode, tax_base, charge_service, vendor_treatment }, client = db) {
  const { rows: [activity] } = await client.query(
    `INSERT INTO activities (name, category, price, description, duration_minutes, capacity_per_slot, property_id, tax_mode,
                             tax_base, charge_service, vendor_treatment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [name, category || 'tour', price, description || null, duration_minutes || null, capacity_per_slot || null, propertyId, tax_mode || 'added',
     tax_base || 'full', charge_service !== false, vendor_treatment || 'rebate']
  );
  return activity;
}

// Vendor share (migration 140): the tax options and the vendors of an
// activity. Returns { value } or { error }. `current` = the row being edited.
const PRICE_MODES = ['per_trip', 'per_person', 'typed'];
function cleanVendorSettings(body, current = {}) {
  const mode = body.tax_mode ?? current.tax_mode ?? 'added';
  const out = {};
  if (body.vendor_treatment !== undefined) {
    if (!['rebate', 'cost'].includes(body.vendor_treatment)) return { error: "vendor_treatment must be 'rebate' or 'cost'" };
    out.vendor_treatment = body.vendor_treatment;
  }
  let base = body.tax_base ?? current.tax_base ?? 'full';
  let service = body.charge_service ?? current.charge_service ?? true;
  if (!['full', 'margin'].includes(base)) return { error: "tax_base must be 'full' or 'margin'" };
  // Only a tax-included price can leave out service or tax the hotel's part:
  // the folio adds service + tax to the whole of a price before tax.
  if (mode !== 'included') { base = 'full'; service = true; }
  out.tax_base = base;
  out.charge_service = !!service;
  if (body.vendors !== undefined) {
    if (!Array.isArray(body.vendors) || body.vendors.length > 10) return { error: 'vendors must be a list (at most 10)' };
    const seen = new Set();
    out.vendors = [];
    for (const v of body.vendors) {
      if (!v || !v.supplier_id) return { error: 'Choose the vendor on every vendor line' };
      if (seen.has(v.supplier_id)) return { error: 'The same vendor is listed twice' };
      seen.add(v.supplier_id);
      const priceMode = v.price_mode || 'per_trip';
      if (!PRICE_MODES.includes(priceMode)) return { error: 'Choose how the vendor is priced' };
      let price = null;
      if (priceMode !== 'typed') {
        price = parseFloat(v.price);
        if (!(price >= 0)) return { error: "Type the vendor's price (or choose 'typed for each trip')" };
        price = Math.round(price * 100) / 100;
      }
      out.vendors.push({ supplier_id: v.supplier_id, price_mode: priceMode, price });
    }
  }
  return { value: out };
}

// Replaces an activity's vendor lines (only suppliers of this property).
async function saveVendors(client, propertyId, activityId, vendors) {
  if (vendors.length) {
    const { rows } = await client.query('SELECT id FROM suppliers WHERE property_id = $1 AND id = ANY($2)', [propertyId, vendors.map(v => v.supplier_id)]);
    if (rows.length !== vendors.length) return { error: 'Vendor not found' };
  }
  await client.query('DELETE FROM activity_vendors WHERE activity_id = $1', [activityId]);
  for (const [i, v] of vendors.entries()) {
    await client.query(
      `INSERT INTO activity_vendors (property_id, activity_id, supplier_id, price_mode, price, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
      [propertyId, activityId, v.supplier_id, v.price_mode, v.price, i]);
  }
  return { ok: true };
}

// Unlink path for a Guest Board card going from Paid back to Free — the
// linked activities row is never deleted (activity_bookings has an
// ON DELETE RESTRICT FK to it), just marked unavailable.
async function setAvailability(propertyId, activityId, isAvailable) {
  const { rows: [activity] } = await db.query(
    'UPDATE activities SET is_available = $1 WHERE id = $2 AND property_id = $3 RETURNING *',
    [isAvailable, activityId, propertyId]
  );
  return activity;
}

module.exports = { createActivity, setAvailability, cleanVendorSettings, saveVendors };
