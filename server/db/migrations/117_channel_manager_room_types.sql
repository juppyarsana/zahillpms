-- ============================================================
-- Migration 117 — Channel Manager, stage 1: link by room type
--
-- The September spike (migration 060) linked ONE unit to one Channex room
-- type (count 1). OTAs sell room types ("Deluxe × 25"), not room 107, so a
-- PMS room type now maps to one Channex room type (count = its rooms), and
-- each (room type, meal plan) pair to one Channex rate plan.
--
-- `channel_manager_mappings` (060) is left as it was and no longer read.
-- Vendor-agnostic names again (`provider`, `external_*`) so another channel
-- manager needs only a new adapter, not a new table.
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_room_types (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id            UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider               VARCHAR(20) NOT NULL DEFAULT 'channex',
  room_type_id           UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  external_room_type_id  VARCHAR(100) NOT NULL,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, provider, room_type_id),
  UNIQUE (property_id, provider, external_room_type_id)
);

CREATE TABLE IF NOT EXISTS channel_rate_plans (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id            UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider               VARCHAR(20) NOT NULL DEFAULT 'channex',
  room_type_id           UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  rate_plan_id           UUID NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  external_rate_plan_id  VARCHAR(100) NOT NULL,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, provider, room_type_id, rate_plan_id),
  UNIQUE (property_id, provider, external_rate_plan_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_room_types_property ON channel_room_types(property_id);
CREATE INDEX IF NOT EXISTS idx_channel_rate_plans_property ON channel_rate_plans(property_id);
