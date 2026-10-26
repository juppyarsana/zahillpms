-- ============================================================
-- Migration 139 — staff notes on a booking can be edited, and can carry
-- a reminder day
--
-- booking_notes.edited_at / edited_by  set when the note's text or reminder
--                                      day was changed (shown "edited"); the
--                                      old text goes to the booking's Edit
--                                      History. Deleting a note removes the
--                                      row and writes its text there too.
-- booking_notes.remind_on              optional day the note matters (e.g.
--                                      "transport on 29 Oct"): the note is
--                                      listed on that day's Dashboard and
--                                      Guest Lists. NULL = no reminder.
-- ============================================================

ALTER TABLE booking_notes ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE booking_notes ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE booking_notes ADD COLUMN IF NOT EXISTS remind_on DATE;
CREATE INDEX IF NOT EXISTS idx_booking_notes_remind_on ON booking_notes (remind_on) WHERE remind_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_notes_booking ON booking_notes (booking_id);
