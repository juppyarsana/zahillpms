-- ============================================================
-- Migration 032 — Per-property branding (logo, brand color)
--
-- Lives on property_settings (not properties) since that's already
-- the 1:1-per-property table joined for property_name/address/phone/email.
-- brand_color defaults to the platform's existing hardcoded color so
-- unbranded properties keep today's look.
-- ============================================================

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS logo_url    TEXT,
  ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) NOT NULL DEFAULT '#5C1A2E';
