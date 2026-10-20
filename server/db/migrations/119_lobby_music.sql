-- ============================================================
-- Migration 119 — music on the lobby TV
--
-- The owner uploads MP3s on the Guest Board page; the lobby TV (Room ID
-- "lobby", GET /api/display/lobby/state) plays them in a loop while its
-- slideshow runs, quieter / paused while a lobby video plays with sound.
-- Room TVs never play music. Files in server/uploads/board, served at
-- /board-images/ like the pictures and videos.
-- ============================================================

CREATE TABLE IF NOT EXISTS lobby_music_tracks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  size_bytes  BIGINT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lobby_music_property ON lobby_music_tracks (property_id, sort_order);

ALTER TABLE property_settings
  ADD COLUMN IF NOT EXISTS lobby_music_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lobby_music_volume SMALLINT NOT NULL DEFAULT 40
    CHECK (lobby_music_volume BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS lobby_music_shuffle BOOLEAN NOT NULL DEFAULT FALSE;
