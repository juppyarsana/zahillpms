-- 136: Stock gets its own page (owner, 2026-10-23) — Operations → Stock:
-- stock items + Sales items kept in stock together, Adjust, Stock opname,
-- Usage, Stock value. Purchasing keeps POs, Bought without a PO, Suppliers.
--
-- Adjust and stock opname both change the stock but stay apart in the
-- reports (owner agreed):
--   Adjust      — one item, a known event, any day: waste / spoiled, used
--                 (not sold, e.g. welcome drinks), correction (+ or −).
--   Stock opname — every item counted on one day; what is left after all
--                 purchases, sales and adjustments is the unexplained
--                 difference (movement reason 'opname'). Finished = fixed.
-- Usage between two opnames = opening + bought − closing, split into sold /
-- used / waste / corrections / opname difference.

-- New movement reasons on both ledgers: 'used' (Adjust) and 'opname'.
ALTER TABLE raw_material_movements DROP CONSTRAINT IF EXISTS raw_material_movements_reason_check;
ALTER TABLE raw_material_movements ADD CONSTRAINT raw_material_movements_reason_check
  CHECK (reason IN ('purchase', 'adjustment', 'waste', 'used', 'opname'));
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('sale', 'restock', 'adjustment', 'waste', 'used', 'opname'));

-- A stock item's cost category (the Expenses / Payables list), for the usage
-- report by category. NULL = Other.
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS category VARCHAR(30);

CREATE TABLE IF NOT EXISTS stock_opnames (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  opname_no     INT NOT NULL,                    -- shown SO-0001
  count_date    DATE NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finished', 'cancelled')),
  notes         TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  finished_at   TIMESTAMPTZ,
  cancelled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_opnames_no ON stock_opnames(property_id, opname_no);
-- One opname being counted at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_opnames_draft ON stock_opnames(property_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS stock_opname_lines (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opname_id        UUID NOT NULL REFERENCES stock_opnames(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES products(id) ON DELETE RESTRICT,
  raw_material_id  UUID REFERENCES raw_materials(id) ON DELETE RESTRICT,
  description      VARCHAR(255) NOT NULL,
  unit             VARCHAR(20),
  counted_qty      NUMERIC(12,3),                -- NULL = not counted (left as it is)
  expected_qty     NUMERIC(12,3),                -- set when finished: the stock just before
  unit_cost        NUMERIC(12,2),                -- average cost when finished
  CHECK (((product_id IS NOT NULL)::int + (raw_material_id IS NOT NULL)::int) = 1)
);
CREATE INDEX IF NOT EXISTS idx_stock_opname_lines_opname ON stock_opname_lines(opname_id);

-- Write-offs over this amount are sent on Telegram (NULL = the default).
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS stock_alerts JSONB;

-- Whoever could see stock in Purchasing & Stock keeps it on the new page.
UPDATE roles SET allowed_menus = allowed_menus || ARRAY['stock']
WHERE 'purchasing' = ANY(allowed_menus) AND NOT ('stock' = ANY(allowed_menus));

-- Owners on Telegram get the two stock alerts; owners on email the opname list.
UPDATE notification_recipients SET reports = array_append(reports, 'alert_stock_opname')
WHERE role = 'owner' AND channel IN ('telegram', 'email') AND NOT ('alert_stock_opname' = ANY(reports));
UPDATE notification_recipients SET reports = array_append(reports, 'alert_stock_writeoff')
WHERE role = 'owner' AND channel = 'telegram' AND NOT ('alert_stock_writeoff' = ANY(reports));
