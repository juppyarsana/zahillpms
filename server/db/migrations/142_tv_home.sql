-- 142: Room TV Home (TV_LAUNCHER_PLAN.md, Phase 2).
--
-- The room TV's own Home screen (tv-launcher/, com.zahill.tv) shows the guest's stay
-- with a few hotel facts, and a background photo. Set on the Guest Board page → TV Home.
--
--   tv_backgrounds   up to three photos by time of day:
--                    [{ "slot": "morning"|"day"|"night", "start": "05:00", "image_url": "/board-images/…" }]
--                    One photo = used all day. NULL / [] = the TV's built-in photo.
--   tv_bg_use_board  true (default) = the Guest Board's photos rotate as the background,
--                    and the time-of-day photos are used only when there are none.
--   guest_wifi_ssid / guest_wifi_password   the guests' Wi-Fi, shown on Home.
--   breakfast_hours  free text, e.g. "07:00 – 10:30"; breakfast_outlet e.g. "Sisi Gege".
--   checkout_time    "HH:MM", shown next to the check-out day.
-- All optional: a field left empty is simply not shown.

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS tv_backgrounds      JSONB,
  ADD COLUMN IF NOT EXISTS tv_bg_use_board     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS guest_wifi_ssid     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS guest_wifi_password VARCHAR(64),
  ADD COLUMN IF NOT EXISTS breakfast_hours     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS breakfast_outlet    VARCHAR(60),
  ADD COLUMN IF NOT EXISTS checkout_time       VARCHAR(5);
