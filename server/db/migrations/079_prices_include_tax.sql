-- 079: "Prices include service & tax" — one switch per property.
--
-- off (default, every existing property): prices are entered BEFORE tax
--   ("++") — room type rates, pricing periods, rate-plan meal prices and
--   Sales item prices; service charge + tax are added on top.
-- on ("nett"): those prices are what the guest pays. The system takes the
--   service charge + tax out of them (price ÷ (1 + service) ÷ (1 + tax)) and
--   keeps working in NET amounts internally, exactly as before; invoices, the
--   till and receipts show all-in amounts with "includes service … and tax …".
-- Activities keep their own per-activity setting (migration 078).
--
-- Changing the service charge / tax rates (PUT /api/settings/tax) re-splits
-- open bookings so the price each guest agreed doesn't change.
-- Additive only.

ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS prices_include_tax BOOLEAN NOT NULL DEFAULT false;
