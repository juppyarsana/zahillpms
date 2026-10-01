-- Room check / minibar (2026-10-01). At check-out front desk asks
-- housekeeping what was taken from the room's minibar, housekeeping answers,
-- front desk charges it. Until now by phone or radio, typed in by hand.
--
-- Housekeeping answers on the room's tablet (a discreet entry behind a PIN —
-- the guest may still be in the room) or, for a room without a tablet, from a
-- link in the Telegram message. They report; nothing reaches the guest's bill
-- until front desk presses "Add to bill" (one ordinary Sales sale charged to
-- the room). They can also send a check without being asked.
-- services/roomCheckService.js. Additive only.

-- Minibar items are Sales items in their own category.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check CHECK (category IN (
  'drinks', 'food',
  'room_addon', 'transport', 'laundry', 'service', 'merchandise', 'minibar', 'other'
));

-- The PIN housekeeping types on the room tablet (4–6 digits; NULL = the
-- housekeeping entry is off for this property).
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS housekeeping_pin VARCHAR(8);

CREATE TABLE IF NOT EXISTS room_checks (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id     UUID          NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id         UUID          NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  booking_id      UUID          REFERENCES bookings(id) ON DELETE SET NULL,
  -- requested: front desk asked, no answer yet · submitted: housekeeping
  -- answered · charged: on the guest's bill (or nothing to charge, accepted) ·
  -- dismissed: front desk set it aside
  status          VARCHAR(12)   NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'submitted', 'charged', 'dismissed')),
  requested_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  requested_at    TIMESTAMPTZ,
  -- the link in the Telegram message (rooms without a tablet); cleared once answered
  link_token      VARCHAR(64)   UNIQUE,
  -- [{ product_id, name, quantity, unit_price }] as housekeeping reported it
  items           JSONB         NOT NULL DEFAULT '[]',
  note            TEXT,
  submitted_at    TIMESTAMPTZ,
  submitted_via   VARCHAR(10)   CHECK (submitted_via IN ('tablet', 'link')),
  sale_id         UUID          REFERENCES sales(id) ON DELETE SET NULL,
  closed_by       UUID          REFERENCES users(id) ON DELETE SET NULL,
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_room_checks_booking ON room_checks(booking_id);
CREATE INDEX IF NOT EXISTS idx_room_checks_open ON room_checks(property_id, unit_id) WHERE status IN ('requested', 'submitted');
