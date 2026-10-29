-- 144: Purchase requests (owner, 2026-10-29) — a department asks for what it
-- needs, hotel purchasing orders it. See ROADMAP.md "Purchase requests".
--
-- Two ways in: hotel departments from the PMS (Operations → Purchase
-- requests), the restaurant from its own app (the POS, through /api/pos with
-- the POS key) because its stock lives there. One approval only: the PO's
-- existing "Approve purchase orders". Receiving stays on the PO in the PMS.
--
-- A request line names a PMS stock item, a Sales item kept in stock, a POS
-- inventory item (restaurant) or free text. A PO line now does the same:
-- a POS line received here is NOT added to PMS stock — the PMS sends the
-- quantity + cost to the POS as a purchase batch (pos_sent_qty says how much
-- of it the POS has); a free-text line is received but kept in no stock.

CREATE TABLE IF NOT EXISTS purchase_requests (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  request_no         INT NOT NULL,                          -- shown PR-0001
  department         VARCHAR(20) NOT NULL,                  -- costCategories DEPARTMENTS
  source             VARCHAR(10) NOT NULL DEFAULT 'pms' CHECK (source IN ('pms', 'pos')),
  needed_by          DATE,
  note               TEXT,
  status             VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined', 'cancelled')),
  requested_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_name  VARCHAR(120),                          -- the POS staff member's name (no PMS user)
  closed_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_by_name     VARCHAR(120),
  closed_at          TIMESTAMPTZ,
  close_reason       TEXT,                                  -- declined / cancelled / closed with lines left
  client_ref         VARCHAR(80),                           -- POS retry key
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_requests_no ON purchase_requests(property_id, request_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_requests_ref ON purchase_requests(property_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_requests_open ON purchase_requests(property_id, status);

CREATE TABLE IF NOT EXISTS purchase_request_lines (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id         UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  raw_material_id    UUID REFERENCES raw_materials(id) ON DELETE RESTRICT,
  product_id         UUID REFERENCES products(id) ON DELETE RESTRICT,
  pos_item_id        VARCHAR(64),                           -- POS inventory id
  description        VARCHAR(255) NOT NULL,
  unit               VARCHAR(20),
  quantity           NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  stock_when_asked   NUMERIC(12,3),
  note               TEXT,
  sort_order         INT NOT NULL DEFAULT 0,
  CHECK (((raw_material_id IS NOT NULL)::int + (product_id IS NOT NULL)::int + (pos_item_id IS NOT NULL)::int) <= 1)
);
CREATE INDEX IF NOT EXISTS idx_purchase_request_lines_request ON purchase_request_lines(request_id);

-- PO lines: a POS item or free text besides a product / stock item, and the request line they order.
-- The "exactly one of product / stock item" check (053) is found by its text, not by name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'purchase_order_items'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%product_id IS NOT NULL%raw_material_id IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE purchase_order_items DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS pos_item_id VARCHAR(64);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS request_line_id UUID REFERENCES purchase_request_lines(id) ON DELETE SET NULL;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS pos_sent_qty NUMERIC(10,3) NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS pos_send_error TEXT;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_one_target
  CHECK (((product_id IS NOT NULL)::int + (raw_material_id IS NOT NULL)::int + (pos_item_id IS NOT NULL)::int) <= 1);
CREATE INDEX IF NOT EXISTS idx_po_items_request_line ON purchase_order_items(request_line_id);

-- The department a PO is for (from its requests) — Make bill starts on it.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS department VARCHAR(20);

-- Who may ask: everyone who works with stock or buys.
UPDATE roles SET allowed_menus = allowed_menus || ARRAY['purchase_request']
WHERE ('stock' = ANY(allowed_menus) OR 'purchasing' = ANY(allowed_menus))
  AND NOT ('purchase_request' = ANY(allowed_menus));

-- Purchasing hears about new requests: owners on Telegram to start with.
UPDATE notification_recipients SET reports = array_append(reports, 'alert_purchase_request')
WHERE role = 'owner' AND channel = 'telegram' AND NOT ('alert_purchase_request' = ANY(reports));
