-- ============================================================
-- Migration 084 — Agents & companies as their own list
--
-- Until now each travel agent / company / wholesaler was a booking SOURCE
-- (migration 041 generalized booking_sources into the agent registry). With
-- many agents that makes the Source list long, and every new agent meant a
-- trip to Settings. Other PMS (Opera, Mews, VHP) keep two things apart:
--   source / segment — a short, fixed list (Direct, Walk-in, each OTA,
--                      Travel Agent, Corporate, Wholesaler), for statistics
--   agent / company  — a long, growing list of real businesses attached to
--                      the reservation, carrying the billing terms
-- This migration adds the second list and moves agent billing onto it.
--
--   agents                 — one row per agent / company (billing terms live here)
--   bookings.agent_id      — the agent of a booking (optional)
--   bookings.commission_*  — this booking's own commission (NULL = the agent's default)
--   agent_commissions / agent_invoices / agent_payments .agent_id
--                          — AR now belongs to the agent; source_id kept for history
--
-- Existing data: every source that acted as an agent (type travel agent /
-- company / wholesaler, or with agent billing set) becomes an agent with the
-- same details, and its bookings, commissions, invoices and payments are
-- linked to it. Nothing is deleted and bookings keep their source — moving
-- them onto the generic Travel Agent / Corporate / Wholesaler source and
-- switching the old source off is a separate, reviewed step
-- (server/maintenance/splitAgentSources.js, dry run first).
-- Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name              VARCHAR(150) NOT NULL,
  agent_type        VARCHAR(20)  NOT NULL DEFAULT 'travel_agent'
                    CHECK (agent_type IN ('travel_agent', 'company', 'wholesaler', 'ota', 'other')),
  -- who pays and when — same values as booking_sources.payment_status (041):
  -- normal / city_ledger / city_ledger_payment / commission / commission_and_city_ledger
  payment_status    VARCHAR(30)  NOT NULL DEFAULT 'normal',
  contact_name      VARCHAR(120),
  contact_email     VARCHAR(160),
  contact_phone     VARCHAR(40),
  tax_id            VARCHAR(40),
  billing_address   TEXT,
  credit_terms_days INT,
  credit_limit      NUMERIC(14,2),
  commission_type   VARCHAR(10) CHECK (commission_type IN ('percent', 'amount')),
  commission_value  NUMERIC(14,2),
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  legacy_source_id  VARCHAR(50),   -- the booking source this agent was made from (084)
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_name ON agents (property_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_agents_property ON agents (property_id, is_active);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS agent_id         UUID REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_type  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS commission_value NUMERIC(14,2);
CREATE INDEX IF NOT EXISTS idx_bookings_agent ON bookings (property_id, agent_id) WHERE agent_id IS NOT NULL;

ALTER TABLE agent_commissions ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE agent_invoices    ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE agent_payments    ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE agent_commissions ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE agent_invoices    ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE agent_payments    ALTER COLUMN source_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_commissions_agent ON agent_commissions (property_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_invoices_agent    ON agent_invoices (property_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_payments_agent    ON agent_payments (property_id, agent_id);

-- ── Existing agent sources → agents ─────────────────────────────────────
INSERT INTO agents (property_id, name, agent_type, payment_status, contact_name, contact_email, contact_phone,
                    tax_id, billing_address, credit_terms_days, credit_limit, commission_type, commission_value,
                    is_active, legacy_source_id)
SELECT bs.property_id,
       -- two sources with the same label: keep them apart by their id
       CASE WHEN COUNT(*) OVER (PARTITION BY bs.property_id, lower(bs.label)) > 1
            THEN bs.label || ' (' || bs.id || ')' ELSE bs.label END,
       CASE WHEN bs.source_type IN ('travel_agent', 'company', 'wholesaler', 'ota') THEN bs.source_type ELSE 'other' END,
       COALESCE(bs.payment_status, 'normal'),
       bs.contact_name, bs.contact_email, bs.contact_phone, bs.tax_id, bs.billing_address,
       bs.credit_terms_days, bs.credit_limit,
       CASE WHEN bs.commission_type IN ('percent', 'amount') THEN bs.commission_type END,
       bs.commission_value, bs.is_active, bs.id
FROM booking_sources bs
WHERE bs.property_id IS NOT NULL
  AND (bs.source_type IN ('travel_agent', 'company', 'wholesaler') OR COALESCE(bs.payment_status, 'normal') <> 'normal')
  AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.property_id = bs.property_id AND a.legacy_source_id = bs.id);

UPDATE bookings b SET agent_id = a.id
FROM agents a
WHERE a.property_id = b.property_id AND a.legacy_source_id = b.source AND b.agent_id IS NULL;

UPDATE agent_commissions x SET agent_id = a.id
FROM agents a WHERE a.property_id = x.property_id AND a.legacy_source_id = x.source_id AND x.agent_id IS NULL;
UPDATE agent_invoices x SET agent_id = a.id
FROM agents a WHERE a.property_id = x.property_id AND a.legacy_source_id = x.source_id AND x.agent_id IS NULL;
UPDATE agent_payments x SET agent_id = a.id
FROM agents a WHERE a.property_id = x.property_id AND a.legacy_source_id = x.source_id AND x.agent_id IS NULL;

-- ── Generic sources for agent bookings ──────────────────────────────────
-- Templates for new properties (seedPropertyDefaults clones property_id IS
-- NULL rows) and one of each for every existing property. ON CONFLICT: a
-- property that already has a source with that id keeps its own.
INSERT INTO booking_sources (id, label, is_ota, color, is_active, sort_order, source_type, payment_status, property_id)
SELECT v.id, v.label, false, v.color, true, v.sort_order, v.source_type, 'normal', NULL
FROM (VALUES ('travel_agent', 'Travel Agent', '#0891b2', 5, 'travel_agent'),
             ('corporate',    'Corporate',    '#7c3aed', 6, 'company'),
             ('wholesaler',   'Wholesaler',   '#ca8a04', 7, 'wholesaler')) AS v(id, label, color, sort_order, source_type)
WHERE NOT EXISTS (SELECT 1 FROM booking_sources s WHERE s.id = v.id AND s.property_id IS NULL);

INSERT INTO booking_sources (id, label, is_ota, color, is_active, sort_order, source_type, payment_status, property_id)
SELECT t.id, t.label, false, t.color, true, t.sort_order, t.source_type, 'normal', p.id
FROM properties p
CROSS JOIN booking_sources t
WHERE t.property_id IS NULL AND t.id IN ('travel_agent', 'corporate', 'wholesaler')
ON CONFLICT DO NOTHING;
