-- ============================================================
-- Migration 069 — Market Insights settings per property
--
-- The Dashboard's Market Insights cards were set up for Zahill only:
-- hardcoded search terms ('kintamani glamping', 'bali glamping'), competitor
-- searches always suffixed "Kintamani Bali", and an AI briefing that described
-- every property as "Zahill Glamping Kintamani, a 5-unit glamping property".
-- These become per-property settings (Settings → Property Details → Market
-- Insights):
--   market_area         where the property is, e.g. "Kintamani, Bali" — used to
--                       find competitors (and the property's own listing) on
--                       Google, and in the AI briefing
--   market_keywords     Google Trends search terms to follow (max 5)
--   market_description  a short description for the AI briefing, e.g.
--                       "glamping resort with volcano and lake views"
-- The property's own Google listing stays the competitors row with
-- is_self = true (set from the same settings card from now on).
--
-- Zahill keeps exactly what it had. Other properties start empty: no search
-- terms are followed until the owner adds some.
-- ============================================================

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS market_area        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS market_keywords    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS market_description VARCHAR(300);

UPDATE property_settings
SET market_area = 'Kintamani, Bali',
    market_keywords = ARRAY['kintamani glamping', 'bali glamping'],
    market_description = 'glamping resort'
WHERE property_id = '00000000-0000-0000-0000-000000000001'
  AND market_area IS NULL;
