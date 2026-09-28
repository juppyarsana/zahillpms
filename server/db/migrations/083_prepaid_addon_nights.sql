-- 083: pay an extra-bed night (or any per-night extra) before it's posted.
--
-- Record Payment (redesigned) lists everything the guest owes: the room's
-- deposit / balance lines and the extras — including per-night extras whose
-- nights are still to come (booking_addons not posted to the folio yet, e.g.
-- an extra bed booked with the reservation and prepaid with the deposit).
-- A prepaid night points at the payment that covered it; when the night is
-- posted (night audit / checkout), its folio line carries the same
-- paid_payment_id (migration 082), so it reads "Paid · …" and is never billed
-- to an agent. Additive only.

ALTER TABLE booking_addons ADD COLUMN IF NOT EXISTS paid_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;
