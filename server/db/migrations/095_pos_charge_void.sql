-- 095: Voiding a POS room charge tells the POS.
-- When front desk voids the folio line of a restaurant bill (sales with
-- order_source 'external_pos'), the PMS tells the POS (POST /api/hotel/
-- room-charges/void, with the hotel key — migration 094), which reopens that
-- bill as unpaid so the restaurant settles it another way or cancels it.
--   pos_void_sent_at — the POS confirmed it (the line can't be restored then:
--                      charge it to the room again from the POS)
--   pos_void_error   — the last attempt failed (Tell the POS retries)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pos_void_sent_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pos_void_error TEXT;
