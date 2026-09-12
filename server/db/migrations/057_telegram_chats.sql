-- ============================================================
-- Migration 057 — Telegram notifications (internal staff/owner alerts)
--
-- No notification channel reaches staff outside the app — email is
-- guest-facing only, WhatsApp is an unbuilt open decision, and SSE only
-- pushes to a browser tab someone happens to have open. This adds a
-- lightweight alert channel for two events (new booking, guest requests —
-- DND/Clean Room/Call Front Desk) via a single shared platform-wide
-- Telegram bot (TELEGRAM_BOT_TOKEN env var, same philosophy as
-- PLATFORM_SMTP_* — one platform credential, not per-property bot setup).
--
-- chat_id is pasted in manually by the owner (get it from @userinfobot on
-- Telegram) rather than a bot-command self-linking flow — deliberately the
-- simpler v1; upgrading later only ever means adding a second way to
-- populate this same table, never a rewrite of the send-side logic.
-- Multiple chat IDs per property are supported from day one (e.g. the
-- owner's phone + a shared front-desk group chat all get every alert).
--
-- Hard-delete on removal is fine here (unlike expenses/folio_charges'
-- void-not-delete) — this is just a notification address, not financial
-- or audit data.
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_chats (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  chat_id     VARCHAR(50) NOT NULL,
  label       VARCHAR(100),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telegram_chats_property ON telegram_chats(property_id);
