-- ============================================================
-- Migration 019 — Multi-tenancy
-- Adds a `properties` table and scopes all existing data to
-- Zahill as the first tenant. After this migration the system
-- can serve multiple properties from a single deployment.
--
-- Safe to run on an existing Zahill database — all existing
-- rows are backfilled to property_id = ZAHILL_ID before any
-- NOT NULL constraint is applied.
-- ============================================================

-- ── Step 1: Properties table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(200) NOT NULL,
  slug        VARCHAR(100) NOT NULL UNIQUE,   -- subdomain key e.g. "zahill"
  plan        VARCHAR(20)  NOT NULL DEFAULT 'basic',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Step 2: Seed Zahill as tenant #1 ─────────────────────────
-- Fixed UUID so the backfill below is deterministic.
INSERT INTO properties (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Zahill', 'zahill', 'pro')
ON CONFLICT (id) DO NOTHING;

-- Convenient variable — reference this UUID throughout.
-- In raw SQL sessions use the literal; in app code use the
-- ZAHILL_PROPERTY_ID env var you set after seeding.
DO $$ BEGIN
  PERFORM set_config('app.zahill_id', '00000000-0000-0000-0000-000000000001', false);
END $$;


-- ── Step 3: Add property_id columns ──────────────────────────
-- All nullable first so backfill can run without errors.

ALTER TABLE users           ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE units           ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE guests          ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE bookings        ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE tasks           ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE sales           ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE loyalty_tiers   ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE products        ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE pricing_periods ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE guest_board_cards ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE competitors     ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE search_trends   ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE night_audit_runs ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;

-- booking_sources, payment_methods, roles — currently global
-- seed tables. Adding property_id makes them per-property so
-- each tenant can customise. NULL = global default (reserved).
ALTER TABLE booking_sources ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE roles           ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;


-- ── Step 4: Backfill all existing rows → Zahill ──────────────
UPDATE users            SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE units            SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE guests           SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE bookings         SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE tasks            SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE sales            SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE loyalty_tiers    SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE products         SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE pricing_periods  SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE guest_board_cards SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE competitors      SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE search_trends    SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE night_audit_runs SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE booking_sources  SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE payment_methods  SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;
UPDATE roles            SET property_id = '00000000-0000-0000-0000-000000000001' WHERE property_id IS NULL;


-- ── Step 5: Apply NOT NULL now that backfill is done ─────────
ALTER TABLE users            ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE units            ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE guests           ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE bookings         ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE tasks            ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE sales            ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE loyalty_tiers    ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE products         ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE pricing_periods  ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE guest_board_cards ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE competitors      ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE search_trends    ALTER COLUMN property_id SET NOT NULL;
ALTER TABLE night_audit_runs ALTER COLUMN property_id SET NOT NULL;
-- booking_sources / payment_methods / roles stay nullable
-- (NULL rows = platform defaults, non-NULL = per-property overrides)


-- ── Step 6: Fix unique constraints that were global ──────────

-- users.email was globally unique → now unique per property
-- (same email can be staff at two different properties)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ADD CONSTRAINT users_email_property_unique UNIQUE (email, property_id);

-- units.name was globally unique → now unique per property
ALTER TABLE units DROP CONSTRAINT IF EXISTS units_name_key;
ALTER TABLE units ADD CONSTRAINT units_name_property_unique UNIQUE (name, property_id);

-- night_audit_runs.business_date was globally unique → per property
ALTER TABLE night_audit_runs DROP CONSTRAINT IF EXISTS night_audit_runs_business_date_key;
ALTER TABLE night_audit_runs ADD CONSTRAINT night_audit_runs_date_property_unique UNIQUE (business_date, property_id);


-- ── Step 7: Convert singleton tables to per-property rows ────

-- property_settings: was a single row (id = 1), now one row per property.
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS property_id UUID UNIQUE REFERENCES properties(id) ON DELETE CASCADE;
UPDATE property_settings SET property_id = '00000000-0000-0000-0000-000000000001' WHERE id = 1;

-- ai_market_summary: same pattern
ALTER TABLE ai_market_summary ADD COLUMN IF NOT EXISTS property_id UUID UNIQUE REFERENCES properties(id) ON DELETE CASCADE;
UPDATE ai_market_summary SET property_id = '00000000-0000-0000-0000-000000000001' WHERE id = 1;


-- ── Step 8: Indexes for all property_id columns ───────────────
CREATE INDEX IF NOT EXISTS idx_users_property           ON users(property_id);
CREATE INDEX IF NOT EXISTS idx_units_property           ON units(property_id);
CREATE INDEX IF NOT EXISTS idx_guests_property          ON guests(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_property        ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_tasks_property           ON tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_property           ON sales(property_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_property   ON loyalty_tiers(property_id);
CREATE INDEX IF NOT EXISTS idx_products_property        ON products(property_id);
CREATE INDEX IF NOT EXISTS idx_pricing_periods_property ON pricing_periods(property_id);
CREATE INDEX IF NOT EXISTS idx_guest_board_property     ON guest_board_cards(property_id);
CREATE INDEX IF NOT EXISTS idx_competitors_property     ON competitors(property_id);
CREATE INDEX IF NOT EXISTS idx_search_trends_property   ON search_trends(property_id);
CREATE INDEX IF NOT EXISTS idx_night_audit_property     ON night_audit_runs(property_id);
CREATE INDEX IF NOT EXISTS idx_booking_sources_property ON booking_sources(property_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_property ON payment_methods(property_id);
CREATE INDEX IF NOT EXISTS idx_roles_property           ON roles(property_id);


-- ── Tables that do NOT need property_id ──────────────────────
-- These are always accessed through a parent that is already
-- scoped — no direct property filter needed:
--
--  payments        → via bookings (which has property_id)
--  checkin_records → via bookings
--  allotments      → via units
--  booking_notes   → via bookings
--  sale_items      → via sales
--  loyalty_perks   → via loyalty_tiers
--  guest_preferences → via guests
--  unit_relays     → via units
--  room_controller_status → via controller_id → units.controller_id
--  calls           → via units
--
-- holidays         → global reference table, shared across all tenants
