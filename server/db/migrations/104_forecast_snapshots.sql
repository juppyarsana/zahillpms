-- 104: Forecast snapshots — what was on the books for each future night, kept
-- once a day, so pickup ("this night gained 3 rooms since last week") and
-- later a real projection can be worked out. It cannot be rebuilt afterwards:
-- a booking that was amended or cancelled no longer shows what it looked like
-- before. One row per property, per day the snapshot was taken, per night
-- (yesterday … 120 nights ahead) — about 120 small rows a day.
--   snapshot_date  — the property's day the snapshot was taken (just after
--                    midnight: the position at the close of the day before)
--   rooms_for_sale — rooms not out of order when it was taken
--   room_revenue / meal_revenue — net, that night's share (the Reports rule)
--   by_type / by_source — rooms sold per room type / booking source
--                         ({ "Deluxe": 3, … }; NULL when nothing is sold)
-- Written by services/forecastSnapshot.js (nightly job). Additive only.
CREATE TABLE IF NOT EXISTS forecast_snapshots (
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  snapshot_date  DATE NOT NULL,
  night          DATE NOT NULL,
  rooms_sold     INT NOT NULL DEFAULT 0,
  rooms_for_sale INT NOT NULL DEFAULT 0,
  guests         INT NOT NULL DEFAULT 0,
  room_revenue   NUMERIC(14,2) NOT NULL DEFAULT 0,
  meal_revenue   NUMERIC(14,2) NOT NULL DEFAULT 0,
  by_type        JSONB,
  by_source      JSONB,
  taken_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, snapshot_date, night)
);
