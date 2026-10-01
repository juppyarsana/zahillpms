-- A price per night (2026-10-01). A booking stored one price for the whole
-- stay, spread evenly over its nights — an agent rate that differs night by
-- night (weekday / weekend) could only be entered as a total.
--
-- booking_night_rates holds each night's NET room amount (the meal plan stays
-- the same every night). The stay's total is still bookings.room_revenue: the
-- rows say how it is shared between the nights (services/nightRates.js). They
-- count only when there is exactly one row per night of the stay; otherwise —
-- and for every existing booking, which has none — the even split is used, as
-- before. No property_id: scoped through bookings, like payments. Additive.
CREATE TABLE IF NOT EXISTS booking_night_rates (
  booking_id  UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  night       DATE          NOT NULL,
  room_net    NUMERIC(12,2) NOT NULL CHECK (room_net >= 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (booking_id, night)
);
