-- ============================================================
-- Migration 058 — telegram_chats uniqueness
--
-- Caught live while testing: the same chat_id could be added twice for a
-- property (once via the Settings UI, once via a separate API call around
-- the same time) with nothing stopping it, causing a genuinely duplicated
-- alert — sendAlert correctly sends to every active row, it just had two
-- rows pointing at the same chat. Removing (DELETE /telegram-chats/:id) is
-- a real hard delete in this feature (not void-not-delete), so re-adding
-- the same chat_id after removal is fine — a plain unique constraint
-- (not a partial one scoped to is_active) is the right fix.
-- ============================================================

ALTER TABLE telegram_chats ADD CONSTRAINT uq_telegram_chats_property_chat UNIQUE (property_id, chat_id);
