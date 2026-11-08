-- Restaurant goods through Main Store (STORES_PLAN.md step 3).
--
-- A POS inventory item received into a PMS store (Main Store, usually) is kept
-- there as a PMS stock item that stands for the POS item — its "mirror"
-- (raw_materials.pos_item_id), made the first time it is needed. From there it
-- is moved to Kitchen / Resto with an ordinary transfer, which reaches the POS
-- as a delivery the chef / bar confirms in Inventory → Incoming (the kitchen
-- handover), so pos_handovers now carries either a PO line or a transfer line.

ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS pos_item_id VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_materials_pos_item ON raw_materials (property_id, pos_item_id) WHERE pos_item_id IS NOT NULL;

-- What of a POS line was received into a PMS store instead of being sent to the POS.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS stored_qty NUMERIC(10,3) NOT NULL DEFAULT 0;

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS pos_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pos_send_error TEXT;
-- Who confirmed in the POS (no PMS user).
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS confirmed_by_name VARCHAR(120);

ALTER TABLE pos_handovers ALTER COLUMN po_item_id DROP NOT NULL;
ALTER TABLE pos_handovers ADD COLUMN IF NOT EXISTS transfer_line_id UUID REFERENCES stock_transfer_lines(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_handovers_one_source') THEN
    ALTER TABLE pos_handovers ADD CONSTRAINT pos_handovers_one_source
      CHECK ((po_item_id IS NOT NULL) <> (transfer_line_id IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pos_handovers_transfer_line ON pos_handovers (transfer_line_id) WHERE transfer_line_id IS NOT NULL;
