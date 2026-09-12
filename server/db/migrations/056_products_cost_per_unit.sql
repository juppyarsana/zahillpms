-- ============================================================
-- Migration 056 — Products cost tracking (Inventory Value, part 1)
--
-- raw_materials already got weighted-average cost tracking (migration 053 +
-- a later fix) — products never did, so a Purchase Order could restock a
-- sellable product (e.g. bulk-bought bottled water for resale) with no idea
-- what that stock actually cost, only what it sells for (products.price).
-- Closing that gap is what makes a combined Inventory Value view (raw
-- materials + products, both at cost) possible at all. Informational only,
-- updated on PO receipt only (mirrors raw_materials.cost_per_unit exactly)
-- — manual stock adjustments stay cost-agnostic on both tables, since a
-- manual restock/waste/adjustment has no known purchase price to blend in.
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC(12,2);
