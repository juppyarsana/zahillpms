-- 088: Restaurant requests taken at the front desk (a reservation's
-- "Restaurant requests" card) and shown in the hotel POS.
--   breakfast_box — the included breakfast packed for a guest leaving early
--                   (trekking…): which morning, ready by when, how many boxes
--                   (≤ the room's breakfasts that morning — part of them, the
--                   rest can still eat at the restaurant).
--   other         — anything else for the restaurant, as a note (e.g. extra
--                   paid boxes, a cake at dinner). The restaurant rings up
--                   anything paid at its own till.
-- status: open → done (set by the POS: box sent to the kitchen / request
-- handled) or cancelled (front desk). Additive only.
CREATE TABLE IF NOT EXISTS restaurant_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('breakfast_box', 'other')),
  service_date  DATE NOT NULL,
  ready_time    TIME,
  quantity      INTEGER CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 99),
  note          TEXT,
  status        VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  done_by       VARCHAR(100),
  done_at       TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ,
  cancelled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_restaurant_requests_date ON restaurant_requests (property_id, service_date);
CREATE INDEX IF NOT EXISTS idx_restaurant_requests_booking ON restaurant_requests (booking_id);
