-- ============================================================
-- Migration 120 — Channel Manager, stage 2: free rooms + prices out
--
-- channel_sync_state   one row per property: when something that changes
--                      free rooms or prices last happened (dirty_at, set by
--                      the triggers below), what the sync worker has handled
--                      (done_dirty_at), and how the last send went.
-- channel_sync_values  what was last sent to the channel manager, per night:
--                      kind 'a' = availability of a room type, 'r' = price of
--                      a rate plan. The worker sends only the nights whose
--                      value differs (services/channelSync.js).
--
-- The triggers mark a property only when it is linked to Channex
-- (properties.channex_property_id), so other properties pay nothing.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_sync_state (
  property_id    UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  dirty_at       TIMESTAMPTZ,
  done_dirty_at  TIMESTAMPTZ,
  last_run_at    TIMESTAMPTZ,
  last_ok_at     TIMESTAMPTZ,
  last_full_at   TIMESTAMPTZ,
  last_error     TEXT,
  last_error_at  TIMESTAMPTZ,
  next_try_at    TIMESTAMPTZ,
  last_sent      JSONB
);

CREATE TABLE IF NOT EXISTS channel_sync_values (
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind         CHAR(1) NOT NULL CHECK (kind IN ('a', 'r')),
  external_id  VARCHAR(100) NOT NULL,
  night        DATE NOT NULL,
  value        NUMERIC(14, 2) NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (property_id, kind, external_id, night)
);

CREATE OR REPLACE FUNCTION channel_mark_dirty() RETURNS trigger AS $$
DECLARE pid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD.property_id; ELSE pid := NEW.property_id; END IF;
  IF pid IS NOT NULL AND EXISTS (SELECT 1 FROM properties WHERE id = pid AND channex_property_id IS NOT NULL) THEN
    INSERT INTO channel_sync_state (property_id, dirty_at) VALUES (pid, clock_timestamp())
    ON CONFLICT (property_id) DO UPDATE SET dirty_at = clock_timestamp();
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Bookings: a new / removed booking, or a change of room, dates or status.
DROP TRIGGER IF EXISTS channel_dirty_bookings_ins ON bookings;
CREATE TRIGGER channel_dirty_bookings_ins AFTER INSERT OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
DROP TRIGGER IF EXISTS channel_dirty_bookings_upd ON bookings;
CREATE TRIGGER channel_dirty_bookings_upd AFTER UPDATE ON bookings
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.unit_id IS DISTINCT FROM NEW.unit_id
                     OR OLD.check_in_date IS DISTINCT FROM NEW.check_in_date
                     OR OLD.check_out_date IS DISTINCT FROM NEW.check_out_date)
  EXECUTE FUNCTION channel_mark_dirty();

-- Rooms: out of order / back, moved to another type, rate (mirrored from the type).
DROP TRIGGER IF EXISTS channel_dirty_units_ins ON units;
CREATE TRIGGER channel_dirty_units_ins AFTER INSERT OR DELETE ON units
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
DROP TRIGGER IF EXISTS channel_dirty_units_upd ON units;
CREATE TRIGGER channel_dirty_units_upd AFTER UPDATE ON units
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.status_expected_back IS DISTINCT FROM NEW.status_expected_back
                     OR OLD.room_type_id IS DISTINCT FROM NEW.room_type_id OR OLD.base_rate IS DISTINCT FROM NEW.base_rate)
  EXECUTE FUNCTION channel_mark_dirty();

-- Prices: pricing periods (incl. the yield engine's), room types, meal plans, tax.
DROP TRIGGER IF EXISTS channel_dirty_pricing_periods ON pricing_periods;
CREATE TRIGGER channel_dirty_pricing_periods AFTER INSERT OR UPDATE OR DELETE ON pricing_periods
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
DROP TRIGGER IF EXISTS channel_dirty_room_types ON room_types;
CREATE TRIGGER channel_dirty_room_types AFTER INSERT OR UPDATE OR DELETE ON room_types
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
DROP TRIGGER IF EXISTS channel_dirty_rate_plans ON rate_plans;
CREATE TRIGGER channel_dirty_rate_plans AFTER INSERT OR UPDATE OR DELETE ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
DROP TRIGGER IF EXISTS channel_dirty_property_settings ON property_settings;
CREATE TRIGGER channel_dirty_property_settings AFTER UPDATE ON property_settings
  FOR EACH ROW WHEN (OLD.tax_rate IS DISTINCT FROM NEW.tax_rate OR OLD.service_charge_rate IS DISTINCT FROM NEW.service_charge_rate
                     OR OLD.prices_include_tax IS DISTINCT FROM NEW.prices_include_tax)
  EXECUTE FUNCTION channel_mark_dirty();

-- Linking / unlinking a room type or meal plan (stage 1 setup page).
DROP TRIGGER IF EXISTS channel_dirty_room_type_links ON channel_room_types;
CREATE TRIGGER channel_dirty_room_type_links AFTER INSERT OR DELETE ON channel_room_types
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
DROP TRIGGER IF EXISTS channel_dirty_rate_plan_links ON channel_rate_plans;
CREATE TRIGGER channel_dirty_rate_plan_links AFTER INSERT OR DELETE ON channel_rate_plans
  FOR EACH ROW EXECUTE FUNCTION channel_mark_dirty();
