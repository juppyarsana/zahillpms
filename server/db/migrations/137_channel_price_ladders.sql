-- ============================================================
-- Migration 137 — Channel Manager: OTA price ladders
--
-- channel_price_ladders  for one meal plan, a price per room type for each
--                        tier of rooms sold in the WHOLE hotel that night
--                        ("sold up to 16", "up to 20", …). Each night the
--                        channel manager counts the rooms sold and sends the
--                        price of the tier the NEXT room falls in (16 sold →
--                        the 17th room → the "up to 20" row). Prices are per
--                        room per night, service & tax included, sent exactly
--                        as typed. A fixed OTA price (channel_rate_prices)
--                        still wins on its nights; PMS prices don't change.
--                        Saved per meal plan as a whole (old rows replaced).
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_price_ladders (
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  rate_plan_id  UUID NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  room_type_id  UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  sold_up_to    INT  NOT NULL CHECK (sold_up_to BETWEEN 1 AND 1000),
  price         NUMERIC(14, 2) NOT NULL CHECK (price > 0),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, rate_plan_id, room_type_id, sold_up_to)
);

DROP TRIGGER IF EXISTS channel_dirty_price_ladders ON channel_price_ladders;
CREATE TRIGGER channel_dirty_price_ladders AFTER INSERT OR UPDATE OR DELETE ON channel_price_ladders
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
