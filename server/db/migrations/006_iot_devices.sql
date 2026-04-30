-- IoT device tables for Birdnest smart room integration

-- Add controller_id to units (links a unit to its ESP32 controller)
ALTER TABLE units ADD COLUMN IF NOT EXISTS controller_id VARCHAR(10);
CREATE UNIQUE INDEX IF NOT EXISTS units_controller_id_key ON units(controller_id) WHERE controller_id IS NOT NULL;

-- Relay state per unit (up to 5 relays per controller)
CREATE TABLE IF NOT EXISTS unit_relays (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id      UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  relay_num    INT NOT NULL CHECK (relay_num BETWEEN 1 AND 5),
  label        VARCHAR(100) NOT NULL DEFAULT '',
  state        BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (unit_id, relay_num)
);

-- Controller online/status per controller_id
CREATE TABLE IF NOT EXISTS room_controller_status (
  controller_id VARCHAR(10) PRIMARY KEY,
  connected     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address    VARCHAR(45),
  rgb           JSONB DEFAULT '{}',
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
