CREATE TABLE IF NOT EXISTS pricing_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#6b7280',
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  type VARCHAR(15) NOT NULL DEFAULT 'multiplier' CHECK (type IN ('multiplier', 'fixed')),
  value NUMERIC(12,4) NOT NULL,
  unit_ids JSONB DEFAULT '[]',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
