-- ============================================================
-- Migration 125 — Channel Manager: a price for one meal plan on the OTAs
--
-- channel_rate_prices  a price typed for one room type + meal plan over a
--                      run of nights, sent to the channel manager exactly as
--                      typed (per room per night, service & tax included —
--                      the OTA's final price). It replaces the worked-out
--                      price (room rate + meal plan) for those nights on the
--                      OTAs only; New Booking and the folio are unchanged.
--                      Where two rows cover the same night, the one saved
--                      last wins. Several rows saved in one go (batch_id)
--                      reach Channex in one call.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_rate_prices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id  UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  rate_plan_id  UUID NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  date_from     DATE NOT NULL,
  date_to       DATE NOT NULL,             -- the last night (inclusive)
  price         NUMERIC(14, 2) NOT NULL CHECK (price > 0),
  batch_id      UUID NOT NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_channel_rate_prices_property ON channel_rate_prices(property_id, date_to);

DROP TRIGGER IF EXISTS channel_dirty_rate_prices ON channel_rate_prices;
CREATE TRIGGER channel_dirty_rate_prices AFTER INSERT OR UPDATE OR DELETE ON channel_rate_prices
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
