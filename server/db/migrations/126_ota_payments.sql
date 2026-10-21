-- OTA payments: virtual cards and weekly payouts net of commission.
--
-- bookings.payment_collect gains 'vcc': the OTA pays the room with a virtual
-- card that the hotel charges itself (on its card machine) — like 'ota' the
-- guest owes nothing for the room, but the money comes from charging the card,
-- not from a bank payout. vcc_charge_from = the day the card can be charged
-- (typed by front desk from the OTA's extranet; NULL = not known).
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_collect_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_collect_check
  CHECK (payment_collect IN ('ota', 'property', 'vcc'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS vcc_charge_from DATE;

-- An agent / OTA payout can keep its commission back: `amount` stays the
-- money actually received (what every cash total reads), `commission_amount`
-- the commission it held back. Together they pay the stays it is allocated to.
ALTER TABLE agent_payments ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- "OTA virtual card" payment method — the template row and every property.
INSERT INTO payment_methods (id, label, is_active, sort_order, property_id)
SELECT 'ota_vcc', 'OTA virtual card', true, 90, NULL
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = 'ota_vcc' AND property_id IS NULL);

INSERT INTO payment_methods (id, label, is_active, sort_order, property_id)
SELECT 'ota_vcc', 'OTA virtual card', true,
       COALESCE((SELECT MAX(sort_order) + 1 FROM payment_methods pm WHERE pm.property_id = p.id), 90), p.id
FROM properties p
WHERE NOT EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.id = 'ota_vcc' AND pm.property_id = p.id);
