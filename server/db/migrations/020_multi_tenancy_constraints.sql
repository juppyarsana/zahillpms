-- ============================================================
-- Migration 020 — Fix global unique constraints left over from
-- migration 019 that would collide across two different
-- properties. Safe to run with only Zahill as a tenant since
-- these constraints are currently *more* restrictive (globally
-- unique) than what they're being replaced with (unique per
-- property) — no existing row can violate the new constraints.
-- ============================================================

-- ── booking_sources / payment_methods / roles ────────────────
-- id was the PRIMARY KEY (globally unique). property_id is
-- nullable on these three tables — NULL rows are reserved for
-- future platform-default templates (see MULTI_TENANCY.md
-- seedPropertyDefaults). Replace the single PK with two partial
-- unique indexes so:
--   - two properties CAN each have their own row with the same id
--   - default template rows (property_id IS NULL) stay unique among themselves
-- No other table has a foreign key against these three tables'
-- id column, so dropping the PK is safe.

ALTER TABLE booking_sources DROP CONSTRAINT IF EXISTS booking_sources_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS booking_sources_id_property_unique ON booking_sources (id, property_id) WHERE property_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS booking_sources_id_global_unique ON booking_sources (id) WHERE property_id IS NULL;

ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_id_property_unique ON payment_methods (id, property_id) WHERE property_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_id_global_unique ON payment_methods (id) WHERE property_id IS NULL;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS roles_id_property_unique ON roles (id, property_id) WHERE property_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roles_id_global_unique ON roles (id) WHERE property_id IS NULL;

-- ── competitors.place_id ──────────────────────────────────────
-- property_id is NOT NULL here already, so a plain composite
-- unique constraint is enough. id stays the PK (competitor_snapshots
-- has a real FK against it).
ALTER TABLE competitors DROP CONSTRAINT IF EXISTS competitors_place_id_unique;
ALTER TABLE competitors ADD CONSTRAINT competitors_place_id_property_unique UNIQUE (place_id, property_id);

-- ── search_trends (term, point_date) ──────────────────────────
-- property_id is NOT NULL here already.
ALTER TABLE search_trends DROP CONSTRAINT IF EXISTS search_trends_term_point_date_key;
ALTER TABLE search_trends ADD CONSTRAINT search_trends_term_point_date_property_key UNIQUE (term, point_date, property_id);
