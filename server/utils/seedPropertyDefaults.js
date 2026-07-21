const db = require('../db');
const MODULES = require('../modules');

// Kept in sync with the Zahill seed rows in migration 030_guest_communication.sql —
// same three templates, just seeded per-property instead of hardcoded to Zahill's id.
const DEFAULT_EMAIL_TEMPLATES = [
  {
    trigger: 'booking_confirmed',
    subject: 'Booking Confirmed — {{property_name}}',
    body_html: `<h2>Hi {{guest_name}},</h2>
   <p>Your booking is confirmed!</p>
   <p><strong>Unit:</strong> {{unit_name}}<br>
   <strong>Check-in:</strong> {{check_in_date}}<br>
   <strong>Check-out:</strong> {{check_out_date}}<br>
   <strong>Nights:</strong> {{nights}}</p>
   <p>We look forward to welcoming you.<br>{{property_name}}</p>`,
  },
  {
    trigger: 'pre_arrival',
    subject: 'See You Tomorrow — {{property_name}}',
    body_html: `<h2>Hi {{guest_name}},</h2>
   <p>Your stay at {{property_name}} is tomorrow!</p>
   <p><strong>Check-in:</strong> {{check_in_date}}<br>
   <strong>Unit:</strong> {{unit_name}}</p>
   <p>If you have any questions before arrival, just reply to this email.</p>
   <p>See you soon,<br>{{property_name}}</p>`,
  },
  {
    trigger: 'post_checkout',
    subject: 'Thank You for Staying — {{property_name}}',
    body_html: `<h2>Hi {{guest_name}},</h2>
   <p>Thank you for staying with us at {{property_name}}!</p>
   <p>We hope you had a wonderful time and we would love to welcome you back.</p>
   <p>If you have a moment, we would greatly appreciate a review of your stay.</p>
   <p>Warm regards,<br>{{property_name}}</p>`,
  },
];

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

  // Clone global booking_sources (property_id IS NULL rows) for this property.
  // Ids are NOT namespaced with the property uuid — the (id, property_id)
  // composite unique index (migration 020) already lets every property reuse
  // the same bare id (e.g. 'direct', 'owner'), and a long list of code across
  // the app compares these ids literally (requireRole('owner'), OTA_SOURCES
  // checks, etc.) so a namespaced id silently breaks that everywhere except
  // Zahill, whose rows predate multi-tenancy and kept their bare ids.
  await db.query(
    `INSERT INTO booking_sources (id, label, is_ota, color, is_active, sort_order, property_id)
     SELECT id, label, is_ota, color, is_active, sort_order, $1::uuid
     FROM booking_sources WHERE property_id IS NULL
     ON CONFLICT DO NOTHING`,
    [propertyId]
  );

  // Clone global payment_methods
  await db.query(
    `INSERT INTO payment_methods (id, label, is_active, sort_order, property_id)
     SELECT id, label, is_active, sort_order, $1::uuid
     FROM payment_methods WHERE property_id IS NULL
     ON CONFLICT DO NOTHING`,
    [propertyId]
  );

  // Clone global roles
  await db.query(
    `INSERT INTO roles (id, label, allowed_menus, property_id)
     SELECT id, label, allowed_menus, $1::uuid
     FROM roles WHERE property_id IS NULL
     ON CONFLICT DO NOTHING`,
    [propertyId]
  );

  // Default email templates for the three Phase B trigger points
  for (const t of DEFAULT_EMAIL_TEMPLATES) {
    await db.query(
      `INSERT INTO email_templates (property_id, trigger, subject, body_html)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (property_id, trigger) DO NOTHING`,
      [propertyId, t.trigger, t.subject, t.body_html]
    );
  }

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
