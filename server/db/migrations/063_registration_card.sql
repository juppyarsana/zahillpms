-- ============================================================
-- Migration 063 — Guest Registration Card
--
-- Front desk previously had no in-system version of the paper
-- registration card guests sign at check-in — it was a hand-maintained
-- Word doc, hardcoded to Zahill's branding/rules, with every field
-- typed in manually. This adds the two guest/booking fields the card
-- needs that weren't captured anywhere, plus a per-property house-rules
-- text block (mirrors property_settings' existing branding/tax fields).
--
-- All three are nullable/defaulted — no backfill needed, no existing
-- behavior changes. address/purpose_of_stay are deliberately optional:
-- staff fill them in later, at print time, not at guest/booking
-- creation.
-- ============================================================

ALTER TABLE guests ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS purpose_of_stay VARCHAR(100);

-- Seeded with Zahill's current wording as a sensible starting default for
-- every property (including new ones onboarded later) — owners edit or
-- clear it per property in Settings → Property.
ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS registration_notice TEXT DEFAULT
'- Check-in time starts at 2pm and Check-out time is 12noon.
- A room safe is provided - the hotel will not accept any liability for valuables left in your room.
- The Villas will not be responsible for accident or injury to guests.
- Cash payments or deposits can only be accepted in Indonesian Rupiah.
- My signature is authorization for the hotel to use credit card imprinted for the payment of my account.
- The Villas will automatically charge Rp. 350.000,- if the bed mattress is moved to the floor
- Bringing pets in the room and bringing strong smelling food (like Durian, Areca nut (Pinang), Manggo, Dried Salted fish etc) is not allowed and will be charged 2 million Rupiah,-';
