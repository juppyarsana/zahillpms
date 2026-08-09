-- ============================================================
-- Migration 033 — Group Bookings (Phase D #9)
--
-- reservation_groups: parent entity for multiple room bookings under one
-- guest + shared date range (villa/event groups). bookings.reservation_group_id
-- is a nullable FK — house style for optional cross-cutting relations (same
-- pattern as sales.booking_id / tasks.booking_id). Every existing bookings
-- row is untouched; NULL means "not part of a group".
-- ============================================================

CREATE TABLE IF NOT EXISTS reservation_groups (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id           UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  primary_guest_id      UUID NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  check_in_date         DATE NOT NULL,
  check_out_date        DATE NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  group_discount_type   VARCHAR(10) CHECK (group_discount_type IN ('fixed','percentage')),
  group_discount_value  NUMERIC(12,2) DEFAULT 0,
  group_discount_amount NUMERIC(12,2) DEFAULT 0,
  group_deposit_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  special_requests      TEXT,
  internal_notes        TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reservation_groups_property ON reservation_groups(property_id);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reservation_group_id UUID REFERENCES reservation_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_reservation_group ON bookings(reservation_group_id);

-- Widen the email trigger CHECK for the new combined group-confirmation
-- email, then dynamically seed a default template for every existing
-- property (Zahill, Birdnest, any other demo property) — more robust than
-- migration 030's hardcoded single-UUID seed. seedPropertyDefaults.js
-- handles this same template for properties onboarded from now on.
ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_trigger_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_trigger_check
  CHECK (trigger IN ('booking_confirmed','pre_arrival','post_checkout','group_booking_confirmed'));

INSERT INTO email_templates (property_id, trigger, subject, body_html)
SELECT id, 'group_booking_confirmed',
       'Your group reservation at {{property_name}} is confirmed',
       '<p>Dear {{guest_name}},</p><p>Your group reservation for {{room_count}} rooms ({{room_names}}) from {{check_in_date}} to {{check_out_date}} at {{property_name}} is confirmed. Total: {{total_amount}}.</p>'
FROM properties
ON CONFLICT (property_id, trigger) DO NOTHING;
