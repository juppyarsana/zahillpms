-- 106: Events — the meeting room (and any other function space) in the PMS.
-- An event is a booking of a venue for a date and time, with its own bill
-- (venue hire, other lines, restaurant bills the POS charges to it), its own
-- payments, the meals the restaurant must prepare, and an optional link to a
-- group booking for the bedrooms. Stage 1 of packages. Additive only.

-- ── 1. Module (default off, backfilled) ─────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'events', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Venues ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name        VARCHAR(120) NOT NULL,
  capacity    INT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_venues_name ON venues (property_id, lower(name));

-- ── 3. Events ───────────────────────────────────────────────────
-- status: enquiry (nothing held) / tentative (a hold — shown, warns, does not
-- block) / confirmed (blocks the venue for its time; counts as revenue) /
-- cancelled. The customer is an agent / company from the Agents list, or a
-- typed contact. bill_* are the rates and the way prices were entered when
-- the event was made: a later change of the property's rates does not
-- re-price an agreed event.
CREATE TABLE IF NOT EXISTS events (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id               UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_no                  INT NOT NULL,
  name                      VARCHAR(200) NOT NULL,
  agent_id                  UUID REFERENCES agents(id) ON DELETE SET NULL,
  company_name              VARCHAR(200),
  contact_name              VARCHAR(200),
  contact_phone             VARCHAR(50),
  contact_email             VARCHAR(200),
  venue_id                  UUID NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  event_date                DATE NOT NULL,
  end_date                  DATE NOT NULL,
  start_time                TIME NOT NULL,
  end_time                  TIME NOT NULL,
  pax                       INT NOT NULL DEFAULT 1 CHECK (pax >= 1),
  status                    VARCHAR(12) NOT NULL DEFAULT 'enquiry' CHECK (status IN ('enquiry', 'tentative', 'confirmed', 'cancelled')),
  hold_until                DATE,
  reservation_group_id      UUID REFERENCES reservation_groups(id) ON DELETE SET NULL,
  notes                     TEXT,
  internal_notes            TEXT,
  bill_tax_rate             NUMERIC(5,2) NOT NULL DEFAULT 0,
  bill_service_charge_rate  NUMERIC(5,2) NOT NULL DEFAULT 0,
  prices_include_tax        BOOLEAN NOT NULL DEFAULT false,
  cancel_reason             TEXT,
  cancelled_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at              TIMESTAMPTZ,
  created_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= event_date),
  CHECK (end_time > start_time),
  UNIQUE (property_id, event_no)
);
CREATE INDEX IF NOT EXISTS idx_events_dates ON events (property_id, event_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_group ON events (reservation_group_id) WHERE reservation_group_id IS NOT NULL;

-- ── 4. The event's bill lines ───────────────────────────────────
-- amount / unit_price are NET (before service & tax), like folio lines; the
-- bill adds service + tax at the event's rates. shown_total = the all-in
-- figure as typed (or as the POS sent it) when prices include tax.
-- type 'pos' = a restaurant bill the POS charged to the event (external_ref =
-- the POS bill, unique per property so a retry never posts twice).
CREATE TABLE IF NOT EXISTS event_charges (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type          VARCHAR(10) NOT NULL CHECK (type IN ('venue', 'other', 'pos')),
  description   VARCHAR(300) NOT NULL,
  service_date  DATE NOT NULL,
  quantity      NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price    NUMERIC(14,2) NOT NULL,
  amount        NUMERIC(14,2) NOT NULL,
  shown_total   NUMERIC(14,2),
  external_ref  VARCHAR(100),
  meal_id       UUID,
  is_voided     BOOLEAN NOT NULL DEFAULT false,
  void_reason   TEXT,
  voided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at     TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_charges_event ON event_charges (event_id);
CREATE INDEX IF NOT EXISTS idx_event_charges_date ON event_charges (property_id, service_date) WHERE is_voided = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_charges_ref ON event_charges (property_id, external_ref) WHERE external_ref IS NOT NULL;

-- ── 5. Meals the restaurant prepares for the event ──────────────
-- Read by the POS (GET /api/pos/events); it sets done / done_by when it has
-- rung the meal up.
CREATE TABLE IF NOT EXISTS event_meals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('coffee_break', 'lunch', 'dinner', 'welcome_drink', 'other')),
  service_date  DATE NOT NULL,
  service_time  TIME,
  pax           INT NOT NULL CHECK (pax >= 1),
  note          TEXT,
  status        VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  done_by       VARCHAR(100),
  done_at       TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_event_meals_event ON event_meals (event_id);
CREATE INDEX IF NOT EXISTS idx_event_meals_date ON event_meals (property_id, service_date);

-- ── 6. Money received for the event ─────────────────────────────
-- Same shape as group_payments (097 / 099): void, never delete; a refund is a
-- negative row on the refund day.
CREATE TABLE IF NOT EXISTS event_payments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  method        VARCHAR(50) NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at   TIMESTAMPTZ DEFAULT NOW(),
  reference     VARCHAR(120),
  notes         TEXT,
  is_refund     BOOLEAN NOT NULL DEFAULT false,
  is_voided     BOOLEAN NOT NULL DEFAULT false,
  void_reason   TEXT,
  voided_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_payments_event ON event_payments (event_id);
CREATE INDEX IF NOT EXISTS idx_event_payments_received ON event_payments (property_id, received_at) WHERE is_voided = false;

-- ── 7. History ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_log_event ON event_log (event_id, created_at);
