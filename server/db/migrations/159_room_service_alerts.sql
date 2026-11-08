-- Room service orders on Telegram (services/roomServiceAlerts.js).
-- A room tablet order sent to the POS is watched here until the POS accepts,
-- refuses or cancels it; while it waits, reminders go out every 5 minutes
-- (from 10 minutes also to front desk), at most 6.

CREATE TABLE IF NOT EXISTS room_service_watch (
  id               SERIAL PRIMARY KEY,
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  pos_order_id     TEXT NOT NULL,
  booking_id       UUID REFERENCES bookings(id) ON DELETE SET NULL,
  room             TEXT,
  guest            TEXT,
  items            JSONB NOT NULL DEFAULT '[]',
  total            NUMERIC(14,2),
  payment          TEXT,
  placed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reminders_sent   INT NOT NULL DEFAULT 0,
  last_reminded_at TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  final_status     TEXT,
  UNIQUE (property_id, pos_order_id)
);
CREATE INDEX IF NOT EXISTS idx_room_service_watch_open ON room_service_watch (property_id) WHERE closed_at IS NULL;

-- The two new free alerts for the roles they default to.
UPDATE notification_recipients SET reports = array_append(reports, 'alert_room_service')
WHERE role IN ('manager', 'kitchen') AND channel = 'telegram' AND NOT ('alert_room_service' = ANY(reports));
UPDATE notification_recipients SET reports = array_append(reports, 'alert_room_service_late')
WHERE role IN ('owner', 'front_desk') AND channel = 'telegram' AND NOT ('alert_room_service_late' = ANY(reports));
