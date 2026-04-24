-- Add required deposit amount to bookings for partial payment tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill from existing deposit payment records
UPDATE bookings SET deposit_amount = (
  SELECT COALESCE(p.amount, 0)
  FROM payments p
  WHERE p.booking_id = bookings.id AND p.type = 'deposit'
  LIMIT 1
) WHERE deposit_amount = 0;
