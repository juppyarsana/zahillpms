-- Corrections pack, session 2 — payments and Sales till sales put right
-- without deleting anything.
--
-- payments.type 'refund': money given back to the guest — a received row with
--   a NEGATIVE amount on the day it was refunded, so everything that sums
--   received payments (folio balance, Daily Close, Cashier Closing, Reports →
--   Money) nets it out by itself. refund_of = the payment it gives back, when
--   front desk picked one.
-- payments.status 'voided': a payment recorded by mistake (an extras payment
--   whose lines are unpaid again, a voided sale's payment, a refund entered
--   wrongly). Kept, never counted. A room deposit / balance line taken back
--   goes to 'pending' instead (it is still owed).
-- sales.voided_*: a sale rung up by mistake. It is also marked
--   confirmation_status = 'rejected' — every revenue / money query already
--   leaves those out — and voided_at tells a void from a declined order.
-- Additive only.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check CHECK (type IN ('deposit', 'balance', 'incidental', 'refund'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'received', 'voided'));

ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_of UUID REFERENCES payments(id) ON DELETE SET NULL;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason TEXT;
