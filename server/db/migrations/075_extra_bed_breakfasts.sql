-- 075: breakfasts per extra bed (follows 074).
-- An extra bed single includes 1 breakfast, a double 2 — and front desk can
-- change it per sale (e.g. a double bed for one person), plus the price per
-- night (a bargain), both logged on the booking.
--
-- products.meal_price now means the price of ONE breakfast (net) and
-- products.meal_pax how many breakfasts one unit includes (default 1, so
-- every existing item keeps exactly the same breakfast part: price × 1).
-- booking_addons.breakfasts = breakfasts per night on that add-on night (what
-- the kitchen counts); booking_addons.meal_price = one breakfast's price, so
-- the night's breakfast part = breakfasts × meal_price. Existing add-on rows
-- stored the part per unit, so breakfasts = quantity keeps them the same.
-- Additive only.

ALTER TABLE products ADD COLUMN IF NOT EXISTS meal_pax INT NOT NULL DEFAULT 1;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_meal_pax_check;
ALTER TABLE products ADD CONSTRAINT products_meal_pax_check CHECK (meal_pax >= 0 AND meal_pax <= 20);

ALTER TABLE booking_addons ADD COLUMN IF NOT EXISTS breakfasts INT;
UPDATE booking_addons SET breakfasts = CASE WHEN meal_price > 0 THEN quantity ELSE 0 END WHERE breakfasts IS NULL;
ALTER TABLE booking_addons ALTER COLUMN breakfasts SET NOT NULL;
ALTER TABLE booking_addons ALTER COLUMN breakfasts SET DEFAULT 0;
ALTER TABLE booking_addons DROP CONSTRAINT IF EXISTS booking_addons_breakfasts_check;
ALTER TABLE booking_addons ADD CONSTRAINT booking_addons_breakfasts_check CHECK (breakfasts >= 0 AND breakfasts <= 50);
