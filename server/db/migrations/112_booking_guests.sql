-- Other guests in the room (FO, 2026-10-16): a reservation is under one guest
-- (bookings.guest_id — the one who pays, shown on the room tablet / TV); the
-- people sharing the room can be added on the booking page or at check-in,
-- optional. They are ordinary guest profiles (name, nationality, passport,
-- ID document), so a returning companion is recognised and their stays show
-- on their own profile. Printed on the Registration Card and the police guest
-- report (one line per person); price, pax and folio are unchanged.
CREATE TABLE IF NOT EXISTS booking_guests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  guest_id    UUID NOT NULL REFERENCES guests(id),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, guest_id)
);
CREATE INDEX IF NOT EXISTS idx_booking_guests_guest ON booking_guests (guest_id);
