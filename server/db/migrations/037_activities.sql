-- ============================================================
-- Migration 037 — Concierge / Activities (Phase D #11)
--
-- Adds a schedulable, capacity-limited, staff-confirmed booking concept —
-- distinct from products.category='tour' (flat instant-purchase POS item,
-- unchanged) and guest_board_cards.category='activity' (static "things to
-- do" info cards, unchanged). Guest self-bookings from the Room Display
-- always start at status='requested'; staff confirm before a folio charge
-- is posted, since capacity/guide/vehicle availability can't be verified
-- from a tablet the way a drink order can.
-- ============================================================

CREATE TABLE activities (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL,
  category           VARCHAR(20) NOT NULL DEFAULT 'tour' CHECK (category IN ('tour','transport','wellness','other')),
  description        TEXT,
  price              NUMERIC(12,2) NOT NULL DEFAULT 0,
  duration_minutes   INT,
  capacity_per_slot  INT,              -- NULL = unlimited
  image_url          VARCHAR(255),
  is_available       BOOLEAN NOT NULL DEFAULT true,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activities_property ON activities(property_id);

CREATE TABLE activity_bookings (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  activity_id        UUID NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  booking_id         UUID REFERENCES bookings(id) ON DELETE SET NULL,   -- nullable: walk-up/day-visitor bookings have no room stay
  guest_name         VARCHAR(200),    -- only used when booking_id is NULL
  guest_phone        VARCHAR(50),
  scheduled_date     DATE NOT NULL,
  scheduled_time     TIME,
  num_participants   INT NOT NULL DEFAULT 1,
  unit_price         NUMERIC(12,2) NOT NULL,  -- server-priced at booking time, never trusted from the tablet
  total_amount       NUMERIC(12,2) NOT NULL,
  payment_method     VARCHAR(20) CHECK (payment_method IN ('cash','qris','room_charge')),
  status             VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','completed','cancelled','no_show')),
  pickup_location    VARCHAR(255),
  notes              TEXT,
  booked_via         VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (booked_via IN ('staff','guest_self')),
  folio_charge_id    UUID REFERENCES folio_charges(id) ON DELETE SET NULL,  -- set once posted, so cancellation can void the right row
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activity_bookings_activity_date ON activity_bookings(activity_id, scheduled_date);
CREATE INDEX idx_activity_bookings_property ON activity_bookings(property_id);
CREATE INDEX idx_activity_bookings_booking ON activity_bookings(booking_id);

-- Seed the new module for every existing property (new properties get it
-- for free via seedPropertyDefaults.js's Object.keys(MODULES) loop).
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'activities', true FROM properties
ON CONFLICT (property_id, module) DO NOTHING;
