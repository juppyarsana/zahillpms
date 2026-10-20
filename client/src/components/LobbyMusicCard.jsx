import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Lobby music (migration 119): MP3s the lobby TV plays in a loop while its
// slideshow runs. Room TVs never play music.
const MAX_MB = 20;

function fmtMB(bytes) { return bytes ? `${(bytes / 1048576).toFixed(1)} MB` : ''; }

export default function LobbyMusicCard() {
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(40);
  const [playing, setPlaying] = useState(null); // track id previewed here
  const fileRef = useRef(null);
  const audioRef = useRef(null);

  function apply(data) { setM(data); setVolume(data.volume); }

  useEffect(() => {
    api.get('/api/board/music').then(({ data }) => apply(data)).catch(() => setError('Could not load the lobby music.'));
    const a = audioRef;
    return () => a.current?.pause();
  }, []);

  async function save(body) {
    setError('');
    try { apply((await api.put('/api/board/music/settings', body)).data); }
    catch (err) { setError(err.response?.data?.error || 'Save failed'); }
  }

  async function upload(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const big = files.filter(f => f.size > MAX_MB * 1048576).map(f => f.name);
    if (big.length) { setError(`At most ${MAX_MB} MB per song: ${big.join(', ')}`); return; }
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    setBusy(true); setError(''); setProgress(0);
    try {
      const { data } = await api.post('/api/board/music', fd, {
        timeout: 0,
        onUploadProgress: (ev) => ev.total && setProgress(Math.round((ev.loaded / ev.total) * 100)),
      });
      apply(data);
    } catch (err) {
      setError(err.response?.status === 413
        ? 'The server refused a file this big — its upload limit needs raising (see the deploy notes).'
        : err.response?.data?.error || 'Upload failed');
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  async function remove(t) {
    if (!confirm(`Remove "${t.title}"?`)) return;
    if (playing === t.id) { audioRef.current?.pause(); setPlaying(null); }
    try { apply((await api.delete(`/api/board/music/${t.id}`)).data); }
    catch (err) { setError(err.response?.data?.error || 'Remove failed'); }
  }

  async function move(i, dir) {
    const ids = m.tracks.map(t => t.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { apply((await api.put('/api/board/music/order', { ids })).data); } catch { /* list stays as it was */ }
  }

  function preview(t) {
    const a = audioRef.current;
    if (!a) return;
    if (playing === t.id) { a.pause(); setPlaying(null); return; }
    a.src = t.file_url;
    a.volume = volume / 100;
    a.play().then(() => setPlaying(t.id)).catch(() => setPlaying(null));
  }

  function saveVolume() { if (m && volume !== m.volume) save({ volume }); }

  if (!m) return error ? <div className="card"><div className="alert alert-error">{error}</div></div> : null;

  return (
    <div className="card">
      <audio ref={audioRef} onEnded={() => setPlaying(null)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="card-title" style={{ margin: 0 }}>🎵 Lobby music</div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.tracks.length} song{m.tracks.length !== 1 ? 's' : ''}</span>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={m.enabled} onChange={e => save({ enabled: e.target.checked })} />
          Play on the lobby TV
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
        MP3 songs, played one after the other in a loop while the slideshow runs. A video with sound pauses the music.
        Room TVs never play music. Use royalty-free music, or songs the hotel holds a licence for (LMKN).
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flex: '1 1 240px' }}>
          Volume
          <input type="range" min="0" max="100" step="5" value={volume} style={{ flex: 1, minWidth: 0 }}
            onChange={e => { const v = Number(e.target.value); setVolume(v); if (audioRef.current) audioRef.current.volume = v / 100; }}
            onPointerUp={saveVolume} onKeyUp={saveVolume} onBlur={saveVolume} />
          <span style={{ width: 38, textAlign: 'right', fontWeight: 600 }}>{volume}%</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={m.shuffle} onChange={e => save({ shuffle: e.target.checked })} />
          Shuffle
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
        The music's level inside the TV. The TV's own volume (remote) still sets how loud the lobby hears it.
      </div>

      {m.tracks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {m.tracks.map((t, i) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--cream)', border: '1px solid var(--border)' }}>
              <button className="btn btn-sm btn-secondary" style={{ fontSize: 12, minWidth: 34 }} onClick={() => preview(t)} title="Listen here">
                {playing === t.id ? '❚❚' : '▶'}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtMB(t.size_bytes)}</div>
              </div>
              {!m.shuffle && (
                <>
                  <button className="btn btn-sm btn-secondary" style={{ fontSize: 11 }} disabled={i === 0} onClick={() => move(i, -1)} title="Play earlier">↑</button>
                  <button className="btn btn-sm btn-secondary" style={{ fontSize: 11 }} disabled={i === m.tracks.length - 1} onClick={() => move(i, 1)} title="Play later">↓</button>
                </>
              )}
              <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, color: '#dc2626' }} onClick={() => remove(t)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {m.enabled && m.tracks.length === 0 && (
        <div className="alert alert-warn" style={{ marginBottom: 12 }}>Music is on, but there are no songs yet — add some MP3s.</div>
      )}
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <input ref={fileRef} type="file" accept=".mp3,audio/mpeg" multiple style={{ display: 'none' }} onChange={upload} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? (progress != null && progress < 100 ? `Uploading… ${progress}%` : 'Saving…') : '+ Add songs (MP3)'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Up to {MAX_MB} MB each, 20 at a time</span>
      </div>
    </div>
  );
}
