-- ============================================================
-- Migration 021 — Per-property display authentication
-- Room Display / TV Display devices previously all shared one
-- global DISPLAY_TOKEN env var with no property association,
-- so any device could query any property's room state. Give
-- each property its own display_token instead.
--
-- Zahill's row is seeded with the literal value that was in
-- DISPLAY_TOKEN ('zahill') so already-provisioned Room/TV
-- Displays keep working without re-provisioning. New properties
-- get a random token that the owner retrieves via
-- GET /api/settings/display-token.
-- ============================================================

ALTER TABLE properties ADD COLUMN IF NOT EXISTS display_token VARCHAR(100) UNIQUE;

UPDATE properties SET display_token = 'zahill' WHERE id = '00000000-0000-0000-0000-000000000001' AND display_token IS NULL;

-- Any other existing property (none today) gets a random token so the column can go NOT NULL.
-- Uses uuid-ossp (already enabled) rather than pgcrypto, which isn't installed on this DB.
UPDATE properties SET display_token = replace(uuid_generate_v4()::text, '-', '') WHERE display_token IS NULL;

ALTER TABLE properties ALTER COLUMN display_token SET NOT NULL;
