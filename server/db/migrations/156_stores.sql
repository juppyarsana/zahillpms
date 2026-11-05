-- 156: Stores (STORES_PLAN.md step 1, owner 2026-11-06).
-- Stock is kept per store: Main Store, Kitchen, Resto, Engineering,
-- Housekeeping. Everything bought goes into Main Store unless purchasing picks
-- another store. Kitchen and Resto are listed here but their stock lives in the
-- POS (kind 'pos'); Main Store and the other PMS stores (kind 'main' / 'pms')
-- hold their quantities in store_stock.
--
-- raw_materials.stock_quantity / products.stock_quantity stay the TOTAL over the
-- PMS stores. Every change of stock already writes a movement row with the same
-- change, so a trigger on the two ledgers keeps store_stock in step: a movement
-- with no store_id goes to Main Store (every older code path), and its change
-- is added to that store's quantity. The total therefore always equals the sum
-- of the stores, without changing the many places that read the total.

CREATE TABLE IF NOT EXISTS stores (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name         VARCHAR(60) NOT NULL,
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('main', 'pms', 'pos')),
  section      VARCHAR(10) CHECK (section IN ('kitchen', 'resto')),   -- POS stores only
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'pos') = (section IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_name ON stores(property_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_main ON stores(property_id) WHERE kind = 'main';
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_section ON stores(property_id, section) WHERE section IS NOT NULL;

-- The five stores of a property, made the first time they are needed; returns
-- Main Store. Used by the movement trigger, so a new property gets them by itself.
CREATE OR REPLACE FUNCTION ensure_main_store(p_property UUID) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM stores WHERE property_id = p_property AND kind = 'main';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO stores (property_id, name, kind, section, sort_order) VALUES
    (p_property, 'Main Store', 'main', NULL, 0),
    (p_property, 'Kitchen', 'pos', 'kitchen', 1),
    (p_property, 'Resto', 'pos', 'resto', 2),
    (p_property, 'Engineering', 'pms', NULL, 3),
    (p_property, 'Housekeeping', 'pms', NULL, 4)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_id FROM stores WHERE property_id = p_property AND kind = 'main';
  RETURN v_id;
END $$ LANGUAGE plpgsql;

SELECT ensure_main_store(id) FROM properties;

CREATE TABLE IF NOT EXISTS store_stock (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  raw_material_id  UUID REFERENCES raw_materials(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES products(id) ON DELETE CASCADE,
  quantity         NUMERIC(14,3) NOT NULL DEFAULT 0,
  CHECK (((product_id IS NOT NULL)::int + (raw_material_id IS NOT NULL)::int) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_stock_rm ON store_stock(store_id, raw_material_id) WHERE raw_material_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_stock_p ON store_stock(store_id, product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_store_stock_property ON store_stock(property_id);

ALTER TABLE raw_material_movements ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE purchase_order_receipt_lines ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

-- Everything until now happened in Main Store.
UPDATE raw_material_movements m SET store_id = s.id FROM stores s
 WHERE m.store_id IS NULL AND s.property_id = m.property_id AND s.kind = 'main';
UPDATE stock_movements m SET store_id = s.id FROM stores s
 WHERE m.store_id IS NULL AND s.property_id = m.property_id AND s.kind = 'main';
UPDATE stock_opnames o SET store_id = s.id FROM stores s
 WHERE o.store_id IS NULL AND s.property_id = o.property_id AND s.kind = 'main';

-- Today's stock is all in Main Store (from the totals, which are what every
-- screen shows — not rebuilt from movements, some items predate their ledger).
INSERT INTO store_stock (property_id, store_id, raw_material_id, quantity)
SELECT r.property_id, s.id, r.id, r.stock_quantity FROM raw_materials r
JOIN stores s ON s.property_id = r.property_id AND s.kind = 'main'
WHERE r.stock_quantity <> 0
ON CONFLICT DO NOTHING;
INSERT INTO store_stock (property_id, store_id, product_id, quantity)
SELECT p.property_id, s.id, p.id, p.stock_quantity FROM products p
JOIN stores s ON s.property_id = p.property_id AND s.kind = 'main'
WHERE p.stock_quantity <> 0
ON CONFLICT DO NOTHING;

-- One opname being counted per store (was per property).
DROP INDEX IF EXISTS uq_stock_opnames_draft;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_opnames_draft_store ON stock_opnames(store_id) WHERE status = 'draft';

-- Moving stock between stores (used from step 2) writes two movement rows.
ALTER TABLE raw_material_movements DROP CONSTRAINT IF EXISTS raw_material_movements_reason_check;
ALTER TABLE raw_material_movements ADD CONSTRAINT raw_material_movements_reason_check
  CHECK (reason IN ('purchase', 'adjustment', 'waste', 'used', 'opname', 'transfer'));
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('sale', 'restock', 'adjustment', 'waste', 'used', 'opname', 'transfer'));

-- The triggers that keep store_stock in step with the ledgers.
CREATE OR REPLACE FUNCTION stock_movement_store() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.store_id IS NULL THEN NEW.store_id := ensure_main_store(NEW.property_id); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rm_movement_to_store() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO store_stock (property_id, store_id, raw_material_id, quantity)
  VALUES (NEW.property_id, NEW.store_id, NEW.raw_material_id, NEW.change_qty)
  ON CONFLICT (store_id, raw_material_id) WHERE raw_material_id IS NOT NULL
  DO UPDATE SET quantity = store_stock.quantity + EXCLUDED.quantity;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION p_movement_to_store() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO store_stock (property_id, store_id, product_id, quantity)
  VALUES (NEW.property_id, NEW.store_id, NEW.product_id, NEW.change_qty)
  ON CONFLICT (store_id, product_id) WHERE product_id IS NOT NULL
  DO UPDATE SET quantity = store_stock.quantity + EXCLUDED.quantity;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rm_movement_store ON raw_material_movements;
CREATE TRIGGER rm_movement_store BEFORE INSERT ON raw_material_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_store();
DROP TRIGGER IF EXISTS rm_movement_store_qty ON raw_material_movements;
CREATE TRIGGER rm_movement_store_qty AFTER INSERT ON raw_material_movements FOR EACH ROW EXECUTE FUNCTION rm_movement_to_store();
DROP TRIGGER IF EXISTS p_movement_store ON stock_movements;
CREATE TRIGGER p_movement_store BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_store();
DROP TRIGGER IF EXISTS p_movement_store_qty ON stock_movements;
CREATE TRIGGER p_movement_store_qty AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION p_movement_to_store();
