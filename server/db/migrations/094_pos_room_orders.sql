-- 094: Room tablet orders through the POS (POS repo HOTEL_POS_PLAN.md phase 7).
-- The room tablet's Dining tab orders from the property's POS: the PMS checks
-- the room has a checked-in guest and passes the order on to the POS with the
-- key the POS made for the hotel (POS Setup → Room service → Key for the
-- hotel). Both NULL = the tablet keeps the PMS's own food menu, as before.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pos_url TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pos_hotel_key TEXT;
