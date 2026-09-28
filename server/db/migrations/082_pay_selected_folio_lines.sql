-- 082: pay for selected folio lines (Folio tab → tick lines → Pay selected).
--
-- Front desk can let a guest pay only some of the charges on their folio —
-- e.g. an activity or laundry charged to the room, paid in cash now, while
-- the room is settled at checkout. One received 'incidental' payment covers
-- the ticked lines; each of those lines points at it, so the Folio tab and
-- invoices show them "Paid · Cash", they are never billed to an agent (same
-- as extras paid with Pay now, folioService.PAID_AT_DESK_SQL), and a receipt
-- lists exactly those lines. Room / meal nights are not selectable — room
-- payments stay on the deposit / balance lines (Payment Tracking).
-- Additive only.

ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS paid_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_folio_charges_paid_payment ON folio_charges(paid_payment_id) WHERE paid_payment_id IS NOT NULL;
