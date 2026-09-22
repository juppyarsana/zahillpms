-- ============================================================
-- Migration 064 — activity_bookings.payment_method joins the dynamic
-- payment_methods system
--
-- Same fix migration 048 already made for sales.payment_method:
-- activity_bookings.payment_method was still a hardcoded
-- cash/qris/room_charge CHECK (migration 037), so a property that
-- renamed/added payment methods in Settings could never select them
-- for an activity booking. Drop the CHECK, widen the column (a
-- namespaced payment_methods.id can run 42+ chars — see migration
-- 048's note), and move validation into
-- server/services/activityBookingService.js against the property's
-- real payment_methods table, the same choke point salesService.js
-- already uses. Additive/widening only — no data changes.
-- ============================================================

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'activity_bookings'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%payment_method%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE activity_bookings DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE activity_bookings ALTER COLUMN payment_method TYPE VARCHAR(50);
