-- 093: Cashier closing — the list of payments each front desk user took in a
-- day, to check against the EDC slips, the transfers and the cash drawer.
--
-- payments.reference   — card trace / transfer reference, typed when the
--                        payment is recorded (was squeezed into notes).
-- payments.recorded_at — the moment the payment was marked received. The
--                        received_at column is the date FO chose (often a
--                        plain date, so no time of day); this one is set by
--                        a trigger at every place that records a payment.
-- checkin_records.checkout_by — who did the check-out.
-- New "cashier_closing" permission (Roles & Permissions → Front Desk), given
-- to every role that already has the full Check-in / out page.
-- Additive only.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference VARCHAR(120);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;

-- Older payments: keep the time only where received_at really carries one
-- (not midnight in property time or UTC).
UPDATE payments SET recorded_at = received_at
WHERE status = 'received' AND recorded_at IS NULL AND received_at IS NOT NULL
  AND (received_at AT TIME ZONE 'Asia/Makassar')::time <> '00:00:00'
  AND (received_at AT TIME ZONE 'UTC')::time <> '00:00:00';

CREATE OR REPLACE FUNCTION payments_stamp_recorded() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'received' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'received') THEN
    NEW.recorded_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_stamp_recorded ON payments;
CREATE TRIGGER payments_stamp_recorded BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_stamp_recorded();

-- Who checked the guest out — a stay billed to its agent at check-out is a
-- line of that user's closing ("Agent ledger").
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS checkout_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_received_at ON payments (received_at) WHERE status = 'received';

UPDATE roles
SET allowed_menus = array_append(allowed_menus, 'cashier_closing')
WHERE 'checkin_full' = ANY(allowed_menus) AND NOT ('cashier_closing' = ANY(allowed_menus));
