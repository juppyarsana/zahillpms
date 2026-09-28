-- 081: a booking's bill keeps the service charge / tax rates it was billed at.
--
-- The folio adds service + tax to its NET lines at the rates it's read with.
-- Until now that was always the property's CURRENT rates, so changing them
-- (e.g. Zahill 0% → 10% + 11%, migration 079) re-priced every old bill: a
-- checked-out stay reprinted with a balance the guest never owed, an agent
-- statement's totals moved. Now:
--   - checkout stamps the rates in force on the booking;
--   - changing the rates (PUT /api/settings/tax) first stamps the old rates on
--     every booking it doesn't re-split (checked out, cancelled / no-show, on
--     an agent invoice) that has none yet;
--   - the folio, invoice / pro forma, Balance Due and agent statements use the
--     booking's rates when set, else the property's.
-- NULL = not billed yet (open bookings): the property's current rates.
-- Additive only — existing bookings stay NULL (= current rates, as before).

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bill_tax_rate NUMERIC(5,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bill_service_charge_rate NUMERIC(5,2);
