-- Missed calls list (services/callLines.js missedCalls): a room's call nobody
-- answered stays on the line's list until someone talks to that room again, or
-- staff press Done (e.g. the guest came to the desk instead).
ALTER TABLE calls ADD COLUMN IF NOT EXISTS missed_done_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS missed_done_by_name TEXT;
CREATE INDEX IF NOT EXISTS idx_calls_missed ON calls (unit_id, created_at) WHERE status = 'missed';
