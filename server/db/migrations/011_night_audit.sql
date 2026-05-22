-- Night Audit: property_settings singleton + audit run log

CREATE TABLE IF NOT EXISTS property_settings (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_audit_at TIMESTAMPTZ
);

INSERT INTO property_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS night_audit_runs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_date     DATE NOT NULL UNIQUE,
  run_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_by      TEXT NOT NULL,
  units_occupied    INTEGER,
  no_shows          JSONB,
  room_revenue      NUMERIC(12,2),
  ancillary_revenue NUMERIC(12,2),
  pending_balances  JSONB,
  tasks_created     INTEGER,
  summary           TEXT
);
