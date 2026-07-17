const db = require('../db');
const MODULES = require('../modules');

async function seedPropertyDefaults(propertyId) {
  // property_settings singleton row
  await db.query(
    `INSERT INTO property_settings (property_id) VALUES ($1)
     ON CONFLICT (property_id) DO NOTHING`,
    [propertyId]
  );

  // ai_market_summary singleton row
  await db.query(
    `INSERT INTO ai_market_summary (property_id) VALUES ($1)
     ON CONFLICT (property_id) DO NOTHING`,
    [propertyId]
  );

  // Clone global booking_sources (property_id IS NULL rows) for this property
  // ($1 is cast explicitly in both spots — used as text in the id concat and
  // as uuid in the property_id column, and a single placeholder can't be both
  // without a cast at each occurrence)
  await db.query(
    `INSERT INTO booking_sources (id, label, is_ota, color, is_active, sort_order, property_id)
     SELECT id || '-' || $1::text, label, is_ota, color, is_active, sort_order, $1::uuid
     FROM booking_sources WHERE property_id IS NULL
     ON CONFLICT DO NOTHING`,
    [propertyId]
  );

  // Clone global payment_methods
  await db.query(
    `INSERT INTO payment_methods (id, label, is_active, sort_order, property_id)
     SELECT id || '-' || $1::text, label, is_active, sort_order, $1::uuid
     FROM payment_methods WHERE property_id IS NULL
     ON CONFLICT DO NOTHING`,
    [propertyId]
  );

  // Clone global roles
  await db.query(
    `INSERT INTO roles (id, label, allowed_menus, property_id)
     SELECT id || '-' || $1::text, label, allowed_menus, $1::uuid
     FROM roles WHERE property_id IS NULL
     ON CONFLICT DO NOTHING`,
    [propertyId]
  );

  // Seed all modules — all enabled by default except room_controller
  const moduleEntries = Object.keys(MODULES).map(module => ({
    module,
    is_enabled: module !== 'room_controller'
  }));

  for (const { module, is_enabled } of moduleEntries) {
    await db.query(
      `INSERT INTO property_modules (property_id, module, is_enabled)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [propertyId, module, is_enabled]
    );
  }
}

module.exports = seedPropertyDefaults;
