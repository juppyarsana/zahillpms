const db = require('../db');
const { runForProperty } = require('../services/yieldService');

// Nightly yield run — one property at a time so a failure in one never stops the rest
// (same shape as runNightAuditAllProperties). Only properties with the paid
// yield_management module enabled are processed.
async function runYieldAllProperties() {
  const { rows } = await db.query(
    `SELECT p.id, p.name FROM properties p
     JOIN property_modules pm ON pm.property_id = p.id AND pm.module = 'yield_management' AND pm.is_enabled = true
     WHERE p.is_active = true`
  );
  for (const p of rows) {
    try {
      const r = await runForProperty(p.id, { dryRun: false });
      const n = r.room_types.filter(t => t.enabled).length;
      console.log(`[Yield] ${p.name}: applied for ${n} room type(s)`);
    } catch (err) {
      console.error(`[Yield] ${p.name} failed:`, err.message);
    }
  }
}

module.exports = { runYieldAllProperties };
