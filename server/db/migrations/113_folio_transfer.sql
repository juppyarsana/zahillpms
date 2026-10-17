-- Transfer bill (FO, 2026-10-17): two rooms booked separately (e.g. two OTA
-- reservations of friends) where one room pays the other's extras. Front desk
-- moves unpaid extras lines (Sales items, restaurant / POS bills, activities —
-- never room / meal nights or per-night extras) from one booking's folio to
-- another's. The line keeps its amount; only folio_charges.booking_id changes.
-- These columns say where it came from ("from room 102 · Ayu"), who moved it
-- and when. Moving a line back to the room it came from clears them.
ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS transferred_from_booking_id UUID REFERENCES bookings(id);
ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS transferred_by UUID REFERENCES users(id);
ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;
