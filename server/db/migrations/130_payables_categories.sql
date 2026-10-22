-- 130: Payables made simpler (owner, 2026-10-23): a supplier bill is ONE
-- category + ONE amount, no lines on accounts of the chart. The categories
-- are the Expenses ones (one list for both), so the accountant maps each
-- category to an account once (Accounting → Accounts, the expense.* keys).
--
-- The list gains Food, Drinks and Guest supplies (the usual supplier bills of
-- a hotel) — Expenses can use them too.
--
-- Bills made with 129 (dev only — 129 was never released) get the category of
-- their first line's account in the standard chart, else "other", and the
-- total as before. The bill-lines table and suppliers.default_account_id go;
-- a supplier remembers a usual category instead.

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
  ('food', 'drinks', 'guest_supplies', 'utilities', 'laundry', 'maintenance', 'staff', 'supplies',
   'marketing', 'admin_fees', 'ota_commission', 'other'));

ALTER TABLE supplier_bills ADD COLUMN IF NOT EXISTS category VARCHAR(30);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_category VARCHAR(30);

-- standard chart code → category
CREATE TEMP TABLE cat_by_code (code TEXT, category TEXT) ON COMMIT DROP;
INSERT INTO cat_by_code VALUES
  ('5220', 'food'), ('5230', 'drinks'), ('5240', 'supplies'), ('5130', 'guest_supplies'),
  ('6210', 'utilities'), ('6220', 'laundry'), ('6230', 'maintenance'), ('6240', 'staff'),
  ('6250', 'supplies'), ('6260', 'marketing'), ('6270', 'admin_fees'), ('5120', 'ota_commission');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_bill_lines') THEN
    UPDATE supplier_bills b SET category = COALESCE((
      SELECT c.category FROM supplier_bill_lines l
      JOIN gl_accounts a ON a.id = l.account_id
      JOIN cat_by_code c ON c.code = a.code
      WHERE l.bill_id = b.id ORDER BY l.line_no LIMIT 1), 'other')
    WHERE b.category IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'suppliers' AND column_name = 'default_account_id') THEN
    UPDATE suppliers s SET default_category = c.category
    FROM gl_accounts a JOIN cat_by_code c ON c.code = a.code
    WHERE a.id = s.default_account_id AND s.default_category IS NULL;
  END IF;
END $$;

UPDATE supplier_bills SET category = 'other' WHERE category IS NULL;
ALTER TABLE supplier_bills ALTER COLUMN category SET NOT NULL;
ALTER TABLE supplier_bills DROP CONSTRAINT IF EXISTS supplier_bills_category_check;
ALTER TABLE supplier_bills ADD CONSTRAINT supplier_bills_category_check CHECK (category IN
  ('food', 'drinks', 'guest_supplies', 'utilities', 'laundry', 'maintenance', 'staff', 'supplies',
   'marketing', 'admin_fees', 'ota_commission', 'other'));
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_default_category_check;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_default_category_check CHECK (default_category IS NULL OR default_category IN
  ('food', 'drinks', 'guest_supplies', 'utilities', 'laundry', 'maintenance', 'staff', 'supplies',
   'marketing', 'admin_fees', 'ota_commission', 'other'));

DROP TABLE IF EXISTS supplier_bill_lines;
ALTER TABLE suppliers DROP COLUMN IF EXISTS default_account_id;
