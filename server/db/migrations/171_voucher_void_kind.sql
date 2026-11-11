-- 171: A voucher cancelled because the sale was entered by mistake (no money was ever
-- received): void_kind = 'mistake'. Such a sale is left out of the books altogether
-- (journal, Daily Close, Cashier Closing, voucher report), as if it never happened; the
-- voucher stays listed as cancelled with its reason. NULL = an ordinary cancellation
-- (refunded, or kept as income). Additive only.
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS void_kind VARCHAR(12);
