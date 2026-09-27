-- 074: Per-night stay extras (extra bed) + breakfast part on sales items.
--
-- An item (products) can now be sold PER NIGHT as part of a stay (extra bed,
-- baby cot…) and can carry a breakfast part (net, per unit — per night for a
-- per-night item). Whether it's sold from the Sales till or from the
-- reservation, it goes through salesService.createSale: the sale / sale_items
-- rows stay the order record (Sales History, receipt, payment), and each
-- night lands in booking_addons, posted to the folio night by night with the
-- room (roomChargeService.postAddons) and counted in the reports / kitchen by
-- its night. Additive only.

ALTER TABLE products ADD COLUMN IF NOT EXISTS per_night BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meal_price NUMERIC(12,2) NOT NULL DEFAULT 0;

-- The breakfast part of a sold line (net), and whether the line was sold per
-- night (its revenue is then counted per night from booking_addons, not on
-- the sale's day). Old sales: meal_amount 0, per_night false.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS meal_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS per_night BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS booking_addons (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sale_id       UUID REFERENCES sales(id) ON DELETE SET NULL,
  sale_item_id  UUID REFERENCES sale_items(id) ON DELETE SET NULL,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  description   VARCHAR(200) NOT NULL,           -- the item's name when sold
  service_date  DATE NOT NULL,                   -- the night
  quantity      INT NOT NULL CHECK (quantity >= 1),
  unit_price    NUMERIC(12,2) NOT NULL,          -- net per unit per night, breakfast included
  meal_price    NUMERIC(12,2) NOT NULL DEFAULT 0, -- of which breakfast (net per unit)
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_at    TIMESTAMPTZ,
  removed_reason VARCHAR(250)
);
CREATE INDEX IF NOT EXISTS idx_booking_addons_booking ON booking_addons (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_addons_night ON booking_addons (property_id, service_date) WHERE status = 'active';

-- Folio: one 'addon' line per add-on night.
ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS addon_id UUID REFERENCES booking_addons(id) ON DELETE SET NULL;

DO $$
DECLARE con_name TEXT;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
   WHERE conrelid = 'folio_charges'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%service_charge%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE folio_charges DROP CONSTRAINT %I', con_name);
  END IF;
END $$;
ALTER TABLE folio_charges ADD CONSTRAINT folio_charges_type_check
  CHECK (type IN ('room', 'fnb', 'sale', 'activity', 'misc', 'discount', 'tax', 'service_charge', 'addon'));

-- One room / meal line per booking per night stays unique; add-on lines (which
-- also carry their night in service_date) are unique per add-on night instead,
-- so two different extras on the same night don't collide.
DROP INDEX IF EXISTS uq_folio_charges_night;
CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_charges_night ON folio_charges (booking_id, type, service_date)
  WHERE service_date IS NOT NULL AND is_voided = false AND type IN ('room', 'fnb');
CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_charges_addon ON folio_charges (addon_id)
  WHERE addon_id IS NOT NULL AND is_voided = false;
