-- ============================================================
-- Migration 025 — Drop the last leftover singleton constraint
-- property_settings.id and ai_market_summary.id both still carry
-- CHECK (id = 1) from when these were true global singletons.
-- Combined with the fixed id defaults (migration 024), this was
-- the second and final blocker preventing a second property's
-- row from being inserted.
-- ============================================================

ALTER TABLE property_settings DROP CONSTRAINT IF EXISTS property_settings_id_check;
ALTER TABLE ai_market_summary DROP CONSTRAINT IF EXISTS ai_market_summary_id_check;
