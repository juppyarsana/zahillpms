-- ============================================================
-- Migration 118 — a stay split over two rooms
--
-- Change Room "from a later night": the booking keeps its room up to that
-- night and a new booking (same guest, same group) takes the rest of the stay
-- in the new room, with the money received for those nights moved over
-- (services/splitStayService.js). The new booking points back at the one it
-- continues, so both booking pages link to each other.
-- ============================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS split_from_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_split_from ON bookings(split_from_booking_id) WHERE split_from_booking_id IS NOT NULL;
