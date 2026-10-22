-- 129: Payables — supplier bills and what the hotel owes (accounting step C).
--
-- A supplier's bill is recorded when it ARRIVES (bill date): each line goes to
-- an account of the chart (cost of food, laundry, electricity…) and the total
-- is owed to the supplier (Accounts payable — suppliers, 2150). Paying it
-- later (in one go or in parts, one payment may cover several bills of the
-- same supplier) takes the money out of cash / bank and clears the debt.
-- Food and drinks bought for stock go straight to cost (owner's choice
-- 2026-10-23); the accountant adjusts for the stock left at month end with a
-- journal entry.
--
--   supplier_bills            one bill (running bill_no per property, shown BILL-0001),
--                             void-not-delete, optional link to a purchase order
--   supplier_bill_lines       account + description + amount (po_item_id when made from a PO)
--   supplier_payments         money paid to a supplier, void-not-delete
--   supplier_payment_allocations  which bills a payment paid (sum = the payment)
--   suppliers.default_account_id  the account a new bill line of this supplier starts on
--
-- New permission "payables" (Roles & Permissions → Finance): given to every
-- role that has "accounting" (the accountant). Additive only.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_account_id UUID REFERENCES gl_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS supplier_bills (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bill_no           INT NOT NULL,
  supplier_id       UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_ref      VARCHAR(100),            -- the supplier's own invoice number
  bill_date         DATE NOT NULL,
  due_date          DATE NOT NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  notes             TEXT,
  total             NUMERIC(14,2) NOT NULL CHECK (total > 0),
  is_voided         BOOLEAN NOT NULL DEFAULT false,
  voided_at         TIMESTAMPTZ,
  voided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason       TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, bill_no)
);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills (property_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_date ON supplier_bills (property_id, bill_date);

CREATE TABLE IF NOT EXISTS supplier_bill_lines (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id     UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  line_no     INT NOT NULL,
  account_id  UUID NOT NULL REFERENCES gl_accounts(id) ON DELETE RESTRICT,
  description VARCHAR(255),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  po_item_id  UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_bill ON supplier_bill_lines (bill_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_po_item ON supplier_bill_lines (po_item_id) WHERE po_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  paid_on     DATE NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method      VARCHAR(50) NOT NULL,
  reference   VARCHAR(120),
  notes       TEXT,
  is_voided   BOOLEAN NOT NULL DEFAULT false,
  voided_at   TIMESTAMPTZ,
  voided_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments (property_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments (property_id, paid_on);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  bill_id    UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE RESTRICT,
  amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, bill_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_alloc_bill ON supplier_payment_allocations (bill_id);

UPDATE roles
SET allowed_menus = array_append(allowed_menus, 'payables')
WHERE 'accounting' = ANY(allowed_menus) AND NOT ('payables' = ANY(allowed_menus));
