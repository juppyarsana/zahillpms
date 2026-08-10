-- Kitchen Display System: track order type/table and kitchen prep status on sales.
-- kitchen_status stays NULL for orders with no food/drinks items (nothing to cook).
ALTER TABLE sales ADD COLUMN order_type VARCHAR(20) NOT NULL DEFAULT 'takeaway'
  CHECK (order_type IN ('dine_in','room_service','takeaway'));
ALTER TABLE sales ADD COLUMN table_number VARCHAR(20);
ALTER TABLE sales ADD COLUMN kitchen_status VARCHAR(20)
  CHECK (kitchen_status IN ('new','preparing','ready','served'));
