-- ============================================================
-- Migration 115 — Room tablet connection history
--
-- Settings → Property → Room tablets (routes/roomTablets.js,
-- services/tabletLink.js). Kept 30 days, pruned nightly.
--
--   room_tablet_drops     one row per time a tablet could not reach the
--                         server for more than 60 s: written when it comes
--                         back (live), or imported once from the nginx log
--                         (maintenance/tabletConnectivity.js --save).
--   room_tablet_days      per room per day: first and last request seen —
--                         says the tablet was running that day, and for how
--                         long, so drops can be counted per 24 h.
--   room_tablet_readings  the kiosk app's WiFi / battery reports, at most one
--                         per tablet per 5 minutes plus every access-point
--                         change.
--   room_tablet_access_points  a name for an access point (by BSSID).
-- ============================================================

CREATE TABLE IF NOT EXISTS room_tablet_drops (
  id            BIGSERIAL PRIMARY KEY,
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  controller_id VARCHAR(32) NOT NULL,
  offline_from  TIMESTAMPTZ NOT NULL,
  back_at       TIMESTAMPTZ NOT NULL,
  seconds       INTEGER NOT NULL,
  source        VARCHAR(8) NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'log')),
  UNIQUE (property_id, controller_id, offline_from)
);
CREATE INDEX IF NOT EXISTS idx_room_tablet_drops_time ON room_tablet_drops (property_id, offline_from);

CREATE TABLE IF NOT EXISTS room_tablet_days (
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  controller_id VARCHAR(32) NOT NULL,
  day           DATE NOT NULL,
  first_seen    TIMESTAMPTZ NOT NULL,
  last_seen     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (property_id, day, controller_id)
);

CREATE TABLE IF NOT EXISTS room_tablet_readings (
  id                   BIGSERIAL PRIMARY KEY,
  property_id          UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  controller_id        VARCHAR(32) NOT NULL,
  at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  network_type         VARCHAR(10),
  internet_ok          BOOLEAN,
  wifi_ssid            VARCHAR(64),
  wifi_bssid           VARCHAR(17),
  wifi_rssi            INTEGER,
  wifi_frequency_mhz   INTEGER,
  wifi_link_speed_mbps INTEGER,
  battery_level        INTEGER,
  battery_charging     BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_room_tablet_readings_room ON room_tablet_readings (property_id, controller_id, at);
CREATE INDEX IF NOT EXISTS idx_room_tablet_readings_time ON room_tablet_readings (property_id, at);

CREATE TABLE IF NOT EXISTS room_tablet_access_points (
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bssid       VARCHAR(17) NOT NULL,
  name        VARCHAR(60) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, bssid)
);
