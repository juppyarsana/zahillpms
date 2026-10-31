-- Who in the restaurant a purchase request is for: the kitchen and the resto (bar)
-- ask for their own goods, sometimes the same item (mint for a dish and for a
-- drink). Only for splitting the order and the goods when they arrive: the stock
-- stays one figure per item. NULL = not said (a request from the PMS, or older).
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS section TEXT CHECK (section IN ('kitchen', 'resto'));
