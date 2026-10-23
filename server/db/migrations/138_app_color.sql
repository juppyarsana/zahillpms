-- ============================================================
-- Migration 138 — the staff app's colour per property
--
-- property_settings.app_color  the main colour of the staff app (menu,
--                              buttons, active tabs), set in Superadmin →
--                              Branding. NULL = the app's own maroon. Apart
--                              from brand_color, which stays the room
--                              tablets' / TV's accent (Zahill: gold accent
--                              on the tablets, maroon app).
-- ============================================================

ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS app_color VARCHAR(7);
