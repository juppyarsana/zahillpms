-- ============================================================
-- Migration 116 — Guest Board: where a card shows + lobby videos
--
--   show_on      'rooms' (room TVs + room tablets), 'lobby' (the lobby TV,
--                GET /api/display/lobby/state) or 'both' — every existing
--                card is 'both', so nothing changes until a card is set.
--   video_url    an MP4 (H.264) played by the lobby TV; the card's picture
--                stays its cover (room TVs and tablets only ever show the
--                picture). Files in server/uploads/board, served at
--                /board-images/ like the pictures.
--   video_sound  play the video with sound on the lobby TV.
-- ============================================================

ALTER TABLE guest_board_cards
  ADD COLUMN IF NOT EXISTS show_on VARCHAR(8) NOT NULL DEFAULT 'both'
    CHECK (show_on IN ('rooms', 'lobby', 'both')),
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS video_sound BOOLEAN NOT NULL DEFAULT TRUE;
