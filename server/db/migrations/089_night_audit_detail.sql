-- Night audit detail (2026-10-01): the full report of what an audit did,
-- saved at the moment the day was closed so a reprint later always shows the
-- same figures (a price edited next week doesn't change last week's audit).
-- Built by services/nightAuditDetail.js; NULL for runs before this migration
-- (the detail is then rebuilt from the data as it is now, and says so).
ALTER TABLE night_audit_runs ADD COLUMN IF NOT EXISTS detail JSONB;

-- New "night_audit" permission (Roles & Permissions → Operations): view the
-- Night Audit page, its details and PDFs. Running an audit by hand stays
-- owner-only. Given to every existing role named like "manager".
UPDATE roles
SET allowed_menus = array_append(allowed_menus, 'night_audit')
WHERE label ILIKE '%manager%' AND NOT ('night_audit' = ANY(allowed_menus));
