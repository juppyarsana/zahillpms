-- 167: Vouchers — a fixed stay (nights, room type, meal plan) sold at a set price,
-- redeemed once at New Booking within its rules. See VOUCHERS_PLAN.md.
--
-- Selling a voucher is NOT revenue: the hotel has the money and still owes a
-- stay (liability 250-00-005). Using it records a received payment of method
-- 'voucher' on the booking (a payment, not money — the cash was counted at the
-- sale); revenue comes from the normal night-by-night folio posting, with the
-- room and meal lines posted tax_mode 'none' (a voucher carries no service
-- charge or tax). Unused vouchers become breakage income at expiry.
-- Additive only.

-- ── 1. Module (default off, backfilled) ─────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'vouchers', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Payment method 'voucher' (the template row and every property) ──
-- Staff never pick it by hand: a redemption records it.
INSERT INTO payment_methods (id, label, is_active, sort_order, property_id)
SELECT 'voucher', 'Voucher', true, 91, NULL
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = 'voucher' AND property_id IS NULL);

INSERT INTO payment_methods (id, label, is_active, sort_order, property_id)
SELECT 'voucher', 'Voucher', true,
       COALESCE((SELECT MAX(sort_order) + 1 FROM payment_methods pm WHERE pm.property_id = p.id), 91), p.id
FROM properties p
WHERE NOT EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.id = 'voucher' AND pm.property_id = p.id);

-- ── 3. Voucher types (templates) ────────────────────────────────
CREATE TABLE IF NOT EXISTS voucher_templates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name             VARCHAR(160) NOT NULL,
  description      TEXT,
  nights           INT NOT NULL CHECK (nights BETWEEN 1 AND 60),
  room_type_id     UUID NOT NULL REFERENCES room_types(id),
  rate_plan_id     UUID REFERENCES rate_plans(id),
  max_guests       INT NOT NULL DEFAULT 2 CHECK (max_guests BETWEEN 1 AND 30),
  price            NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  -- How the price is read and charged. A voucher carries no service charge or
  -- tax for now (the accountant, 2026-11-11): only none / none / redemption is
  -- accepted by the server; the other options are for later.
  price_includes_tax BOOLEAN NOT NULL DEFAULT true,
  service_mode     VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (service_mode IN ('property', 'custom', 'none')),
  service_rate     NUMERIC(5,2),
  tax_mode         VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (tax_mode IN ('property', 'custom', 'none')),
  tax_rate         NUMERIC(5,2),
  tax_timing       VARCHAR(12) NOT NULL DEFAULT 'redemption' CHECK (tax_timing IN ('redemption', 'sale')),
  -- An optional extra fee charged on the sale (a card / QRIS fee): never part
  -- of the stay.
  fee_label        VARCHAR(60),
  fee_pct          NUMERIC(5,2),
  fee_payer        VARCHAR(10) CHECK (fee_payer IN ('guest', 'hotel')),
  validity_months  INT NOT NULL DEFAULT 12 CHECK (validity_months BETWEEN 1 AND 60),
  terms            TEXT,
  blackout         JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{ from, to, label }]
  allowed_weekdays INT[],                                   -- check-in days, 0 = Sunday; NULL = any
  min_notice_days  INT NOT NULL DEFAULT 0 CHECK (min_notice_days >= 0),
  no_show_consumes BOOLEAN NOT NULL DEFAULT true,
  transferable     BOOLEAN NOT NULL DEFAULT true,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_templates_property ON voucher_templates (property_id, sort_order);

-- ── 4. Vouchers sold ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vouchers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  voucher_no       INT NOT NULL,                              -- shown V-0001, running per property
  code             VARCHAR(12) NOT NULL UNIQUE,               -- what the guest quotes
  template_id      UUID REFERENCES voucher_templates(id) ON DELETE SET NULL,
  -- Everything the rules and the printed terms need, as sold (a later change of the type never touches it).
  snapshot         JSONB NOT NULL,
  price            NUMERIC(14,2) NOT NULL,                    -- what the stay is booked at
  covers_amount    NUMERIC(14,2) NOT NULL,                    -- what the voucher pays on the booking
  liability_amount NUMERIC(14,2) NOT NULL,                    -- held until used
  service_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,          -- the extra fee the guest paid on the sale
  sold_total       NUMERIC(14,2) NOT NULL,                    -- money received for the stay itself (without the fee)
  buyer_guest_id   UUID REFERENCES guests(id) ON DELETE SET NULL,
  buyer_name       VARCHAR(160),
  buyer_email      VARCHAR(160),
  buyer_phone      VARCHAR(40),
  recipient_name   VARCHAR(160),
  status           VARCHAR(10) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'reserved', 'redeemed', 'expired', 'voided')),
  sold_on          DATE NOT NULL,
  sold_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  payment_method   VARCHAR(50),
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reference        VARCHAR(120),
  expires_on       DATE NOT NULL,
  booking_id       UUID,                                      -- FK added below (bookings.voucher_id points back)
  reserved_at      TIMESTAMPTZ,
  redeemed_at      TIMESTAMPTZ,
  expired_on       DATE,
  void_reason      TEXT,
  voided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at        TIMESTAMPTZ,
  refunded_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_method    VARCHAR(50),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, voucher_no)
);
CREATE INDEX IF NOT EXISTS idx_vouchers_property_status ON vouchers (property_id, status);
CREATE INDEX IF NOT EXISTS idx_vouchers_expiry ON vouchers (property_id, expires_on) WHERE status = 'active';

-- ── 5. History of each voucher (append-only) ────────────────────
CREATE TABLE IF NOT EXISTS voucher_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id  UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  kind        VARCHAR(20) NOT NULL,   -- sold / reserved / released / redeemed / expired / voided / override / extended / sent
  note        TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_events_voucher ON voucher_events (voucher_id, created_at);

-- ── 6. Links from the booking and its payment ───────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL;
DO $$ BEGIN
  ALTER TABLE vouchers ADD CONSTRAINT vouchers_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_bookings_voucher ON bookings (voucher_id) WHERE voucher_id IS NOT NULL;

-- ── 7. Accounts ─────────────────────────────────────────────────
-- 250-00-005 Deferred Income (vouchers) exists in the standard chart but starts
-- off: switch it on. 470-60-004 Voucher breakage income is new. Added only to
-- charts that already exist; a chart converted later gets both from the
-- standard chart (standardChart.js) without a version bump.
UPDATE gl_accounts SET is_active = true WHERE code = '250-00-005';
INSERT INTO gl_accounts (property_id, code, name, type, pl_line, is_active)
SELECT DISTINCT g.property_id, '470-60-004', 'Voucher Breakage Income', 'revenue', 'rev.misc', true
FROM gl_accounts g
WHERE NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.property_id = g.property_id AND x.code = '470-60-004');
