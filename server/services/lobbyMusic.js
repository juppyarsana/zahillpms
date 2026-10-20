// Lobby music (migration 119): the switch, volume and the songs the lobby TV
// plays. Used by the Guest Board page (routes/board.js) and the lobby feed
// (routes/display.js GET /lobby/state).
const db = require('../db');

async function musicState(propertyId) {
  const [{ rows: [ps] }, { rows: tracks }] = await Promise.all([
    db.query('SELECT lobby_music_enabled, lobby_music_volume, lobby_music_shuffle FROM property_settings WHERE property_id = $1', [propertyId]),
    db.query('SELECT id, title, file_url, size_bytes, sort_order, created_at FROM lobby_music_tracks WHERE property_id = $1 ORDER BY sort_order, created_at', [propertyId]),
  ]);
  return {
    enabled: !!ps?.lobby_music_enabled,
    volume: ps?.lobby_music_volume ?? 40,
    shuffle: !!ps?.lobby_music_shuffle,
    tracks,
  };
}

module.exports = { musicState };
