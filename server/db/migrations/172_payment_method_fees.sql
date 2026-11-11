-- Bank check: what a payment method costs and when the bank pays it out.
-- fee_percent: the bank's fee on this method (QRIS / card), % of the amount.
-- settle_days: days until the money reaches the bank (0 = same day, 1 = H+1).
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS settle_days INT NOT NULL DEFAULT 0;
