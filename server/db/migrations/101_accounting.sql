-- 101: Accounting, step 1 — chart of accounts + account mapping.
-- The daily journal itself is not stored: services/journalService.js builds it
-- from what the PMS already records (folio charges, payments, group / agent
-- payments, POS sessions, expenses). These two tables say which account each
-- kind of amount goes to. Additive only.

-- ── 1. Module (default off, backfilled) ─────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'accounting', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Chart of accounts, per property ──────────────────────────
-- Filled with a standard hotel chart the first time the Accounting page is
-- opened (accountingService.ensureChart) — the owner / accountant renames,
-- renumbers and adds accounts from there.
CREATE TABLE IF NOT EXISTS gl_accounts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(120) NOT NULL,
  type        VARCHAR(12) NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, code)
);

-- ── 3. Which account each kind of amount goes to ────────────────
-- map_key: 'revenue.room', 'tax.pb1', 'ledger.guest', 'pay.<payment method id>',
-- 'expense.<category>' … (accountingService.MAP_KEYS). A key with no row here
-- uses the standard chart's account for it.
CREATE TABLE IF NOT EXISTS gl_account_map (
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  map_key     VARCHAR(80) NOT NULL,
  account_id  UUID NOT NULL REFERENCES gl_accounts(id) ON DELETE CASCADE,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, map_key)
);
