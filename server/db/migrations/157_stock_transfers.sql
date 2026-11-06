-- 157: Moving stock between stores (STORES_PLAN.md step 2, owner 2026-11-06).
-- Main Store sends items to Housekeeping / Engineering (or any PMS store to
-- another). The items leave the sending store at once and wait "on the way"
-- until the receiving store confirms what arrived; anything short goes back to
-- the sending store. Kitchen / Resto (POS) come in step 3.
--
-- "On the way" is a hidden store of kind 'transit' (one per property), so a
-- transfer is only ever movements between stores: the item's total
-- (stock_quantity = the sum of its PMS stores) never changes, and goods on the
-- way still count in Stock value and Cost of sales.

ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_kind_check;
ALTER TABLE stores ADD CONSTRAINT stores_kind_check CHECK (kind IN ('main', 'pms', 'pos', 'transit'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_transit ON stores(property_id) WHERE kind = 'transit';

CREATE TABLE IF NOT EXISTS stock_transfers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  transfer_no     INT NOT NULL,                       -- shown TR-0001
  from_store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  to_store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  status          VARCHAR(12) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'confirmed', 'cancelled')),
  note            TEXT,
  sent_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  CHECK (from_store_id <> to_store_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfers_no ON stock_transfers(property_id, transfer_no);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_open ON stock_transfers(property_id) WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id      UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  raw_material_id  UUID REFERENCES raw_materials(id) ON DELETE RESTRICT,
  product_id       UUID REFERENCES products(id) ON DELETE RESTRICT,
  description      VARCHAR(255) NOT NULL,
  unit             VARCHAR(20),
  sent_qty         NUMERIC(12,3) NOT NULL CHECK (sent_qty > 0),
  unit_cost        NUMERIC(14,4),                     -- the item's average cost when sent
  accepted_qty     NUMERIC(12,3),                     -- NULL until confirmed
  note             TEXT,                              -- why less arrived
  CHECK (((product_id IS NOT NULL)::int + (raw_material_id IS NOT NULL)::int) = 1)
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer ON stock_transfer_lines(transfer_id);

-- Owners get the new free alert (who sent what, to confirm; and shortfalls).
UPDATE notification_recipients SET reports = array_append(reports, 'alert_store_transfer')
WHERE role IN ('owner', 'housekeeping') AND channel = 'telegram' AND NOT ('alert_store_transfer' = ANY(reports));
