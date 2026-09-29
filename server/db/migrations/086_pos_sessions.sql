-- 086: Restaurant sessions sent by the POS (Breakfast / Lunch / Dinner).
-- One row per property + business day + session; the POS sends it from its
-- Transactions page and sending again replaces it (upsert on the unique key).
-- outlet_net (bills paid at the restaurant, NET — before service & tax) counts
-- as F&B revenue on business_date in the reports. Room charges are NOT in it:
-- each one already posted to the guest's folio (sales, order_source
-- 'external_pos'). Package breakfasts are never POS sales — only the head
-- count (summary.breakfast) comes through. Additive only.
CREATE TABLE IF NOT EXISTS pos_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  business_date   DATE NOT NULL,
  session_key     VARCHAR(20) NOT NULL CHECK (session_key IN ('breakfast', 'lunch', 'dinner')),
  label           VARCHAR(30),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  bills           INTEGER NOT NULL DEFAULT 0,
  outlet_bills    INTEGER NOT NULL DEFAULT 0,
  outlet_net      NUMERIC(14,2) NOT NULL DEFAULT 0,
  outlet_service  NUMERIC(14,2) NOT NULL DEFAULT 0,
  outlet_tax      NUMERIC(14,2) NOT NULL DEFAULT 0,
  outlet_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  room_charge_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  breakfast_pax_expected INTEGER,
  breakfast_pax_came     INTEGER,
  summary         JSONB NOT NULL,
  sent_by         VARCHAR(100),
  first_sent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  send_count      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (property_id, business_date, session_key)
);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_date ON pos_sessions (property_id, business_date);
