-- Back Office → Expenses gains the category "OTA commission": the commission
-- an OTA bills the hotel for bookings the guest paid at the hotel (accounting,
-- 2026-10-22: treated as an expense). Goes to the same account as the
-- commission an OTA keeps back from a payout (5120 Rooms — OTA commission,
-- map key expense.ota_commission), so all OTA commission is one P&L line.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
  ('utilities', 'laundry', 'maintenance', 'staff', 'supplies', 'marketing', 'admin_fees', 'ota_commission', 'other'));
