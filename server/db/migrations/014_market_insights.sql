-- Competitor tracking (Google Places ratings)
CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  place_id TEXT,               -- resolved Google Place ID (nullable until first lookup succeeds)
  matched_address TEXT,        -- address Google resolved the name to, for sanity-checking the match
  is_self BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE competitor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  rating NUMERIC(2,1),
  review_count INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_competitor_snapshots_lookup ON competitor_snapshots (competitor_id, captured_at DESC);

INSERT INTO competitors (name) VALUES
  ('The Dewi Kintamani'),
  ('Kubah Bali Glamping'),
  ('Bali Sunrise Camp & Home Stay'),
  ('Toteme Glamping');

-- Search interest tracking (Google Trends)
CREATE TABLE search_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  point_date DATE NOT NULL,    -- the week/day this interest value represents
  interest INTEGER NOT NULL,   -- Google's relative 0-100 interest score
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (term, point_date)
);

-- Holiday / event calendar (national + Balinese Hindu observances)
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'national', -- 'national' | 'balinese'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (holiday_date, name)
);

-- Balinese Hindu holidays (pawukon calendar — not covered by generic holiday APIs).
-- Verified via web search on 2026-07-06; re-verify/extend yearly.
INSERT INTO holidays (holiday_date, name, category) VALUES
  ('2027-01-13', 'Galungan', 'balinese'),
  ('2027-01-23', 'Kuningan', 'balinese'),
  ('2027-03-08', 'Nyepi (Day of Silence)', 'balinese'),
  ('2027-08-11', 'Galungan', 'balinese'),
  ('2027-08-21', 'Kuningan', 'balinese');
