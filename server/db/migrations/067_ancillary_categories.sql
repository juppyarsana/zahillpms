-- ============================================================
-- Migration 067 — Sales becomes the hotel's ancillary (extras) till
--
-- F&B is moving out of the PMS Sales page (handled by an external POS, or the
-- resto_ordering app where a property still uses it), so the PMS Sales page now
-- sells hotel extras: extra bed, airport transfer, laundry, merchandise, etc.
-- Scheduled experiences (tours, yoga, trekking) stay in the Activities module,
-- since those are booked from the room tablet with a date/time and capacity.
--
-- products.category gains hotel-extra categories. 'drinks'/'food' stay valid —
-- they are the F&B categories the resto app, Room Display's Dining tab and the
-- Kitchen Display still use, and old sales reference those products. The PMS
-- Sales page simply hides them. 'tour' is retired (tours are Activities now);
-- any existing 'tour' product is relabelled 'service' so nothing is lost.
--
-- Additive only — no product rows are deleted or disabled.
-- ============================================================

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;

UPDATE products SET category = 'service' WHERE category = 'tour';

ALTER TABLE products ADD CONSTRAINT products_category_check CHECK (category IN (
  -- F&B (resto app / Room Display Dining / Kitchen Display — hidden from PMS Sales)
  'drinks', 'food',
  -- Hotel extras (PMS Sales)
  'room_addon', 'transport', 'laundry', 'service', 'merchandise', 'other'
));


-- ── Directly-paid extras carry tax, like everything on the folio ──────────
-- Item prices are before tax (same as rooms). A sale paid directly at the
-- front desk (walk-in, or an in-house guest choosing "Pay now") is charged
-- price + service charge + tax at the property's rates. Stored on the sale
-- so a reprinted receipt shows what was actually charged even if the rates
-- change later. NULL = not taxed at sale time (room_charge sales — the folio
-- adds tax at checkout — and every sale made before this migration).
-- sales.total_amount stays the pre-tax item sum (Reports' ancillary revenue
-- is NET, like room revenue).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(12,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2);

-- When the paying guest is in-house, the sale is also posted to their folio
-- as a charge PLUS a received payment of the same gross amount, so the folio
-- is a complete record of the stay while its balance stays zero. That
-- payment gets its own type: deposit/balance are the ROOM's payments, and
-- several readers look for "the balance payment" to decide whether the room
-- is paid (routes/payments.js, bookings list) — an extras payment must never
-- be mistaken for it.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_type_check CHECK (type IN ('deposit', 'balance', 'incidental'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;
