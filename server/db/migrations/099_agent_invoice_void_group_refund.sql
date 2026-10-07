-- Corrections pack, session 3.
--
-- agent_invoices.voided_*: an agent invoice issued by mistake (wrong stays,
--   wrong agent, a stay that had to be corrected). The invoice is kept with
--   its number (numbers are never reused); its stays go back to "not invoiced
--   yet" and can be invoiced again.
-- group_payments.is_refund: money given back to a group billed as a whole —
--   a row with a NEGATIVE amount on the day it was refunded (same idea as
--   payments.type = 'refund', migration 098), so the group's "received" and
--   every money report net it out by themselves. The amount check becomes
--   "not zero".
-- Additive only.

ALTER TABLE agent_invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE agent_invoices ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE agent_invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE group_payments ADD COLUMN IF NOT EXISTS is_refund BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE group_payments DROP CONSTRAINT IF EXISTS group_payments_amount_check;
ALTER TABLE group_payments ADD CONSTRAINT group_payments_amount_check CHECK (amount <> 0);
