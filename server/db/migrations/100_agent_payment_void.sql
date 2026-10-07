-- An agent payment recorded by mistake is voided, not deleted (it used to be
-- removed outright): the row stays with who / when / why, and is left out of
-- everything that counts money. Its allocations to stays are taken off (the
-- stays are unpaid again) and kept on the row as they were, for the record.
-- Additive only.

ALTER TABLE agent_payments ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agent_payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE agent_payments ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE agent_payments ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE agent_payments ADD COLUMN IF NOT EXISTS voided_allocations JSONB;
