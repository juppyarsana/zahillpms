-- 077: items with the price typed at sale ("Other charge").
-- The folio's free-text "Add Charge" is gone: every charge to a guest now goes
-- through a Sales item, so Sales History and the reports count it. For odd
-- charges that aren't in the list (damage fee, broken glass, a one-off
-- favour) an item can be "price typed at sale": front desk types what it is
-- and the price each time, like a miscellaneous transaction code.
--
-- products.open_price — the item's price is only a suggestion; each sale line
--   carries its own price and description. Not for per-night or F&B items.
-- sale_items.description — what front desk typed for an open-price line
--   (NULL for normal lines, which show the item's name).
-- Seeds one "Other charge" item (price 0, open price) for every property that
-- has no open-price item yet. Additive only.

ALTER TABLE products ADD COLUMN IF NOT EXISTS open_price BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS description TEXT;

INSERT INTO products (name, category, price, description, property_id, open_price)
SELECT 'Other charge', 'other', 0, 'Anything not in the list — type what it is and the price.', p.id, true
  FROM properties p
 WHERE NOT EXISTS (SELECT 1 FROM products x WHERE x.property_id = p.id AND x.open_price);
