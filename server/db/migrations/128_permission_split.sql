-- 128: Permissions follow the menu (2026-10-23).
--
-- Finance had one permission, "accounting", for three pages. It is split:
--   receivables — Finance → Receivables (agents, companies, OTAs; was Agent Billing)
--   expenses    — Finance → Expenses
--   accounting  — Finance → Accounting (the books) only
-- Every role that had "accounting" keeps all three pages.
--
-- New, given to nobody (owners always have them):
--   purchasing  — Operations → Purchasing & Stock
--   approve_po  — approve a purchase order (needs purchasing too)
--   reports     — Revenue → Reports
--
-- Removed: "users" and "settings". Users (staff logins) and Sources &
-- Payments are owner-only on the server, so those tick boxes never worked.

UPDATE roles
SET allowed_menus = allowed_menus
  || CASE WHEN 'receivables' = ANY(allowed_menus) THEN '{}'::text[] ELSE ARRAY['receivables'] END
  || CASE WHEN 'expenses'    = ANY(allowed_menus) THEN '{}'::text[] ELSE ARRAY['expenses'] END
WHERE 'accounting' = ANY(allowed_menus);

UPDATE roles
SET allowed_menus = array_remove(array_remove(allowed_menus, 'users'), 'settings')
WHERE 'users' = ANY(allowed_menus) OR 'settings' = ANY(allowed_menus);
