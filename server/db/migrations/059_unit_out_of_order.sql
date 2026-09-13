-- ============================================================
-- Migration 059 — Room "Out of Order" status
--
-- Replaces units.status's 'maintenance'/'blocked' pair (undocumented
-- difference between the two, no reason/date ever captured, and
-- 'maintenance' already meant something else entirely — a tasks.type and
-- an expenses.category) with a single, industry-standard 'out_of_order'
-- status plus a reason and an optional expected-back date. No units on any
-- known property currently use 'maintenance' or 'blocked' — this UPDATE is
-- a safety net, not a real backfill.
-- ============================================================

UPDATE units SET status = 'out_of_order' WHERE status IN ('maintenance', 'blocked');

ALTER TABLE units DROP CONSTRAINT IF EXISTS units_status_check;
ALTER TABLE units ADD CONSTRAINT units_status_check
  CHECK (status IN ('available', 'occupied', 'out_of_order'));

ALTER TABLE units ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE units ADD COLUMN IF NOT EXISTS status_expected_back DATE;
ALTER TABLE units ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
ALTER TABLE units ADD COLUMN IF NOT EXISTS status_updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
