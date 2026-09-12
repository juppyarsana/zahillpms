-- ============================================================
-- Migration 055 — Expenses (Back Office Slice B)
--
-- General operating costs (laundry, electricity, maintenance, staff, etc.)
-- that don't fit Suppliers/Raw Materials/Purchase Orders (Slice A) — those
-- are specifically about buying/stocking inventory, not paying for
-- services or utilities. Explicitly NOT a step toward a full accounting
-- system (GL/chart-of-accounts/journal entries) — that stays out of scope,
-- per the decision already on record for Back Office. This is a clean,
-- categorized log whose real job is to (a) feed a lightweight Net Income
-- view on the existing Reports page, and (b) export cleanly (see
-- routes/expenses.js's CSV endpoint) so an outside accountant/bookkeeper
-- can pull it into their own tool without retyping every transaction.
--
--   - category is a fixed CHECK list, not free text — required for the
--     Net Income rollup and for an accountant to map it to their own
--     chart of accounts; free-text categories can't be reliably summed.
--   - Void, not delete (is_voided/voided_by/voided_at) — same pattern as
--     folio_charges (migration 028), not agent_payments' hard-delete —
--     an accountant needs an unbroken audit trail.
--   - payment_method is plain VARCHAR, validated in the route against the
--     property's real payment_methods table — same convention
--     salesService.createSale already uses for sales.payment_method
--     (migration 048), not a DB-level FK (payment_methods' PK is a
--     composite unique index, not a plain PK).
--   - supplier_id is optional — a recurring vendor (an outside laundry
--     service) can be tied to an existing suppliers row; a one-off cost
--     (an electricity bill) just leaves it null.
-- ============================================================

CREATE TABLE IF NOT EXISTS expenses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  category       VARCHAR(30) NOT NULL CHECK (category IN
                   ('utilities', 'laundry', 'maintenance', 'staff', 'supplies', 'marketing', 'admin_fees', 'other')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  incurred_on    DATE NOT NULL DEFAULT CURRENT_DATE, -- buckets by month the same way reports.js already does
  payment_method VARCHAR(50),
  supplier_id    UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  description    TEXT,
  reference      VARCHAR(100), -- invoice/receipt number, for accountant traceability
  is_voided      BOOLEAN NOT NULL DEFAULT false,
  voided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at      TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_property ON expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_incurred_on ON expenses(property_id, incurred_on);
