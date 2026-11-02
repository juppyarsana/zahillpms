-- ============================================================
-- Migration 150 — Channel Manager: OTA price ladders with dates
--
-- channel_ladder_seasons  a named stretch of nights (High season, first night
--                         … last night, inclusive). Seasons of one property
--                         never overlap (checked in channelPriceLadders.js).
-- channel_price_ladders   season_id: NULL = the All year ladder as before, set
--                         = that season's ladder. increase_pct: the % typed for
--                         this tier (a fill tool, remembered for next time);
--                         the price is still what is sent.
--
-- On a night inside a season a meal plan + room type uses the season's ladder;
-- without one there it uses its All year ladder. A fixed OTA price still wins.
-- Every existing ladder stays All year, so no price changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_ladder_seasons (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name         VARCHAR(80) NOT NULL,
  date_from    DATE NOT NULL,
  date_to      DATE NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS idx_channel_ladder_seasons_property ON channel_ladder_seasons (property_id, date_from);

ALTER TABLE channel_price_ladders
  ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES channel_ladder_seasons(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS increase_pct NUMERIC(6, 2);

ALTER TABLE channel_price_ladders DROP CONSTRAINT IF EXISTS channel_price_ladders_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_price_ladders_all_year
  ON channel_price_ladders (property_id, rate_plan_id, room_type_id, sold_up_to) WHERE season_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_price_ladders_season
  ON channel_price_ladders (season_id, rate_plan_id, room_type_id, sold_up_to) WHERE season_id IS NOT NULL;

DROP TRIGGER IF EXISTS channel_dirty_ladder_seasons ON channel_ladder_seasons;
CREATE TRIGGER channel_dirty_ladder_seasons AFTER INSERT OR UPDATE OR DELETE ON channel_ladder_seasons
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
