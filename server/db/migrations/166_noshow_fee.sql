-- 166: No-show / late-cancellation fee. A folio line of its own type on a
-- booking that is marked no-show or cancelled: what the hotel charges (or the
-- OTA pays) for a room it held and could not resell. It is revenue on its own
-- line (account 400-11-002, journal key revenue.noshow), not a room night, so
-- occupancy and ADR do not move. Voided with a reason like any folio line.
-- Additive only.
ALTER TABLE folio_charges DROP CONSTRAINT IF EXISTS folio_charges_type_check;
ALTER TABLE folio_charges ADD CONSTRAINT folio_charges_type_check
  CHECK (type IN ('room', 'fnb', 'sale', 'activity', 'misc', 'discount', 'tax', 'service_charge', 'addon', 'noshow_fee'));
