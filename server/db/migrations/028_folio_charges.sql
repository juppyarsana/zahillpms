-- ============================================================
-- Migration 028 — Guest Folio (Phase A #1)
-- Running charge ledger per booking: room, F&B, sales, activities,
-- discounts, tax, service charge. Settled at checkout.
--
-- No property_id column — scoped via booking_id like payments and
-- sale_items already are (see the "Tables that do NOT need
-- property_id" note in migration 019).
-- ============================================================

CREATE TABLE IF NOT EXISTS folio_charges (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id   UUID         NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type         VARCHAR(30)  NOT NULL CHECK (type IN ('room','fnb','sale','activity','misc','discount','tax','service_charge')),
  description  VARCHAR(200) NOT NULL,
  quantity     NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,  -- quantity * unit_price
  is_voided    BOOLEAN      NOT NULL DEFAULT false,
  voided_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  voided_at    TIMESTAMPTZ,
  posted_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  posted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_folio_charges_booking ON folio_charges(booking_id);
