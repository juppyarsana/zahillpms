-- ============================================================
-- Migration 029 — Tax & service charge config, invoice details (Phase A #3)
--
-- Per-property rates applied on folio totals and the invoice PDF.
-- NOT NULL DEFAULT backfills all existing property_settings rows
-- (including Zahill's) to tax_rate = 11 / service_charge_rate = 0,
-- so no separate seed UPDATE is needed.
-- ============================================================

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS tax_rate            NUMERIC(5,2) NOT NULL DEFAULT 11,
  ADD COLUMN IF NOT EXISTS service_charge_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS property_name       VARCHAR(200),
  ADD COLUMN IF NOT EXISTS property_address    TEXT,
  ADD COLUMN IF NOT EXISTS property_phone      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS property_email      VARCHAR(255);
