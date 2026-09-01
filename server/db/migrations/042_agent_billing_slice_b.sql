-- ============================================================
-- Migration 042 — Agent Accounts / Direct Billing (Phase D #13, Slice B)
--
-- Slice A (041) generalized booking_sources into an agent registry
-- (source_type / payment_status / credit_limit / commission_*) but changed
-- no behaviour. Slice B makes payment_status act at checkout:
--
--   * city_ledger / city_ledger_payment → checkout can close the folio as
--     billed-to-agent instead of collecting from the guest. Tracked by a
--     new bookings.folio_status = 'pending_agent_invoice'.
--   * commission / commission_and_city_ledger → the property owes the agent
--     a commission, posted once (at checkout) to the new agent_commissions
--     ledger — a flat "amount owed, unpaid/paid" table, not a journal entry.
--
-- Both columns/values are enforced in the API layer, not via CHECK
-- constraints — consistent with how booking_sources.payment_status and
-- bookings.source are already handled. All additive.
-- ============================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS folio_status VARCHAR(30);
-- null = normal (default, unaffected) | 'pending_agent_invoice' = billed to
-- an agent at checkout (Slice B) | 'invoiced' / 'paid' reserved for Slice C.

CREATE TABLE IF NOT EXISTS agent_commissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  source_id    VARCHAR(50) NOT NULL,  -- booking_sources.id; no FK — booking_sources
                                      -- lost its single-column PK in migration 020
                                      -- (unique only as (id, property_id)), same as
                                      -- bookings.source which also has no FK.
  amount       NUMERIC(12,2) NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid')),
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id)  -- one commission row per booking, computed once at checkout
);

CREATE INDEX IF NOT EXISTS idx_agent_commissions_source ON agent_commissions(property_id, source_id);
