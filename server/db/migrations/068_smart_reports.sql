-- ============================================================
-- Migration 068 — Smart Reports (routine reports to owner / manager)
--
-- One recipient list per property for everything sent to staff by Telegram
-- or email (Settings → Reports & Alerts):
--   * instant Telegram alerts (new booking; guest requests & calls) — FREE,
--     every property. These used to go to every `telegram_chats` row; those
--     chats are copied onto this list below (same alerts ticked), and
--     telegram_chats is no longer read (kept, not dropped).
--   * scheduled reports (Morning Brief, …) — new `smart_reports` module,
--     default OFF (paid add-on tier, same as back_office / yield_management).
-- The night-audit owner email is unchanged.
--
-- property_settings.telegram_bot_token — the property's OWN Telegram bot (so
-- messages come from e.g. @ZahillResortBot). NULL = use the platform bot
-- (TELEGRAM_BOT_TOKEN env). A bot can belong to one property only.
--
-- notification_recipients — a property's report recipients. A separate list
-- (not users): a recipient can be anyone — owner, manager, accountant, a
-- front desk or kitchen Telegram group — with or without a PMS login.
--   channel  'email' | 'telegram'
--   address  the email address, or the Telegram chat ID. NULL for a
--            Telegram recipient until they press Start on their Connect link.
--   link_token / link_expires_at  the pending Connect link
--            (t.me/<bot>?start=<token>); cleared once connected.
--   telegram_name  who/which group connected (shown on the settings page)
--   role     who they are (owner / manager / front_desk / kitchen / other) —
--            decides which reports are ticked by default
--   reports  report keys this recipient gets (e.g. 'morning_brief')
-- ============================================================

INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'smart_reports', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_settings_telegram_bot
  ON property_settings (telegram_bot_token) WHERE telegram_bot_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_recipients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  channel     VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'telegram')),
  address     VARCHAR(255),
  link_token  VARCHAR(64) UNIQUE,
  link_expires_at TIMESTAMPTZ,
  telegram_name VARCHAR(255),
  role        VARCHAR(20) NOT NULL DEFAULT 'other'
                CHECK (role IN ('owner', 'manager', 'front_desk', 'kitchen', 'other')),
  reports     TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,          -- last successful delivery
  last_error  TEXT,                  -- last failure (cleared on success)
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, channel, address),
  CHECK (address IS NOT NULL OR (channel = 'telegram' AND link_token IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_notification_recipients_property
  ON notification_recipients (property_id) WHERE is_active;

-- Existing Telegram alert chats keep receiving exactly what they got before.
INSERT INTO notification_recipients
  (property_id, name, channel, address, role, reports, is_active, created_by, created_at)
SELECT property_id,
       COALESCE(NULLIF(TRIM(label), ''), 'Telegram chat ' || chat_id),
       'telegram', chat_id, 'other',
       ARRAY['alert_new_booking', 'alert_guest_requests'],
       is_active, created_by, created_at
FROM telegram_chats
ON CONFLICT (property_id, channel, address) DO NOTHING;
