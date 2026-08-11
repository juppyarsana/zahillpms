-- ============================================================
-- Migration 036 — Stock Tracking (Phase D #10, third slice)
--
-- Reverses the earlier "no inventory management" decision (PLANNING.md)
-- now that a real client needs it. track_stock is opt-in per product —
-- properties/products that don't care about stock (most services, tours)
-- leave it off and behave exactly as before. stock_movements is an audit
-- ledger (house style — same shape as folio_charges) recording every
-- change: sales decrement automatically, restock/adjustment/waste are
-- manual via the new stock-adjust endpoint.
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INT;

CREATE TABLE IF NOT EXISTS stock_movements (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_qty   INT NOT NULL,
  reason       VARCHAR(20) NOT NULL CHECK (reason IN ('sale', 'restock', 'adjustment', 'waste')),
  reference_id UUID,
  note         TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_property ON stock_movements(property_id);
