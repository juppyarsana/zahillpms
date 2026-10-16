-- 110: Profit & Loss — which P&L line each revenue / expense account shows on,
-- and the accounts a hotel P&L needs that the step-1 chart didn't have
-- (payroll by department, cost of food & drinks, card / QRIS fees, fixed
-- charges). The P&L itself is not stored: services/plService.js adds up the
-- journal per account. Additive only.

-- ── 1. P&L line per account ─────────────────────────────────────
-- rev.rooms / rev.fnb / rev.other / rev.misc   (revenue accounts)
-- dept.rooms / dept.fnb / dept.other            (departmental expenses)
-- und.admin / und.sales / und.maint / und.utilities  (undistributed)
-- fixed                                         (fixed charges)
-- none                                          (left off the P&L)
-- NULL = the default for its kind (revenue → rev.misc, expense → und.admin).
-- Asset / liability / equity accounts are never on the P&L.
ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS pl_line VARCHAR(20);

-- ── 2. The standard accounts' lines (charts already made) ───────
UPDATE gl_accounts a SET pl_line = v.pl_line
FROM (VALUES
  ('4110', 'revenue', 'rev.rooms'),
  ('4210', 'revenue', 'rev.fnb'), ('4220', 'revenue', 'rev.fnb'),
  ('4310', 'revenue', 'rev.other'), ('4320', 'revenue', 'rev.other'), ('4330', 'revenue', 'rev.other'),
  ('4340', 'revenue', 'rev.other'), ('4350', 'revenue', 'rev.other'), ('4360', 'revenue', 'rev.other'),
  ('4390', 'revenue', 'rev.other'), ('4410', 'revenue', 'rev.other'), ('4420', 'revenue', 'rev.other'),
  ('6110', 'expense', 'dept.rooms'),
  ('6210', 'expense', 'und.utilities'),
  ('6220', 'expense', 'dept.rooms'),
  ('6230', 'expense', 'und.maint'),
  ('6240', 'expense', 'und.admin'),
  ('6250', 'expense', 'und.admin'),
  ('6260', 'expense', 'und.sales'),
  ('6270', 'expense', 'und.admin'),
  ('6290', 'expense', 'und.admin')
) AS v(code, type, pl_line)
WHERE a.code = v.code AND a.type = v.type AND a.pl_line IS NULL;

-- ── 3. New standard accounts, for every chart already made ──────
-- (a chart made from now on gets them from accountingService.DEFAULT_CHART).
INSERT INTO gl_accounts (property_id, code, name, type, pl_line)
SELECT p.property_id, v.code, v.name, v.type, v.pl_line
FROM (SELECT DISTINCT property_id FROM gl_accounts) p
CROSS JOIN (VALUES
  ('4910', 'Other income', 'revenue', 'rev.misc'),
  ('5110', 'Rooms — payroll', 'expense', 'dept.rooms'),
  ('5120', 'Rooms — OTA commission', 'expense', 'dept.rooms'),
  ('5130', 'Rooms — guest supplies & amenities', 'expense', 'dept.rooms'),
  ('5210', 'F&B — payroll', 'expense', 'dept.fnb'),
  ('5220', 'F&B — cost of food', 'expense', 'dept.fnb'),
  ('5230', 'F&B — cost of drinks', 'expense', 'dept.fnb'),
  ('5240', 'F&B — supplies', 'expense', 'dept.fnb'),
  ('5310', 'Cost of activities & transport', 'expense', 'dept.other'),
  ('6280', 'Card & QRIS fees', 'expense', 'und.admin'),
  ('7110', 'Rent / lease', 'expense', 'fixed'),
  ('7120', 'Insurance', 'expense', 'fixed'),
  ('7130', 'Property tax (PBB)', 'expense', 'fixed'),
  ('7140', 'Depreciation', 'expense', 'fixed')
) AS v(code, name, type, pl_line)
ON CONFLICT (property_id, code) DO NOTHING;
