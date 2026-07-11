CREATE TABLE IF NOT EXISTS calls (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id       UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  department    VARCHAR(30) NOT NULL DEFAULT 'front_desk' CHECK (department IN ('front_desk')),
  status        VARCHAR(20) NOT NULL DEFAULT 'ringing'
                  CHECK (status IN ('ringing','answered','missed','ended')),
  answered_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at   TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS calls_unit_id_idx ON calls(unit_id);
CREATE INDEX IF NOT EXISTS calls_status_idx  ON calls(status);
