-- ============================================================
-- Migration 038 — Link Guest Board cards to bookable Activities
--
-- Guest Board (guest_board_cards, category='activity') and Concierge/
-- Activities (activities/activity_bookings, migration 037) were built as
-- two disconnected concepts — one promotional, one bookable — which meant
-- staff had to enter the same tour twice to both promote and sell it.
--
-- This links them: a board card can optionally point at a bookable
-- activities row. `activities` stays the sole owner of commerce fields
-- (price/duration/capacity) — see CLAUDE.md — the card only gains a
-- reference to it plus a convenience price passthrough at creation time.
-- ============================================================

ALTER TABLE guest_board_cards ADD COLUMN IF NOT EXISTS activity_id UUID REFERENCES activities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_guest_board_cards_activity ON guest_board_cards(activity_id);
