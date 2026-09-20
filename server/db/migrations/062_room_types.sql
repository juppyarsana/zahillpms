-- ============================================================
-- Migration 062 — Room types as a real entity
--
-- Until now a room's "type" was free text on `units` and every room carried its
-- own base_rate, so one price per type wasn't enforced and changing a type's rate
-- meant editing every room. `room_types` becomes the single source of truth for a
-- type's name, base rate and max guests.
--
-- SAFE ROLLOUT: `units.type`, `units.base_rate` and `units.max_guests` are KEPT as
-- read-only mirrors, filled in by triggers from the room's room type. Every existing
-- reader (dashboard, reservations calendar, booking quotes, yield pricing, Channex
-- push, Room Display, …) keeps reading those columns unchanged, and the mirror can
-- never drift because only the triggers write it.
--
-- Legacy inserts that still set only `units.type` (seed scripts, old clients) keep
-- working: the trigger finds-or-creates the matching room type.
-- ============================================================

CREATE TABLE IF NOT EXISTS room_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_rate   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (base_rate >= 0),
  max_guests  INT NOT NULL DEFAULT 2 CHECK (max_guests BETWEEN 1 AND 20),
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, name)
);
CREATE INDEX IF NOT EXISTS idx_room_types_property ON room_types(property_id);
-- 'Deluxe' and 'deluxe' must not be two room types.
CREATE UNIQUE INDEX IF NOT EXISTS uq_room_types_property_lower_name ON room_types(property_id, LOWER(name));

ALTER TABLE units ADD COLUMN IF NOT EXISTS room_type_id UUID REFERENCES room_types(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_units_room_type ON units(room_type_id);

-- ── SAFEGUARD: refuse to run if it would change any room's price or capacity ────
-- From now on a room ALWAYS takes its rate and max guests from its room type, so a type
-- whose rooms currently disagree would have some rooms silently re-priced the next time
-- they are updated. Rather than guess which value is right, stop before touching anything
-- (the whole migration is one transaction, so nothing is changed) and list the problems.
-- Only properties WITH BOOKING HISTORY are protected this way: a property nobody has booked
-- yet (e.g. the demo rooms seeded by 001 on a fresh install) just gets a NOTICE, since no real
-- price is at stake.
DO $$
DECLARE r RECORD; problems TEXT := '';
BEGIN
  FOR r IN
    SELECT property_id, COALESCE(NULLIF(TRIM(type), ''), 'Unassigned') AS tname,
           COUNT(*) AS rooms,
           COUNT(DISTINCT base_rate) AS rate_variants, MIN(base_rate) AS min_rate, MAX(base_rate) AS max_rate,
           COUNT(DISTINCT max_guests) AS guest_variants, MIN(max_guests) AS min_guests, MAX(max_guests) AS max_guests_v
    FROM units
    WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.property_id = units.property_id)
    GROUP BY property_id, COALESCE(NULLIF(TRIM(type), ''), 'Unassigned')
    HAVING COUNT(DISTINCT base_rate) > 1 OR COUNT(DISTINCT max_guests) > 1
    ORDER BY 1, 2
  LOOP
    problems := problems || format(
      E'\n  - property %s, type "%s" (%s rooms): base rate %s to %s (%s different), max guests %s to %s (%s different)',
      r.property_id, r.tname, r.rooms, r.min_rate, r.max_rate, r.rate_variants, r.min_guests, r.max_guests_v, r.guest_variants);
  END LOOP;

  -- Properties with no bookings: keep going (the most common value wins) but say so.
  FOR r IN
    SELECT property_id, COALESCE(NULLIF(TRIM(type), ''), 'Unassigned') AS tname, COUNT(*) AS rooms
    FROM units
    WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.property_id = units.property_id)
    GROUP BY property_id, COALESCE(NULLIF(TRIM(type), ''), 'Unassigned')
    HAVING COUNT(DISTINCT base_rate) > 1 OR COUNT(DISTINCT max_guests) > 1
  LOOP
    RAISE NOTICE 'MIXED VALUES (property % has no bookings, continuing): type "%" (% rooms) has different rates/capacities — the most common value is used', r.property_id, r.tname, r.rooms;
  END LOOP;

  -- 'Deluxe' vs 'deluxe' would become two room types that differ only by case, which the
  -- new case-insensitive uniqueness forbids (applies to every property).
  FOR r IN
    SELECT property_id, array_agg(DISTINCT TRIM(type)) AS spellings
    FROM units WHERE COALESCE(TRIM(type), '') <> ''
    GROUP BY property_id, LOWER(TRIM(type))
    HAVING COUNT(DISTINCT TRIM(type)) > 1
    ORDER BY 1
  LOOP
    problems := problems || format(E'\n  - property %s: these type names differ only by upper/lower case: %s', r.property_id, r.spellings);
  END LOOP;

  IF problems <> '' THEN
    RAISE EXCEPTION E'Migration 062 (room types) STOPPED — no data was changed. Fix these first, then deploy again:%\n\nMake every room of a type share the SAME base rate and max guests (and spell each type name one way) in Unit Settings, or with an UPDATE on the units table.', problems;
  END IF;
