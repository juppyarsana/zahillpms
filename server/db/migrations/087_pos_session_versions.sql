-- 087: Every send of a POS restaurant session is kept (pos_sessions holds the
-- latest; this is its history for the Restaurant page). `changes` = what the
-- send changed against the previous one (bills added / removed / changed, the
-- totals before → after), NULL on the first send. Existing sessions get their
-- current copy as version 1. Additive only.
CREATE TABLE IF NOT EXISTS pos_session_versions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  summary     JSONB NOT NULL,
  changes     JSONB,
  sent_by     VARCHAR(100),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, version)
);
CREATE INDEX IF NOT EXISTS idx_pos_session_versions_session ON pos_session_versions (session_id, version DESC);

INSERT INTO pos_session_versions (session_id, property_id, version, summary, sent_by, sent_at)
SELECT s.id, s.property_id, 1, s.summary, s.sent_by, s.sent_at
  FROM pos_sessions s
 WHERE NOT EXISTS (SELECT 1 FROM pos_session_versions v WHERE v.session_id = s.id);
