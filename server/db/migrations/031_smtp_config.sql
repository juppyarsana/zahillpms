-- ============================================================
-- Migration 031 — Per-property SMTP config (Phase B #4)
--
-- Optional — mailer.js falls back to PLATFORM_SMTP_* env vars when
-- a property hasn't configured its own SMTP.
-- ============================================================

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS smtp_host     VARCHAR(200),
  ADD COLUMN IF NOT EXISTS smtp_port     INTEGER DEFAULT 587,
  ADD COLUMN IF NOT EXISTS smtp_user     VARCHAR(200),
  ADD COLUMN IF NOT EXISTS smtp_password VARCHAR(200),
  ADD COLUMN IF NOT EXISTS smtp_from     VARCHAR(200);
  -- smtp_from e.g. "Zahill <hello@zahill.com>"
