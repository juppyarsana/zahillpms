-- ============================================================
-- Migration 053 — Back Office, Slice A (Suppliers + Purchasing + PO receiving)
--
-- First slice of the "Back Office" module scoped in ROADMAP.md 2026-08-17
-- (Purchasing, Inventory Cost Control, AP, Cash & Bank, Recipe Costing) but
-- never started until now. New `back_office` module, default OFF — paid
-- add-on tier, same philosophy as `resto_ordering`.
--
--   1. suppliers — a property's vendor directory.
--   2. raw_materials + raw_material_movements — kitchen/consumable
--      ingredients (flour, rice, chicken breast) that are purchased and
--      consumed but never sold directly. Deliberately a SEPARATE table from
--      the sellable `products` catalog, not a repurposed products row —
--      reusing products would risk a raw ingredient leaking into a guest
--      menu / staff POS grid / Kitchen Display if a filter were ever missed
--      anywhere those already query products, and would mix ingredient-cost
--      reporting into the general Sales/Reports domain. Fractional
--      quantities (NUMERIC, not INT) since ingredients are bought/consumed
--      in kg/g/l/ml, unlike whole-unit sellable products.
--   3. purchase_orders + purchase_order_items — a PO's line items each
--      restock EITHER an existing sellable product OR a raw_material
--      (never both), so one PO can mix "restock bottled water for resale"
--      with "buy rice for the kitchen". Simple status workflow: draft →
--      pending_approval → approved → received, or cancelled from any
--      pre-received status. received_quantity supports partial receiving.
--   4. stock_movements gains a nullable purchase_order_id FK so a sellable
--      product's PO receipt is traceable back to the PO — its existing
--      reason CHECK ('sale'/'restock'/'adjustment'/'waste') is untouched,
--      PO receipt just uses the existing 'restock' reason.
-- ============================================================

-- ── 1. Module row, default OFF ───────────────────────────────
INSERT INTO property_modules (property_id, module, is_enabled)
SELECT id, 'back_office', false FROM properties
ON CONFLICT (property_id, module) DO NOTHING;

-- ── 2. Suppliers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL,
  contact_name       VARCHAR(200),
  contact_phone      VARCHAR(50),
  contact_email      VARCHAR(200),
  address            TEXT,
  payment_terms_days INT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_property ON suppliers(property_id);

-- ── 3. Raw materials (kitchen/consumable ingredients) ───────────
CREATE TABLE IF NOT EXISTS raw_materials (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name                VARCHAR(200) NOT NULL,
  unit_of_measure     VARCHAR(20) NOT NULL DEFAULT 'pcs', -- kg/g/l/ml/pcs — display only, no unit conversion in v1
  stock_quantity      NUMERIC(10,3) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(10,3),
  cost_per_unit       NUMERIC(12,2), -- informational — last known purchase cost, updated on receipt
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_raw_materials_property ON raw_materials(property_id);

-- purchase_orders is created below raw_materials but referenced by
-- raw_material_movements — declare the header table first, then the ledger.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  supplier_id    UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  po_number      VARCHAR(20) NOT NULL, -- 'PO-YYMM-NNN', generated server-side
  status         VARCHAR(20) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','pending_approval','approved','received','cancelled')),
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0, -- denormalized, recomputed whenever items change
  notes          TEXT,
  requested_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_property ON purchase_orders(property_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
-- po_number only needs to be unique per property, not globally
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_number ON purchase_orders(property_id, po_number);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id         UUID REFERENCES products(id) ON DELETE RESTRICT,
  raw_material_id    UUID REFERENCES raw_materials(id) ON DELETE RESTRICT,
  description        VARCHAR(255) NOT NULL, -- name snapshot at order time (house convention, cf. sales.table_number)
  quantity           NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_quantity  NUMERIC(10,3) NOT NULL DEFAULT 0,
  CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  CHECK (((product_id IS NOT NULL)::int + (raw_material_id IS NOT NULL)::int) = 1)
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product ON purchase_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_po_items_raw_material ON purchase_order_items(raw_material_id);

-- Raw material stock ledger — mirrors stock_movements' shape/house style,
-- kept as its own table so ingredient stock history never mixes with
-- sellable-product stock history.
CREATE TABLE IF NOT EXISTS raw_material_movements (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  raw_material_id    UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  change_qty         NUMERIC(10,3) NOT NULL,
  reason             VARCHAR(20) NOT NULL CHECK (reason IN ('purchase', 'adjustment', 'waste')),
  purchase_order_id  UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  reference_id       UUID,
  note               TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_raw_material_movements_material ON raw_material_movements(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_raw_material_movements_property ON raw_material_movements(property_id);

-- ── 4. Trace a sellable product's PO receipt back to its PO ─────
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;
