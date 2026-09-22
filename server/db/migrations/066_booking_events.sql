-- ============================================================
-- Migration 066 — Booking edit history
--
-- BookingDetail.jsx's new "Edit Details" action (and any other future
-- caller of PUT /api/bookings/:id) had no audit trail — a changed
-- source/guest-count/etc left no record of what changed, who changed
-- it, or when. Same append-only "note" shape as purchase_order_events
-- (migration 054), generalized to bookings instead of purchase orders.
-- Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  note        VARCHAR(500) NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id);
