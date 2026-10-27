-- 140: Vendor share — tours / transport run by an outside vendor the hotel pays
-- from the guest's money (jeep tracking, transfers…).
--
--   suppliers.provides_services   the supplier runs tours / transport (shown in
--                                 the activity's vendor list and on Vendor payouts)
--   activities.vendor_treatment   the vendor's part is taken off revenue (rebate,
--                                 the default) or booked as a cost
--   activities.charge_service     service charge on this activity (only false
--                                 with a tax-included price)
--   activities.tax_base           tax worked out on the full price, or only on the
--                                 hotel's part (price − vendor) — 'margin' only
--                                 with a tax-included price
--   activity_bookings.*           the same three, stamped when booked
--   activity_vendors              the vendors of an activity and their price:
--                                 per trip / per person / typed each time
--   activity_booking_vendors      what one booked trip owes each vendor (amount
--                                 NULL = still to be typed); owed once the trip is
--                                 confirmed / completed, or when cancelled /
--                                 no-show with owed_if_cancelled (a vendor fee)
--   vendor_payouts (+ allocations) money paid to a vendor (cash by accounting),
--                                 spread over trips, voided not deleted
-- Two accounts added to every chart: 4490 Activities — vendor share (a revenue
-- account with a debit balance: it lowers revenue) and 2155 Owed to tour &
-- transport vendors. Additive only.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS provides_services BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE activities ADD COLUMN IF NOT EXISTS vendor_treatment VARCHAR(10) NOT NULL DEFAULT 'rebate';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS charge_service BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS tax_base VARCHAR(10) NOT NULL DEFAULT 'full';
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_vendor_treatment_check;
ALTER TABLE activities ADD CONSTRAINT activities_vendor_treatment_check CHECK (vendor_treatment IN ('rebate', 'cost'));
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_tax_base_check;
ALTER TABLE activities ADD CONSTRAINT activities_tax_base_check CHECK (tax_base IN ('full', 'margin'));

ALTER TABLE activity_bookings ADD COLUMN IF NOT EXISTS vendor_treatment VARCHAR(10) NOT NULL DEFAULT 'rebate';
ALTER TABLE activity_bookings ADD COLUMN IF NOT EXISTS charge_service BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE activity_bookings ADD COLUMN IF NOT EXISTS tax_base VARCHAR(10) NOT NULL DEFAULT 'full';

CREATE TABLE IF NOT EXISTS activity_vendors (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  price_mode  VARCHAR(12) NOT NULL DEFAULT 'per_trip' CHECK (price_mode IN ('per_trip', 'per_person', 'typed')),
  price       NUMERIC(14,2),
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_vendors_activity ON activity_vendors(activity_id);

CREATE TABLE IF NOT EXISTS activity_booking_vendors (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  activity_booking_id UUID NOT NULL REFERENCES activity_bookings(id) ON DELETE CASCADE,
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount              NUMERIC(14,2) CHECK (amount IS NULL OR amount >= 0),
  owed_if_cancelled   BOOLEAN NOT NULL DEFAULT false,
  note                TEXT,
  edited_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  edited_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_abv_booking ON activity_booking_vendors(activity_booking_id);
CREATE INDEX IF NOT EXISTS idx_abv_property_supplier ON activity_booking_vendors(property_id, supplier_id);

CREATE TABLE IF NOT EXISTS vendor_payouts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  payout_no   INT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  paid_on     DATE NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method      VARCHAR(50) NOT NULL,
  reference   VARCHAR(100),
  notes       TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_voided   BOOLEAN NOT NULL DEFAULT false,
  voided_at   TIMESTAMPTZ,
  voided_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  UNIQUE (property_id, payout_no)
);
CREATE INDEX IF NOT EXISTS idx_vendor_payouts_property ON vendor_payouts(property_id, paid_on);

CREATE TABLE IF NOT EXISTS vendor_payout_allocations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payout_id         UUID NOT NULL REFERENCES vendor_payouts(id) ON DELETE CASCADE,
  booking_vendor_id UUID NOT NULL REFERENCES activity_booking_vendors(id) ON DELETE RESTRICT,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_vpa_line ON vendor_payout_allocations(booking_vendor_id);
CREATE INDEX IF NOT EXISTS idx_vpa_payout ON vendor_payout_allocations(payout_id);

INSERT INTO gl_accounts (property_id, code, name, type, pl_line)
SELECT p.property_id, v.code, v.name, v.type, v.pl_line
FROM (SELECT DISTINCT property_id FROM gl_accounts) p
CROSS JOIN (VALUES
  ('4490', 'Activities — vendor share', 'revenue', 'rev.other'),
  ('2155', 'Owed to tour & transport vendors', 'liability', NULL)
) AS v(code, name, type, pl_line)
ON CONFLICT (property_id, code) DO NOTHING;
