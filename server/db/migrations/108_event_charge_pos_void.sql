-- 108: Voiding a restaurant bill on an event tells the POS (as migration 095
-- does for a room charge): the POS reopens that bill so it can be corrected
-- and charged to the event again.
--   pos_void_sent_at — the POS confirmed it reopened the bill
--   pos_void_error   — the last attempt to tell it failed (shown with a
--                      "Tell the POS" button on the event)
-- Additive only.
ALTER TABLE event_charges ADD COLUMN IF NOT EXISTS pos_void_sent_at TIMESTAMPTZ;
ALTER TABLE event_charges ADD COLUMN IF NOT EXISTS pos_void_error   TEXT;
