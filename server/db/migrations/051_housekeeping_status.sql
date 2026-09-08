-- Housekeeping / room-condition status — a second, orthogonal dimension to
-- units.status (which stays purely occupancy/availability: available /
-- occupied / maintenance / blocked). A room can be `available` AND `dirty`
-- (just checked out, not yet cleaned) — front office needs to see that
-- difference, and housekeeping needs somewhere to mark the room done.
--
-- v1 flow is checkout-cleaning only: checkout sets `dirty`, housekeeping
-- taps "Mark Room Clean" on the room tablet (or front desk clicks it on the
-- Dashboard tile) to set `clean`. No stayover/daily-service tracking yet.
-- 'inspected' is reserved in the CHECK for a possible later supervisor step
-- so adding it doesn't need another migration; nothing writes it today.

ALTER TABLE units ADD COLUMN IF NOT EXISTS housekeeping_status VARCHAR(20) NOT NULL DEFAULT 'clean'
  CHECK (housekeeping_status IN ('clean', 'dirty', 'inspected'));
ALTER TABLE units ADD COLUMN IF NOT EXISTS housekeeping_updated_at TIMESTAMPTZ;

-- Deploy-time backfill: a room with an open housekeeping task right now is
-- really dirty, not clean (the DEFAULT above). Scoped per unit; property
-- isolation is inherent since tasks.unit_id already points at one unit.
UPDATE units u SET housekeeping_status = 'dirty', housekeeping_updated_at = NOW()
WHERE u.housekeeping_status = 'clean'
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.unit_id = u.id AND t.type = 'housekeeping' AND t.status <> 'done'
  );
