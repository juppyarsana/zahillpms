-- ============================================================
-- Migration 041 — Agent Accounts / Direct Billing (Phase D #13, Slice A)
--
-- The property takes many bookings placed by a company or travel agent
-- rather than an individual guest. The defining difference from Group
-- Bookings (#9) isn't room count — it's WHO PAYS AND WHEN: the guest may
-- pay the agent, the agent settles with the property later (city ledger /
-- AR), or the property owes the agent a commission.
--
-- Per the ROADMAP #13 scope, we do NOT add a standalone `companies` table.
-- Instead we generalize the existing per-property `booking_sources` table
-- (already what NewBooking's Source dropdown picks from) into a full
-- "Agent" concept: "company" / "travel_agent" / "wholesaler" become
-- `source_type` values, and the billing behavior is a separate
-- `payment_status` field on the same row.
--
-- All columns here are additive. `bookings.source` already stores the
-- `booking_sources.id` it was assigned at creation, so `bookings` needs no
-- change. `is_ota` is kept as-is (checkin.js's OTA_SOURCES array and the
-- calendar rendering still key off it) — `source_type` is purely additive.
--
-- Slice A is schema + Settings CRUD + informational UI only. The
-- city-ledger checkout flow, agent_commissions ledger, per-agent
-- statements / consolidated invoice, and AR aging report are Slices B / C.
-- ============================================================

ALTER TABLE booking_sources
  ADD COLUMN IF NOT EXISTS source_type       VARCHAR(20)  NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS payment_status    VARCHAR(30)  NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS billing_address   TEXT,
  ADD COLUMN IF NOT EXISTS tax_id            VARCHAR(40),
  ADD COLUMN IF NOT EXISTS contact_name      VARCHAR(120),
  ADD COLUMN IF NOT EXISTS contact_email     VARCHAR(160),
  ADD COLUMN IF NOT EXISTS contact_phone     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS credit_terms_days INT,
  ADD COLUMN IF NOT EXISTS credit_limit      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS commission_type   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS commission_value  NUMERIC(14,2);

-- source_type allowed values:
--   walkin / direct / booking_engine / ota / travel_agent / company / wholesaler
-- payment_status allowed values:
--   normal / city_ledger / city_ledger_payment / commission / commission_and_city_ledger
-- (enforced in the API layer, not a CHECK constraint — consistent with how
--  booking_sources.id / bookings.source are already handled)

-- Backfill source_type from existing data so the Settings UI shows sensible
-- values immediately for already-onboarded properties.
UPDATE booking_sources SET source_type = 'ota'    WHERE is_ota = true;
UPDATE booking_sources SET source_type = 'walkin' WHERE id = 'walkin' AND is_ota = false;
-- everything else keeps the 'direct' default
