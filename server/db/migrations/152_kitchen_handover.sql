-- Kitchen handover (KITCHEN_HANDOVER_PLAN.md): restaurant goods received on a PO
-- wait in the POS until the chef says what really reached the kitchen. One row
-- per delivery sent to the POS; ref = '<PO line id>:<received so far>', the same
-- key the POS uses. accepted_qty NULL = still waiting. The supplier's bill is not
-- touched: what the kitchen didn't get is shown here as a shortfall.
CREATE TABLE IF NOT EXISTS pos_handovers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  po_item_id       UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  ref              TEXT NOT NULL UNIQUE,
  sent_qty         NUMERIC(10,3) NOT NULL,
  unit_cost        NUMERIC(14,4) NOT NULL DEFAULT 0,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_qty     NUMERIC(10,3),
  note             TEXT,
  confirmed_by     VARCHAR(120),
  confirmed_at     TIMESTAMPTZ,
  last_reminded_at TIMESTAMPTZ,
  reminders_sent   INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pos_handovers_item ON pos_handovers (po_item_id);
CREATE INDEX IF NOT EXISTS idx_pos_handovers_waiting ON pos_handovers (property_id, sent_at) WHERE confirmed_at IS NULL;

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS kitchen_handover_reminder_hours INT NOT NULL DEFAULT 3
  CHECK (kitchen_handover_reminder_hours BETWEEN 1 AND 24);

-- The new free alert for the roles it defaults to.
UPDATE notification_recipients SET reports = array_append(reports, 'alert_kitchen_handover')
WHERE role IN ('owner', 'manager') AND channel = 'telegram' AND NOT ('alert_kitchen_handover' = ANY(reports));
