-- 078: tax & service per activity, and paid-directly activities on the folio.
--
-- Each activity says how service charge + tax work for it (owner's choice,
-- option C — most of Zahill's tours are vendor tours resold under the hotel's
-- name, while things the hotel runs itself are "++"):
--   added     — price is before tax, like rooms and Sales extras: service +
--               tax are added at the property's rates (default; what every
--               existing activity did when charged to the room)
--   included  — price is all-in: the guest pays the price, the service and
--               tax parts inside it are worked out for the reports
--   none      — no service charge or tax at all
-- 0% property rates = nothing added in any mode.
--
-- activity_bookings.tax_mode is the activity's setting at booking time;
-- service_charge_amount/tax_amount: 'added' + paid directly = added on top;
-- 'included' = the parts inside the price; 'none' = 0; NULL = 'added' charged
-- to the room / not paid yet (the folio adds them), or booked before this.
--
-- folio_charges.tax_mode: the folio adds service + tax only to 'added' lines
-- (every existing line, and rooms/meals/extras). An 'included'/'none'
-- activity line is charged exactly its amount.
--
-- A paid-directly activity linked to a reservation goes on the folio when
-- confirmed: its charge plus a received 'incidental' payment of what the
-- guest paid (payments.activity_booking_id), so the balance doesn't change.
-- Additive only.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(10) NOT NULL DEFAULT 'added';
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_tax_mode_check;
ALTER TABLE activities ADD CONSTRAINT activities_tax_mode_check CHECK (tax_mode IN ('added', 'included', 'none'));

ALTER TABLE activity_bookings ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(10) NOT NULL DEFAULT 'added';
ALTER TABLE activity_bookings DROP CONSTRAINT IF EXISTS activity_bookings_tax_mode_check;
ALTER TABLE activity_bookings ADD CONSTRAINT activity_bookings_tax_mode_check CHECK (tax_mode IN ('added', 'included', 'none'));
ALTER TABLE activity_bookings ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(12,2);
ALTER TABLE activity_bookings ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2);

ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(10) NOT NULL DEFAULT 'added';
ALTER TABLE folio_charges DROP CONSTRAINT IF EXISTS folio_charges_tax_mode_check;
ALTER TABLE folio_charges ADD CONSTRAINT folio_charges_tax_mode_check CHECK (tax_mode IN ('added', 'included', 'none'));

ALTER TABLE payments ADD COLUMN IF NOT EXISTS activity_booking_id UUID REFERENCES activity_bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_activity_booking ON payments(activity_booking_id) WHERE activity_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_bookings_folio_charge ON activity_bookings(folio_charge_id) WHERE folio_charge_id IS NOT NULL;
