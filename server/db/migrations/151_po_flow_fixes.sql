-- Purchase order flow fixes (PO_FLOW_FIXES_PLAN.md). Additive.
--
-- closed: an approved PO where part came in and the rest never will. short_qty
-- on each line = what will never come, so its purchase request shows that part
-- as not ordered again.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'received', 'closed', 'cancelled'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS close_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS short_qty NUMERIC(10,3) NOT NULL DEFAULT 0;

-- Each delivery: the date it came (a record only — stock moves when it is
-- entered) and the supplier's delivery note (surat jalan).
CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  received_on        DATE NOT NULL,
  delivery_note      VARCHAR(100),
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_receipts_po ON purchase_order_receipts(purchase_order_id);
CREATE TABLE IF NOT EXISTS purchase_order_receipt_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id  UUID NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
  po_item_id  UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  quantity    NUMERIC(10,3) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_po_receipt_lines_receipt ON purchase_order_receipt_lines(receipt_id);

-- Exact line totals: a price per kg / L is kept per g / ml, so unit costs and
-- average costs need more than 2 decimals. line_total (migration 135) is what
-- the line costs, as typed.
ALTER TABLE purchase_order_items ALTER COLUMN unit_cost TYPE NUMERIC(14,4);
UPDATE purchase_order_items SET line_total = ROUND(quantity * unit_cost, 2) WHERE line_total IS NULL;
ALTER TABLE raw_materials ALTER COLUMN cost_per_unit TYPE NUMERIC(14,4);
ALTER TABLE products ALTER COLUMN cost_per_unit TYPE NUMERIC(14,4);
ALTER TABLE stock_opname_lines ALTER COLUMN unit_cost TYPE NUMERIC(14,4);

-- A bill below the PO's value (a discount, say): someone can say the billing is
-- finished, so the Part billed badge doesn't stay for ever.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS billing_done_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS billing_done_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS billing_done_reason TEXT;

-- The PO for the supplier: a link that opens its PDF without logging in, and
-- when it first went out.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS share_token VARCHAR(64);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_to_supplier_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_share_token ON purchase_orders(share_token) WHERE share_token IS NOT NULL;
