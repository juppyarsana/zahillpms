-- 169: A voucher sold to a guest and charged to their room reservation (like an
-- extra billed to the folio) instead of paid at once. The folio line has its own
-- type 'voucher' (no service charge, no tax); in the books it is a liability
-- (Dr Guest ledger · Cr voucher liability), never revenue, and the money comes in
-- when the guest pays the bill. The voucher keeps no payment method.
-- Additive only.
ALTER TABLE folio_charges DROP CONSTRAINT IF EXISTS folio_charges_type_check;
ALTER TABLE folio_charges ADD CONSTRAINT folio_charges_type_check
  CHECK (type IN ('room', 'fnb', 'sale', 'activity', 'misc', 'discount', 'tax', 'service_charge', 'addon', 'noshow_fee', 'voucher'));
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS charged_booking_id UUID REFERENCES bookings(id);
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS charge_id UUID REFERENCES folio_charges(id);
CREATE INDEX IF NOT EXISTS idx_vouchers_charged_booking ON vouchers(charged_booking_id) WHERE charged_booking_id IS NOT NULL;
