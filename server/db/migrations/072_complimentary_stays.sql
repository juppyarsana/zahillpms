-- 072: Complimentary stays.
-- A booking can be made complimentary (free) with a scope:
--   room       — the room is free, meals on the rate plan and extras are paid
--   room_meals — room + rate-plan meals free, extras charged to the room paid
--   all        — everything free, incl. extras charged to the room
-- The price goes to what's still payable (0, or the meals); the value given
-- away is kept per night so reports can show "Complimentary: N nights, value
-- Rp X" and leave comp nights out of ADR (they still count for occupancy).
-- Granted directly by the owner / a role with the `grant_complimentary`
-- permission, or by any staff with a one-time code an approver gets on
-- Telegram (complimentary_requests below). See services/complimentaryService.js.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_scope VARCHAR(12)
  CHECK (complimentary_scope IN ('room', 'room_meals', 'all'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_reason TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_approved_by VARCHAR(100);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_at TIMESTAMPTZ;
-- NET (before service/tax) value given away per night: room, + meals when covered.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_night_value NUMERIC(12,2);
-- The price before it was made complimentary — restored (per night) on undo.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_prev_total NUMERIC(12,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_prev_discount NUMERIC(12,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_prev_nights INT;

-- A request for approval: one per ask, locked to the booking as it was
-- (fingerprint) and to the scope + reason asked for.
CREATE TABLE IF NOT EXISTS complimentary_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  scope        VARCHAR(12) NOT NULL CHECK (scope IN ('room', 'room_meals', 'all')),
  reason       TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  status       VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'cancelled')),
  attempts     INT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  approved_by_name VARCHAR(100),
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comp_requests_booking ON complimentary_requests (booking_id, status);

-- Each approver gets their own code, so the booking records who approved.
CREATE TABLE IF NOT EXISTS complimentary_request_codes (
  request_id     UUID NOT NULL REFERENCES complimentary_requests(id) ON DELETE CASCADE,
  recipient_id   UUID REFERENCES notification_recipients(id) ON DELETE SET NULL,
  recipient_name VARCHAR(100) NOT NULL,
  code_hash      VARCHAR(64) NOT NULL,
  PRIMARY KEY (request_id, code_hash)
);
