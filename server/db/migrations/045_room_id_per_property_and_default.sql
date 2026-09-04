-- ============================================================
-- Migration 045 — Room ID (controller_id): scope it per-property
-- and default it to the room name.
--
-- "controller_id" is the string a Room Display / TV Display /
-- Kitchen Display tablet uses to identify which room it's mounted
-- in. It long predates multi-tenancy and predates those apps —
-- the name is legacy; conceptually it's just "Room ID", and it's
-- needed even by properties with no ESP32 hardware (migration 040
-- already decoupled it from the room_controller module).
--
-- Two problems this fixes:
--   1. UNIQUE (controller_id) was GLOBAL, not per-property — two
--      properties could not both have a room "101". Now scoped
--      (controller_id, property_id), like every other table.
--   2. It had no default — staff had to type a Room ID for every
--      room, almost always just re-typing the room number. Now it
--      defaults to the room name (see routes/units.js), and this
--      migration backfills existing rooms the same way.
--
-- controller_id widened 10 → 32 chars so non-numeric room names
-- ("Ocean Villa") can auto-fill too. Still fully overridable for
-- properties whose ESP32 firmware uses a different id scheme.
-- ============================================================

ALTER TABLE units ALTER COLUMN controller_id TYPE VARCHAR(32);

-- 1. Per-property uniqueness (was a global partial unique index)
DROP INDEX IF EXISTS units_controller_id_key;
CREATE UNIQUE INDEX units_controller_id_property_unique
  ON units (controller_id, property_id)
  WHERE controller_id IS NOT NULL;

-- 2. Backfill Room ID from the room name, where it fits the column
--    and doesn't collide with an already-assigned id in the same
--    property. Rooms skipped here (long name, or a custom id already
--    points at this name) keep controller_id NULL for manual setup.
UPDATE units u
SET controller_id = u.name
WHERE u.controller_id IS NULL
  AND char_length(u.name) <= 32
  AND NOT EXISTS (
    SELECT 1 FROM units x
    WHERE x.property_id = u.property_id
      AND x.controller_id = u.name
  );
