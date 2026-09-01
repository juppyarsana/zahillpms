-- ============================================================
-- Migration 044 — Rate plans ("arrangements"), bed configuration,
-- and the room / F&B net-revenue split.
--
-- The client (ex-VHP) sells the same room with or without breakfast, and
-- needs breakfast revenue reported separately from room revenue. A room
-- also has a bed configuration (twin vs double), mostly fixed but staff
-- occasionally reconfigure it.
--
--   * rate_plans        — RO / BB / HB / FB per property; meal_price is a
--                         flat NET per-person-per-night figure.
--   * units.bed_config  — the room's current bed setup.
--   * bookings.rate_plan_id / bed_preference — what this stay was sold as.
--   * bookings.room_revenue / fnb_revenue — the NET split (pre service
--                         charge & VAT), post-discount, whole stay.
--                         Invariant: computeFolioTotals(room_revenue +
--                         fnb_revenue).total ≈ total_amount - discount_amount.
--                         total_amount keeps its meaning (pre-discount gross).
--   * folio_charges.service_date — per-night key so Slice 2 can auto-post
--                         one room + one fnb charge per night, idempotently.
--
-- All additive. folio_charges.type already allows 'room'/'fnb' (migration 028).
-- ============================================================

-- 1. Rate plans -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_plans (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  code               VARCHAR(10)   NOT NULL,            -- RO / BB / HB / FB — validated in the API layer
  name               VARCHAR(80)   NOT NULL,
  includes_breakfast BOOLEAN       NOT NULL DEFAULT false,
  includes_lunch     BOOLEAN       NOT NULL DEFAULT false,
  includes_dinner    BOOLEAN       NOT NULL DEFAULT false,
  meal_price         NUMERIC(12,2) NOT NULL DEFAULT 0,  -- NET, per person per night (all included meals combined)
  is_active          BOOLEAN       NOT NULL DEFAULT true,
  is_default         BOOLEAN       NOT NULL DEFAULT false,
  sort_order         INTEGER       NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rate_plans_property ON rate_plans(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_plans_one_default ON rate_plans(property_id) WHERE is_default;

-- Seed RO (default) + BB for every existing property. meal_price 0 — owner sets it in Settings.
INSERT INTO rate_plans (property_id, code, name, includes_breakfast, meal_price, is_default, sort_order)
SELECT id, 'RO', 'Room Only',       false, 0, true,  0 FROM properties
ON CONFLICT (property_id, code) DO NOTHING;
INSERT INTO rate_plans (property_id, code, name, includes_breakfast, meal_price, is_default, sort_order)
SELECT id, 'BB', 'Bed & Breakfast', true,  0, false, 1 FROM properties
ON CONFLICT (property_id, code) DO NOTHING;

-- 2. Bed configuration --------------------------------------------------
ALTER TABLE units    ADD COLUMN IF NOT EXISTS bed_config VARCHAR(20) NOT NULL DEFAULT 'double';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bed_preference VARCHAR(20);
-- both API-validated: 'double' | 'twin' | 'twin_or_double' | 'other'   (bed_preference nullable = no preference)

-- 3. Booking rate plan + NET revenue split -----------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS room_revenue NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fnb_revenue  NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill: everything historical was room-only, no meal plan.
-- Divide the POST-discount figure by the property's gross-up factor
-- F = (1 + service_charge_rate/100) * (1 + tax_rate/100).
UPDATE bookings b
SET room_revenue = ROUND(
      (COALESCE(b.total_amount, 0) - COALESCE(b.discount_amount, 0))
      / ((1 + COALESCE(ps.service_charge_rate, 0) / 100.0)
         * (1 + COALESCE(ps.tax_rate, 0) / 100.0)), 2)
FROM property_settings ps
WHERE ps.property_id = b.property_id
  AND b.room_revenue IS NULL;

-- Any booking whose property has no property_settings row: fall back to net = post-discount total.
UPDATE bookings
SET room_revenue = COALESCE(total_amount, 0) - COALESCE(discount_amount, 0)
WHERE room_revenue IS NULL;

-- 4. folio_charges: per-night service date + idempotency --------------
ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS service_date DATE;   -- NULL = one-off charge

-- At most one live room row and one live fnb row per booking per night.
-- Voided rows drop out of the predicate, so a re-post after a void is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_charges_night
  ON folio_charges (booking_id, type, service_date)
  WHERE service_date IS NOT NULL AND is_voided = false;

CREATE INDEX IF NOT EXISTS idx_folio_charges_service_date
  ON folio_charges (service_date) WHERE service_date IS NOT NULL;

-- 5. Night audit: F&B revenue recorded separately from ancillary -------
ALTER TABLE night_audit_runs ADD COLUMN IF NOT EXISTS fnb_revenue NUMERIC(14,2) NOT NULL DEFAULT 0;
