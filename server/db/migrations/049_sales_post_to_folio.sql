-- ============================================================
-- Migration 049 — Post sales to the guest folio
--
-- folio_charges.type has allowed 'sale' since migration 028 ("Running
-- charge ledger per booking: room, F&B, sales, activities..."), but
-- salesService.createSale never actually wrote one — a room_charge sale
-- (staff POS "charge to room", Room Display's guest self-order, and now the
-- resto app) has always shown up in the sales list/reports but never on the
-- guest's own Folio tab, meaning it wasn't reliably collected at checkout.
--
-- sale_id lets the reject flow (server/routes/resto.js) find and void the
-- exact matching charge when a room-service order gets declined, instead of
-- guessing by booking_id + type + timestamp.
-- ============================================================

ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_folio_charges_sale ON folio_charges(sale_id);
