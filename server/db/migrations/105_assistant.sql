-- 105: Ask — staff ask the PMS a question by voice or typing.
-- The language model only picks which read-only PMS lookup to run
-- (services/assistantTools.js); nothing here changes bookings. Additive only.

-- ── 1. Module (default off, backfilled) ─────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'assistant', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. One row per question ─────────────────────────────────────
-- What was asked, what was answered, which lookups ran and what it cost in
-- tokens — for the usage per property and for seeing where it misunderstands.
CREATE TABLE IF NOT EXISTS assistant_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  question      TEXT NOT NULL,
  reply         TEXT,
  tools         JSONB,
  input_tokens  INT,
  output_tokens INT,
  duration_ms   INT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_log_property ON assistant_log (property_id, created_at);
