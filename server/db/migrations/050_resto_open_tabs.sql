-- ============================================================
-- Migration 050 — Resto Ordering: open tabs (order now, settle at table close)
--
-- Until now every sale needed a real payment_method at creation time. The QR
-- self-order flow shouldn't ask a guest to pick one — walk-ins pay when
-- they've finished eating, and that's handled by resto staff from the resto
-- app (who can also charge the whole table to a room).
--
-- Introduces 'unpaid' as the payment_method a sale carries between being
-- ordered and being settled. salesService.createSale treats it like
-- 'room_charge' — a sentinel, not a real payment_methods row — and skips
-- folio posting until settlement. Settlement (server/services/
-- restoSettleService.js) flips every unpaid, non-rejected sale in a table
-- session to one real method in a single transaction, stamping settled_at/
-- settled_by and posting folio charges when the method is room_charge.
--
-- No CHECK to re-add: migration 048 already dropped payment_method's
-- hardcoded constraint and widened the column; validation lives in
-- salesService.createSale.
-- ============================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS settled_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Settlement scans a session for still-open orders — this keeps that lookup
-- cheap and lets a "does this table owe anything?" check stay an index probe.
CREATE INDEX IF NOT EXISTS idx_sales_unpaid
  ON sales (property_id, table_session_id)
  WHERE payment_method = 'unpaid';