END $$;

-- ── Backfill: one room type per (property, distinct existing type) ─────────────
-- (In properties protected by the safeguard every type is uniform, so the most-common-value
-- picks below are exact; a property with no bookings that has mixed values gets the most common
-- one.) Rooms with a blank type are grouped into a type called 'Unassigned'.

INSERT INTO room_types (property_id, name, base_rate, max_guests, description, sort_order)
SELECT property_id, tname,
       MODE() WITHIN GROUP (ORDER BY base_rate),
       MODE() WITHIN GROUP (ORDER BY max_guests),
       COALESCE(MODE() WITHIN GROUP (ORDER BY NULLIF(description, '')), ''),
       -- priciest type first, matching how a property lists its rooms
       (ROW_NUMBER() OVER (PARTITION BY property_id ORDER BY MODE() WITHIN GROUP (ORDER BY base_rate) DESC, tname))::int
FROM (
  SELECT property_id, base_rate, max_guests, description,
         COALESCE(NULLIF(TRIM(type), ''), 'Unassigned') AS tname
  FROM units
) u
GROUP BY property_id, tname
ON CONFLICT (property_id, name) DO NOTHING;

UPDATE units u SET room_type_id = rt.id
FROM room_types rt
WHERE rt.property_id = u.property_id
  AND rt.name = COALESCE(NULLIF(TRIM(u.type), ''), 'Unassigned')
  AND u.room_type_id IS NULL;

-- ── Trigger 1: a room always mirrors its room type ────────────────────────────
CREATE OR REPLACE FUNCTION units_sync_from_room_type() RETURNS trigger AS $$
DECLARE rt room_types%ROWTYPE;
BEGIN
  -- Legacy path: only the free-text type was supplied → find or create the room type.
  IF NEW.room_type_id IS NULL AND COALESCE(NULLIF(TRIM(NEW.type), ''), '') <> '' THEN
    SELECT * INTO rt FROM room_types WHERE property_id = NEW.property_id AND LOWER(name) = LOWER(TRIM(NEW.type));
    IF NOT FOUND THEN
      INSERT INTO room_types (property_id, name, base_rate, max_guests)
      VALUES (NEW.property_id, TRIM(NEW.type), COALESCE(NEW.base_rate, 0), COALESCE(NEW.max_guests, 2))
      RETURNING * INTO rt;
    END IF;
    NEW.room_type_id := rt.id;
  END IF;

  IF NEW.room_type_id IS NOT NULL THEN
    SELECT * INTO rt FROM room_types WHERE id = NEW.room_type_id;
    IF rt.property_id <> NEW.property_id THEN
      RAISE EXCEPTION 'Room type belongs to a different property';
    END IF;
    NEW.type := rt.name;
    NEW.base_rate := rt.base_rate;
    NEW.max_guests := rt.max_guests;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_units_sync_from_room_type ON units;
CREATE TRIGGER trg_units_sync_from_room_type
  BEFORE INSERT OR UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION units_sync_from_room_type();

-- ── Trigger 2: editing a room type updates all of its rooms ───────────────────
CREATE OR REPLACE FUNCTION room_types_sync_units() RETURNS trigger AS $$
BEGIN
  UPDATE units SET type = NEW.name, base_rate = NEW.base_rate, max_guests = NEW.max_guests
  WHERE room_type_id = NEW.id
    AND (type IS DISTINCT FROM NEW.name OR base_rate IS DISTINCT FROM NEW.base_rate OR max_guests IS DISTINCT FROM NEW.max_guests);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_room_types_sync_units ON room_types;
CREATE TRIGGER trg_room_types_sync_units
  AFTER UPDATE OF name, base_rate, max_guests ON room_types
  FOR EACH ROW EXECUTE FUNCTION room_types_sync_units();
