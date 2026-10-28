-- 143: Room TV Watch row apps (tv-launcher).
--
-- The apps on the room TV's Home "Watch" row, left to right, as Android package names
-- (e.g. ["com.netflix.ninja", "com.google.android.youtube.tv"]). Chosen on Guest Board →
-- Room TVs. NULL = the TV app's own built-in list. A TV without one of the apps installed
-- simply leaves it out.

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS tv_watch_apps JSONB;
