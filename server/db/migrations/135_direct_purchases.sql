-- 135: Buy without a PO (accounting's request, 2026-10-23).
--
-- Stock bought at the market or a shop with no purchase order: one window in
-- Purchasing & Stock adds the stock (average cost updated, as receiving a PO
-- does) and records the money in the same step —
--   paid already → an expense row (Finance → Expenses), tied to the purchase
--   pay later    → a supplier bill (Finance → Payables)
-- It is kept as a purchase order that is already received, marked direct, so
-- it shows in the PO list and the stock history. Voiding takes the stock back
-- out and voids its expense / bill.
--
-- Telegram (free alert alert_direct_purchase, owner by default) only for the
-- exceptions: a big purchase, a price well above the item's average cost, a
-- purchase dated well in the past or on a closed accounting day, a void.
-- The amounts are per property (property_settings.direct_purchase_alerts,
-- NULL = the defaults in services/directPurchaseService.js).

ALTER TABLE purchase_orders ALTER COLUMN supplier_id DROP NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS bought_from VARCHAR(200);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchased_on DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reference VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS category VARCHAR(30);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS void_reason TEXT;
-- A normal PO still needs its supplier; only a direct purchase may go without.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_supplier_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_check
  CHECK (supplier_id IS NOT NULL OR is_direct);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_direct ON purchase_orders(property_id, purchased_on) WHERE is_direct;

-- The exact amount typed per line (unit_cost is rounded to 2 decimals).
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2);

-- The expense a paid-already direct purchase made.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS direct_purchase_alerts JSONB;

-- Owners on Telegram get the new alert ticked.
UPDATE notification_recipients
SET reports = array_append(reports, 'alert_direct_purchase')
WHERE channel = 'telegram' AND role = 'owner' AND NOT ('alert_direct_purchase' = ANY(reports));
