-- 141: Room types listed in the property's own order.
--
-- room_types.sort_order (migration 062) is now set by the owner in Settings →
-- Units (↑ ↓ on each room type) and used by every list of room types: the room
-- board on the Dashboard, the Reservations calendar, Call a Room, Pricing,
-- Availability, Forecast, Housekeeping, Reports.
--
-- Until now the Dashboard, Reservations calendar and Call a Room ignored it and
-- sorted by a fixed list of words (Villa, Suite, Glamping, Deluxe, then the
-- rest alphabetically). Start every property from that order so nothing moves
-- for front desk on the day this ships.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY property_id
           ORDER BY CASE
                      WHEN strpos(name, 'Villa') > 0 THEN 0
                      WHEN strpos(name, 'Suite') > 0 THEN 1
                      WHEN strpos(name, 'Glamping') > 0 THEN 2
                      WHEN strpos(name, 'Deluxe') > 0 THEN 3
                      ELSE 99
                    END,
                    name
         )::int AS n
  FROM room_types
)
UPDATE room_types rt SET sort_order = ranked.n
FROM ranked WHERE rt.id = ranked.id AND rt.sort_order IS DISTINCT FROM ranked.n;
