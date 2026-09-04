-- ============================================================
-- Guest Messages — front desk sends a message to a room's Room
-- Display (e.g. checkout reminder, "your order is ready"). Kept
-- separate from the email/SMTP Guest Communication system (that's
-- for formal comms — confirmations, invoices — and is heavy
-- machinery for a quick on-screen nudge). Manual send only for
-- now; sent_by is nullable so an automated trigger can reuse the
-- same table later without a schema change.
-- ============================================================

CREATE TABLE IF NOT EXISTS guest_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  sent_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  read_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_guest_messages_unit_unread
  ON guest_messages(unit_id) WHERE read_at IS NULL;
