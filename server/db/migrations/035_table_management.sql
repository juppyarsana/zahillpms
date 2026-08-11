-- ============================================================
-- Migration 035 — Table Management (Phase D #10, second slice)
--
-- Formalizes the free-text sales.table_number (added in 034) into real
-- table entities with an occupancy status, so dine-in orders are placed
-- against a known table instead of typed-in text. table_number is kept
-- as-is (denormalized to the table's name at order time) so existing rows
-- and the Kitchen Display's read of s.table_number need no changes;
-- sales.table_id is the new source of truth for occupancy tracking.
-- ============================================================

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        VARCHAR(50) NOT NULL,
  capacity    INT,
  status      VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_property ON restaurant_tables(property_id);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES restaurant_tables(id) ON DELETE SET NULL;
