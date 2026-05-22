-- Add arriving_today column to night_audit_runs
ALTER TABLE night_audit_runs
  ADD COLUMN IF NOT EXISTS arriving_today JSONB;
