-- 153: An event can be linked to a single stay, not only to a group booking.
-- events.booking_id = the stay the event's guest is in; an event is linked to
-- a group OR to one booking, never both. Used for the combined invoice (rooms +
-- events on one printed bill — each keeps its own bill and payments). Additive.

ALTER TABLE events ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_one_link') THEN
    ALTER TABLE events ADD CONSTRAINT events_one_link CHECK (booking_id IS NULL OR reservation_group_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_booking ON events (booking_id) WHERE booking_id IS NOT NULL;
