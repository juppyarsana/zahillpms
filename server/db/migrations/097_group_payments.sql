-- 097: Group billing — a group booking has ONE bill and ONE payment record
-- (the accountant's request): payments are recorded on the group, never
-- spread over its rooms.
--
-- reservation_groups.group_billing — true: the group is billed as a whole
--   (group payments, no deposit / balance lines on its rooms). false: the old
--   per-room way (every group created before 097 until it is moved over with
--   maintenance/moveGroupPayments.js, and groups billed to a city-ledger
--   agent, which keep per-room agent billing).
-- reservation_groups.billing_mode — what the group pays:
--   'room_meals' — room nights + meal plan; extras charged to a room stay on
--                  that room's own bill (its guest pays them at check-out).
--   'everything' — extras too (still listed under their room).
-- group_payments — money received from the group (one row per transaction).
--   Void, never delete (void_reason, voided_by / at). legacy_payment_id = the
--   room payment a row was moved from (moveGroupPayments.js).
-- Additive only.

ALTER TABLE reservation_groups ADD COLUMN IF NOT EXISTS group_billing BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reservation_groups ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) NOT NULL DEFAULT 'room_meals';
DO $$ BEGIN
  ALTER TABLE reservation_groups ADD CONSTRAINT reservation_groups_billing_mode_check
    CHECK (billing_mode IN ('room_meals', 'everything'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS group_payments (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  group_id           UUID NOT NULL REFERENCES reservation_groups(id) ON DELETE CASCADE,
  amount             NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method             VARCHAR(50) NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at        TIMESTAMPTZ DEFAULT NOW(),
  reference          VARCHAR(120),
  notes              TEXT,
  is_voided          BOOLEAN NOT NULL DEFAULT false,
  void_reason        TEXT,
  voided_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at          TIMESTAMPTZ,
  legacy_payment_id  UUID,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_payments_group ON group_payments (group_id);
CREATE INDEX IF NOT EXISTS idx_group_payments_received ON group_payments (property_id, received_at) WHERE is_voided = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_payments_legacy ON group_payments (legacy_payment_id) WHERE legacy_payment_id IS NOT NULL;
