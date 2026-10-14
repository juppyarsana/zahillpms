-- 109: "To check" on a booking — points front desk still has to look at.
-- Written by the VHP reservation import (maintenance/importVhpReservations.js)
-- for anything the old system's file left unclear: a room picked by the
-- import, an agent not found, no rate, placeholder guest names, guests
-- guessed. Reusable later for channel-manager reservations (room picked on
-- arrival). The booking itself is a normal booking that holds its room.
--   to_check          — JSON array of short texts, one per point; NULL = nothing to check
--   to_check_done_at  — set when FO presses "Checked" (who in to_check_done_by)
-- Additive only.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS to_check         JSONB;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS to_check_done_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS to_check_done_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_to_check_open ON bookings (property_id)
  WHERE to_check IS NOT NULL AND to_check_done_at IS NULL;
