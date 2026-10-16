-- 111: Accounting step 2, phase B — the accountant's own journal entries
-- (payroll, depreciation, rent, service charge paid out, bank fees…), the
-- opening balances brought over from the old system, and the first day of the
-- books. Unlike the rest of the journal (worked out from the PMS's records on
-- request), these are typed in, so they are stored. Never edited or deleted:
-- an entry is voided (while its day is still open) or reversed. Additive only.

-- ── 1. First day of the books ───────────────────────────────────
-- The trial balance and balance sheet add up postings from this day; the
-- opening balances are dated on it; the first close starts from it.
CREATE TABLE IF NOT EXISTS gl_settings (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  books_start DATE,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- A property that already closed days: its books start on the first one.
INSERT INTO gl_settings (property_id, books_start)
SELECT property_id, MIN(business_date) FROM gl_closed_days GROUP BY property_id
ON CONFLICT (property_id) DO NOTHING;

-- ── 2. Journal entries ──────────────────────────────────────────
-- kind: 'manual' = a journal entry; 'opening' = the opening balances (one live
-- per property, dated books_start). entry_no runs per property (JE-0001).
CREATE TABLE IF NOT EXISTS gl_entries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  entry_no    INTEGER NOT NULL,
  kind        VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'opening')),
  entry_date  DATE NOT NULL,
  memo        VARCHAR(300) NOT NULL,
  reference   VARCHAR(100),
  reverses_id UUID REFERENCES gl_entries(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_voided   BOOLEAN NOT NULL DEFAULT false,
  voided_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at   TIMESTAMPTZ,
  void_reason VARCHAR(300),
  UNIQUE (property_id, entry_no)
);
CREATE INDEX IF NOT EXISTS idx_gl_entries_date ON gl_entries (property_id, entry_date) WHERE is_voided = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_entries_opening ON gl_entries (property_id) WHERE kind = 'opening' AND is_voided = false;

CREATE TABLE IF NOT EXISTS gl_entry_lines (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id   UUID NOT NULL REFERENCES gl_entries(id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES gl_accounts(id),
  debit      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo       VARCHAR(200),
  CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_gl_entry_lines_entry ON gl_entry_lines (entry_id);

-- ── 3. Balance-sheet accounts the old system's balances need ────
INSERT INTO gl_accounts (property_id, code, name, type)
SELECT p.property_id, v.code, v.name, v.type
FROM (SELECT DISTINCT property_id FROM gl_accounts) p
CROSS JOIN (VALUES
  ('1310', 'Inventory', 'asset'),
  ('1410', 'Prepaid expenses', 'asset'),
  ('1510', 'Fixed assets — buildings & equipment', 'asset'),
  ('1590', 'Accumulated depreciation', 'asset'),
  ('2150', 'Accounts payable — suppliers', 'liability'),
  ('2160', 'Salaries & wages payable', 'liability'),
  ('2170', 'Taxes payable — PPh', 'liability'),
  ('2190', 'Other payables', 'liability'),
  ('3110', 'Owner''s capital', 'equity'),
  ('3120', 'Retained earnings', 'equity'),
  ('3190', 'Opening balance equity', 'equity')
) AS v(code, name, type)
ON CONFLICT (property_id, code) DO NOTHING;
