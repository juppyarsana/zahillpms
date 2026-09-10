-- ============================================================
-- Migration 052 — Room Display Devices (tablet telemetry)
--
-- One row per Room Display Kiosk tablet (room-display-kiosk/ Android APK),
-- keyed by the same (property_id, controller_id) pair every other display
-- endpoint resolves — controller_id == units.controller_id == the "room ID"
-- the tablet stores locally.
--
-- Written only by POST /api/display/room/:roomId/telemetry (authDisplay, no
-- moduleGuard — device health is always-on, like GET /state). The APK posts
-- directly on a ~2-min ticker + on battery/connectivity change, its own
-- channel separate from the PWA's GET /state poll so "tablet alive, battery
-- 12%" still reports even when the web app fails to load.
--
-- Almost every column is nullable: the APK may send a partial payload and
-- the schema can grow without a migration. last_seen_at doubles as the
-- liveness heartbeat — "offline" is derived client-side (last_seen_at older
-- than ~6 min), not stored. This is current-state only, not time-series.
--
-- controller_id is VARCHAR(32) to match units.controller_id (widened in 045).
-- Not a gated module — no property_modules row, no backfill.
-- ============================================================

CREATE TABLE IF NOT EXISTS room_display_devices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  controller_id VARCHAR(32) NOT NULL,

  -- power
  battery_level    INTEGER,
  battery_charging BOOLEAN,
  power_source     VARCHAR(10) CHECK (power_source IN ('ac', 'usb', 'wireless', 'none')),
  battery_temp_c   NUMERIC(4,1),

  -- network
  network_type         VARCHAR(10) CHECK (network_type IN ('wifi', 'ethernet', 'cellular', 'none')),
  internet_ok          BOOLEAN,
  wifi_ssid            VARCHAR(64),
  wifi_bssid           VARCHAR(17),
  wifi_rssi            INTEGER,
  wifi_link_speed_mbps INTEGER,
  wifi_frequency_mhz   INTEGER,
  ip_address           VARCHAR(45),

  -- host
  storage_free_mb  BIGINT,
  storage_total_mb BIGINT,
  uptime_seconds   BIGINT,
  app_version      VARCHAR(32),
  webview_version  VARCHAR(64),
  android_version  VARCHAR(32),
  device_model     VARCHAR(64),
  screen_on        BOOLEAN,

  -- liveness
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_room_display_devices_property_controller
  ON room_display_devices (property_id, controller_id);

CREATE INDEX IF NOT EXISTS idx_room_display_devices_property
  ON room_display_devices (property_id);
