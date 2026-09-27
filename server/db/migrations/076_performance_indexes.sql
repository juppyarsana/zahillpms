-- 076: indexes for lookups the app does all the time but that had none, so
-- the database read the whole table each time (slower as data grows).
--   payments.booking_id      — every balance: Guest Lists, Balance Due, the
--                              Dashboard's overdue list, folio / pro forma
--   sale_items.sale_id       — Sales History, the revenue reports' sales split
--   booking_addons.sale_item_id — Sales History's extra-bed nights (074)
--   sales (property_id, created_at) — sales by day: reports, Daily Close, Sales History
-- Additive only; no data changes.

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_booking_addons_sale_item ON booking_addons (sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sales_property_created ON sales (property_id, created_at);
