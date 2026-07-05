CREATE TABLE ai_market_summary (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  summary TEXT,
  generated_at TIMESTAMPTZ
);

INSERT INTO ai_market_summary (id) VALUES (1) ON CONFLICT DO NOTHING;
