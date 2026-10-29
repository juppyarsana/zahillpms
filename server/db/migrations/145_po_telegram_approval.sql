-- Approve purchase orders on Telegram.
--
-- When a PO is submitted for approval, every connected personal Telegram
-- recipient with the new alert `approve_purchase_order` ticked gets the PO
-- (supplier, every line, total) with ✅ Approve / ❌ Send back buttons. A press
-- counts only from the chat the message went to; the first press wins and the
-- buttons are taken off everyone's message (services/poApproval.js).
--
-- purchase_orders.approved_by stays the PMS user who approved; a Telegram
-- approval has no user, so the approver's name and the way are kept here.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by_name VARCHAR(255);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_via VARCHAR(10)
  CHECK (approved_via IN ('pms', 'telegram'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- One row per approver message sent for one submission (a PO sent back to
-- draft and submitted again gets new rows; the old ones are closed).
CREATE TABLE IF NOT EXISTS purchase_order_approval_messages (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  recipient_name     VARCHAR(255) NOT NULL,
  chat_id            VARCHAR(64) NOT NULL,
  message_id         BIGINT,             -- the message carrying the buttons
  is_open            BOOLEAN NOT NULL DEFAULT TRUE,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_approval_msgs_po ON purchase_order_approval_messages(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_approval_msgs_open ON purchase_order_approval_messages(property_id) WHERE is_open;

-- Owners' personal Telegram chats get the approval messages to start with.
UPDATE notification_recipients SET reports = array_append(reports, 'approve_purchase_order')
WHERE role = 'owner' AND channel = 'telegram' AND COALESCE(address, '') NOT LIKE '-%'
  AND NOT ('approve_purchase_order' = ANY(reports));
