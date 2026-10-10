-- 103: Room tablet alerts on Telegram (low battery, offline).
-- What was already told, so the same thing isn't sent again:
--   battery_alert_level — NULL = nothing sent; 25 = "below 25%" sent;
--                         10 = "below 10%" sent. Back to NULL once the tablet
--                         is charging or at 30% and above.
--   offline_alerted_at  — when "offline" was sent; NULL again when the tablet
--                         reports back (and "back online" is sent).
-- Additive only.
ALTER TABLE room_display_devices ADD COLUMN IF NOT EXISTS battery_alert_level SMALLINT;
ALTER TABLE room_display_devices ADD COLUMN IF NOT EXISTS offline_alerted_at TIMESTAMPTZ;
