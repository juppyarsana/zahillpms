-- Food & drink by the inventory method (accountant, 2026-10-30): from this day
-- food and drinks bought go to inventory (130-00-001 / 002) instead of cost, and
-- each month the accountant posts cost of sales from the stock value.
-- NULL = bought food and drinks go straight to cost, as before.
ALTER TABLE gl_settings ADD COLUMN IF NOT EXISTS fnb_inventory_from DATE;
