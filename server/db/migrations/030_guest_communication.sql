-- ============================================================
-- Migration 030 — Guest Communication: email templates & log (Phase B #4)
--
-- email_templates: one row per property per trigger point, editable
-- from Settings. communication_log: audit trail + dedup guard so the
-- pre_arrival/post_checkout cron jobs never send the same email twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  trigger      VARCHAR(30) NOT NULL CHECK (trigger IN (
                 'booking_confirmed',
                 'pre_arrival',
                 'post_checkout'
               )),
  subject      VARCHAR(200) NOT NULL,
  body_html    TEXT         NOT NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, trigger)
);

CREATE TABLE IF NOT EXISTS communication_log (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  booking_id   UUID        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  trigger      VARCHAR(30) NOT NULL,
  channel      VARCHAR(10) NOT NULL DEFAULT 'email',
  recipient    VARCHAR(255) NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'sent'
                 CHECK (status IN ('sent','failed')),
  error        TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_log_booking ON communication_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_comm_log_property ON communication_log(property_id);

-- Seed default templates for Zahill (see utils/seedPropertyDefaults.js for
-- the same three templates seeded on every future property onboarded).
-- Placeholders: {{guest_name}}, {{check_in_date}}, {{check_out_date}},
-- {{unit_name}}, {{nights}}, {{property_name}}

INSERT INTO email_templates (property_id, trigger, subject, body_html)
VALUES
(
  '00000000-0000-0000-0000-000000000001',
  'booking_confirmed',
  'Booking Confirmed — {{property_name}}',
  '<h2>Hi {{guest_name}},</h2>
   <p>Your booking is confirmed!</p>
   <p><strong>Unit:</strong> {{unit_name}}<br>
   <strong>Check-in:</strong> {{check_in_date}}<br>
   <strong>Check-out:</strong> {{check_out_date}}<br>
   <strong>Nights:</strong> {{nights}}</p>
   <p>We look forward to welcoming you.<br>{{property_name}}</p>'
),
(
  '00000000-0000-0000-0000-000000000001',
  'pre_arrival',
  'See You Tomorrow — {{property_name}}',
  '<h2>Hi {{guest_name}},</h2>
   <p>Your stay at {{property_name}} is tomorrow!</p>
   <p><strong>Check-in:</strong> {{check_in_date}}<br>
   <strong>Unit:</strong> {{unit_name}}</p>
   <p>If you have any questions before arrival, just reply to this email.</p>
   <p>See you soon,<br>{{property_name}}</p>'
),
(
  '00000000-0000-0000-0000-000000000001',
  'post_checkout',
  'Thank You for Staying — {{property_name}}',
  '<h2>Hi {{guest_name}},</h2>
   <p>Thank you for staying with us at {{property_name}}!</p>
   <p>We hope you had a wonderful time and we would love to welcome you back.</p>
   <p>If you have a moment, we would greatly appreciate a review of your stay.</p>
   <p>Warm regards,<br>{{property_name}}</p>'
)
ON CONFLICT (property_id, trigger) DO NOTHING;
