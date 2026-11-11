-- 170: Vouchers sold together (the Sell window's "How many") share a purchase id, so
-- one receipt can cover the whole purchase. Older vouchers have none and get a
-- receipt of their own. Additive only.
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS purchase_id UUID;
CREATE INDEX IF NOT EXISTS idx_vouchers_purchase ON vouchers(purchase_id) WHERE purchase_id IS NOT NULL;
