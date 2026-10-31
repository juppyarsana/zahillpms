-- 147: The standard chart of accounts (GGG-DD-NNN, agreed with the accountant
-- 2026-10-30). accountingService.ensureChart converts a property's chart the
-- next time it is read: same rows, new codes (standardChart.js OLD_CHART), so
-- journal entries and saved mappings stay on the right account. This column
-- says which version a property's chart is on. Additive only.
ALTER TABLE gl_settings ADD COLUMN IF NOT EXISTS chart_version INT NOT NULL DEFAULT 0;

-- The part of the service charge that doesn't go to staff, as a % of the
-- service charge: Loss & Breakage and HR Development (3 + 2 points of a 10%
-- charge = 30 + 20). 0 = all of it stays on Service Charge Payable.
ALTER TABLE gl_settings ADD COLUMN IF NOT EXISTS service_lb_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE gl_settings ADD COLUMN IF NOT EXISTS service_hrd_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
