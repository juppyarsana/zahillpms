-- Add enabled and icon config to unit relays
ALTER TABLE unit_relays
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE unit_relays
  ADD COLUMN IF NOT EXISTS icon VARCHAR(50) NOT NULL DEFAULT 'electrical_services';
