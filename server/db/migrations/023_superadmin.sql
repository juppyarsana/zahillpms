-- ============================================================
-- Migration 023 — Superadmin accounts + platform-default templates
-- ============================================================

-- Superadmins are platform-level accounts, not scoped to a single property.
-- Make property_id nullable on users so superadmins don't belong to one property.
ALTER TABLE users ALTER COLUMN property_id DROP NOT NULL;

-- Drop the per-property unique constraint on email (superadmin email must be
-- globally unique, and this constraint was (email, property_id) from 019).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_property_unique;

-- Re-add: email unique globally (one account per email across the whole platform).
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Flag for superadmin accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false;

-- Seed one superadmin account (change email/password as needed after migration).
-- Password hash below is bcrypt of 'superadmin123' — must be changed immediately.
-- (Regenerated with bcryptjs at migration-authoring time; the hash from the
-- original task spec did not actually match 'superadmin123'.)
INSERT INTO users (name, email, password_hash, role, is_superadmin, property_id)
VALUES (
  'Platform Admin',
  'admin@platform.com',
  '$2a$10$gCKHg/Xk.QoUCtkSiasQl.IyAxvf2V9LIJwKCiMa0sUq3yDHqB6d6',
  'owner',
  true,
  NULL
) ON CONFLICT (email) DO NOTHING;

-- ── Platform-default templates ────────────────────────────────
-- seedPropertyDefaults.js clones booking_sources / payment_methods / roles
-- WHERE property_id IS NULL for every new property. No such rows exist yet —
-- migration 019 backfilled all of Zahill's rows to its own property_id, it
-- never created NULL "template" rows. Without these, every newly onboarded
-- property would start with zero booking sources, payment methods, or roles.
-- Seeded from Zahill's current values, which are this PMS's generic defaults
-- (not Zahill-specific branding).

INSERT INTO booking_sources (id, label, is_ota, color, is_active, sort_order, property_id) VALUES
  ('direct',      'Direct',       false, '#16a34a', true, 0, NULL),
  ('airbnb',      'Airbnb',       true,  '#FF5A5F', true, 1, NULL),
  ('booking_com', 'Booking.com',  true,  '#003580', true, 2, NULL),
  ('traveloka',   'Traveloka',    true,  '#0770CF', true, 3, NULL),
  ('walkin',      'Walk-in',      false, '#6b7280', true, 4, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO payment_methods (id, label, is_active, sort_order, property_id) VALUES
  ('bank_transfer', 'Bank Transfer', true, 0, NULL),
  ('qris',          'QRIS',          true, 1, NULL),
  ('cash',          'Cash',          true, 2, NULL),
  ('ota_managed',   'OTA Managed',   true, 3, NULL),
  ('wise',          'Wise',          true, 4, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO roles (id, label, allowed_menus, property_id) VALUES
  ('owner', 'Owner', ARRAY['dashboard','reservations','quick_checkin','checkin_full','guests','operations','sales','loyalty','allotments','pricing','units','users','settings','room_controllers'], NULL),
  ('staff', 'Staff', ARRAY['dashboard','reservations','quick_checkin','checkin_full','guests','operations','loyalty','allotments'], NULL)
ON CONFLICT DO NOTHING;
