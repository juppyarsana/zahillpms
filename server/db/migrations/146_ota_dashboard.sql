-- ============================================================
-- Migration 146 — OTA dashboard (Sales)
--
-- property_settings.ota_targets  occupancy targets by days before the stay
--                                { near: 0–7 days, mid: 8–14, far: 15–30 };
--                                NULL = 40 / 30 / 20. A night below its target
--                                shows as slow.
-- channel_min_prices             the lowest price per room per night (service
--                                & tax included) anyone can send to the OTAs
--                                for a room type. Checked when an OTA price or
--                                a ladder is saved; suggestions stop at it.
-- ota_price_log                  every change of OTA prices, ladders or these
--                                rules: who, when, what.
--
-- New permission `ota_dashboard` (Roles & Permissions → Sales): open the page
-- and change OTA prices and ladders. Given to every role named like "sales".
-- New free alert `alert_ota_price`: an OTA price changed by someone other than
-- the owner. Ticked for owners' Telegram recipients.
-- Additive only.
-- ============================================================

ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS ota_targets JSONB;

CREATE TABLE IF NOT EXISTS channel_min_prices (
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id  UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  price         NUMERIC(14, 2) NOT NULL CHECK (price > 0),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, room_type_id)
);

CREATE TABLE IF NOT EXISTS ota_price_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       VARCHAR(20) NOT NULL,   -- night_price / night_removed / prices / prices_removed / ladder / ladder_removed / rules
  night        DATE,
  summary      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ota_price_log_property ON ota_price_log (property_id, created_at DESC);

UPDATE roles
SET allowed_menus = array_append(allowed_menus, 'ota_dashboard')
WHERE label ILIKE '%sales%' AND NOT ('ota_dashboard' = ANY(allowed_menus));

UPDATE notification_recipients SET reports = array_append(reports, 'alert_ota_price')
WHERE role = 'owner' AND channel = 'telegram' AND NOT ('alert_ota_price' = ANY(reports));
