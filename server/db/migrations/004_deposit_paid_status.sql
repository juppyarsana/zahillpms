-- Add 'deposit_paid' as an intermediate booking status between pending and confirmed.
-- pending       = no payments yet
-- deposit_paid  = deposit received, balance still owed
-- confirmed     = fully paid, ready for check-in
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed','pending','deposit_paid','checked_in','checked_out','cancelled','no_show'));
