-- ============================================================
-- Migration 024 — Fix property_settings / ai_market_summary id defaults
--
-- Both tables were originally true global singletons: `id SMALLINT`
-- with a hardcoded DEFAULT 1 (back when there was only ever one row).
-- Migration 019 added `property_id` to turn them into one-row-per-property
-- tables, but never fixed the `id` default — it still hardcodes 1.
--
-- This went unnoticed until now because Zahill (the only property) already
-- owns id=1. seedPropertyDefaults.js's `INSERT ... ON CONFLICT (property_id)
-- DO NOTHING` doesn't help: the insert fails on the id=1 PRIMARY KEY
-- collision before Postgres ever gets to check the property_id conflict
-- target, since ON CONFLICT only suppresses the constraint it names.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS property_settings_id_seq OWNED BY property_settings.id;
SELECT setval('property_settings_id_seq', GREATEST((SELECT MAX(id) FROM property_settings), 1));
ALTER TABLE property_settings ALTER COLUMN id SET DEFAULT nextval('property_settings_id_seq')::smallint;

CREATE SEQUENCE IF NOT EXISTS ai_market_summary_id_seq OWNED BY ai_market_summary.id;
SELECT setval('ai_market_summary_id_seq', GREATEST((SELECT MAX(id) FROM ai_market_summary), 1));
ALTER TABLE ai_market_summary ALTER COLUMN id SET DEFAULT nextval('ai_market_summary_id_seq')::smallint;
