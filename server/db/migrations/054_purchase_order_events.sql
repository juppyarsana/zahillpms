-- ============================================================
-- Migration 054 — Purchase Order activity log
--
-- Back Office Slice A shipped with no visible history on a PO — no way to
-- see when it was created, submitted, approved, or received. New
-- purchase_order_events: a simple append-only timeline (house style, same
-- shape as stock_movements' "note" field, just generalized to any
-- human-readable milestone instead of a stock change specifically), written
-- by server/services/purchasingService.js at each transition. Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_order_events (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  note               VARCHAR(255) NOT NULL,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_events_po ON purchase_order_events(purchase_order_id);
