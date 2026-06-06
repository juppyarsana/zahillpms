ALTER TABLE bookings
  ADD COLUMN discount_type    VARCHAR(10)    DEFAULT NULL CHECK (discount_type IN ('fixed', 'percentage')),
  ADD COLUMN discount_value   NUMERIC(12,2)  DEFAULT 0,
  ADD COLUMN discount_amount  NUMERIC(12,2)  DEFAULT 0;
