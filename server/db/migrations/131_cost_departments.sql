-- 131: Costs by department (owner, 2026-10-23): every expense and supplier
-- bill carries the department it was for, so the hotel sees which department
-- costs the most (Reports → Costs by department). A management tag only —
-- the category still decides the account, journal and P&L are unchanged.
--
-- Departments (fixed list, services/costCategories.js DEPARTMENTS):
--   front_office, housekeeping, fnb, engineering, activities, sales, admin
-- Existing rows get their category's usual department. A supplier can
-- remember a usual department (suppliers.default_department).

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS department VARCHAR(20);
ALTER TABLE supplier_bills ADD COLUMN IF NOT EXISTS department VARCHAR(20);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_department VARCHAR(20);

CREATE TEMP TABLE dept_by_cat (category TEXT, department TEXT) ON COMMIT DROP;
INSERT INTO dept_by_cat VALUES
  ('food', 'fnb'), ('drinks', 'fnb'), ('guest_supplies', 'housekeeping'), ('laundry', 'housekeeping'),
  ('utilities', 'engineering'), ('maintenance', 'engineering'), ('supplies', 'admin'), ('marketing', 'sales'),
  ('staff', 'admin'), ('admin_fees', 'admin'), ('ota_commission', 'front_office'), ('other', 'admin');

UPDATE expenses e SET department = COALESCE(d.department, 'admin') FROM dept_by_cat d WHERE d.category = e.category AND e.department IS NULL;
UPDATE expenses SET department = 'admin' WHERE department IS NULL;
UPDATE supplier_bills b SET department = COALESCE(d.department, 'admin') FROM dept_by_cat d WHERE d.category = b.category AND b.department IS NULL;
UPDATE supplier_bills SET department = 'admin' WHERE department IS NULL;

ALTER TABLE expenses ALTER COLUMN department SET NOT NULL;
ALTER TABLE supplier_bills ALTER COLUMN department SET NOT NULL;
ALTER TABLE expenses ADD CONSTRAINT expenses_department_check CHECK (department IN
  ('front_office', 'housekeeping', 'fnb', 'engineering', 'activities', 'sales', 'admin'));
ALTER TABLE supplier_bills ADD CONSTRAINT supplier_bills_department_check CHECK (department IN
  ('front_office', 'housekeeping', 'fnb', 'engineering', 'activities', 'sales', 'admin'));
ALTER TABLE suppliers ADD CONSTRAINT suppliers_default_department_check CHECK (default_department IS NULL OR default_department IN
  ('front_office', 'housekeeping', 'fnb', 'engineering', 'activities', 'sales', 'admin'));
