-- ============================================================
-- Migration 043 — Agent Accounts / Direct Billing (Phase D #13, Slice C)
--
-- Slice B (042) made a city-ledger booking close its folio as
-- 'pending_agent_invoice' and posted commissions to agent_commissions.
-- Slice C closes the loop: a per-agent statement, AR aging, recording what
-- the agent pays (auto-allocated oldest-first, editable), and a consolidated
-- invoice PDF across an agent's open bookings.
--
-- AR balance stays a derived sum over folios (no journal entries) — these
-- tables just record the agent-side money movements.
--   * agent_invoices          — a consolidated invoice header; its bookings
--                               carry bookings.agent_invoice_id + move to
--                               folio_status = 'invoiced'
--   * agent_payments          — a lump sum received from an agent
--   * agent_payment_allocations — how that lump is split across bookings;
--                               a fully-covered booking moves to
--                               folio_status = 'paid'
--
-- bookings.folio_status now also takes 'invoiced' and 'paid' (the values
-- migration 042 reserved) — still API-enforced, no CHECK constraint.
-- source_id columns hold booking_sources.id with no FK, same as
-- agent_commissions / bookings.source (booking_sources lost its single-column
-- PK in migration 020).
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_invoices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_id      VARCHAR(50) NOT NULL,
  invoice_number VARCHAR(30) NOT NULL,
  issued_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  period_start   DATE,
  period_end     DATE,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes          TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS agent_payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_id    VARCHAR(50) NOT NULL,
  amount       NUMERIC(14,2) NOT NULL,
  method       VARCHAR(20),
  received_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  reference    VARCHAR(120),
  notes        TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_payment_allocations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_payment_id UUID NOT NULL REFERENCES agent_payments(id) ON DELETE CASCADE,
  booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount           NUMERIC(14,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_payment_id, booking_id)
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS agent_invoice_id UUID REFERENCES agent_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_payments_source ON agent_payments(property_id, source_id);
CREATE INDEX IF NOT EXISTS idx_agent_invoices_source ON agent_invoices(property_id, source_id);
CREATE INDEX IF NOT EXISTS idx_agent_alloc_booking   ON agent_payment_allocations(booking_id);
