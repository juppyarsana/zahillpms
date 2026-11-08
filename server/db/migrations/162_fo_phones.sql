-- Front desk phones (the Android app, fo-phone/): a phone answers and places
-- front desk calls like a PMS screen. The owner adds a phone in Settings and
-- gets a short pairing code; the phone trades it once for its own long key
-- (only its hash is kept). Removing the phone stops the key at once.
CREATE TABLE IF NOT EXISTS call_devices (
  id               SERIAL PRIMARY KEY,
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  line             TEXT NOT NULL DEFAULT 'front_desk' CHECK (line IN ('front_desk', 'restaurant')),
  key_hash         TEXT UNIQUE,
  pair_code        TEXT,
  pair_expires_at  TIMESTAMPTZ,
  paired_at        TIMESTAMPTZ,
  last_seen_at     TIMESTAMPTZ,
  app_version      TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_devices_pair_code ON call_devices (pair_code) WHERE pair_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_devices_property ON call_devices (property_id) WHERE removed_at IS NULL;
