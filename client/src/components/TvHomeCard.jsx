import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Room TV Home (migrations 142–143): what the room TV's own Home screen shows besides the
// guest's stay — Wi-Fi, breakfast, check-out time, the Watch row apps — and its background
// photo. Three cards on Guest Board → Room TVs, one settings object (GET/PUT /api/board/tv).
const SLOT_LABEL = { morning: 'Morning', day: 'Day', night: 'Night' };
const FIELDS = ['wifi_ssid', 'wifi_password', 'breakfast_hours', 'breakfast_outlet', 'checkout_time'];

// Apps known by name; any other app can be added by its Android package name.
const KNOWN_APPS = [
  { pkg: 'com.netflix.ninja', label: 'Netflix' },
  { pkg: 'com.google.android.youtube.tv', label: 'YouTube' },
  { pkg: 'com.google.android.youtube.tvkids', label: 'YouTube Kids' },
  { pkg: 'com.amazon.amazonvideo.livingroom', label: 'Prime Video' },
  { pkg: 'in.startv.hotstar', label: 'Disney+ Hotstar' },
  { pkg: 'com.vidio.android.tv', label: 'Vidio' },
  { pkg: 'com.spotify.tv.android', label: 'Spotify' },
  { pkg: 'com.apple.atve.androidtv.appletv', label: 'Apple TV' },
  { pkg: 'com.vuclip.viu', label: 'Viu' },
];
// The TV app's own list (tv-launcher config.xml), used while nothing is chosen here.
const BUILT_IN = ['com.netflix.ninja', 'com.google.android.youtube.tv', 'com.amazon.amazonvideo.livingroom',
  'in.startv.hotstar', 'com.vidio.android.tv', 'com.spotify.tv.android'];
const MAX_APPS = 6;
const appLabel = pkg => KNOWN_APPS.find(a => a.pkg === pkg)?.label || pkg;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export default function TvHomeCard() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/board/tv').then(({ data }) => setS(data)).catch(() => setError('Could not load the TV settings.'));
  }, []);

  if (!s) return error ? <div className="card"><div className="alert alert-error">{error}</div></div> : null;
  return (
    <>
      <GuestDetails s={s} onSaved={setS} />
      <WatchApps s={s} onSaved={setS} />
      <Backgrounds s={s} onSaved={setS} />
    </>
  );
}

async function putTv(body) {
  return (await api.put('/api/board/tv', body)).data;
}

function SaveRow({ busy, saved, error, onSave, label = 'Save' }) {
  return (
    <>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : label}</button>
        {saved && <span style={{ fontSize: 12, color: 'var(--green-dark)' }}>Saved — the TVs pick it up within a minute.</span>}
      </div>
    </>
  );
}

// ─── Wi-Fi, check-out, breakfast ───────────────────────────────────────────

function GuestDetails({ s, onSaved }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(f => [f, s[f] || ''])));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try { onSaved(await putTv(form)); setSaved(true); }
    catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  }

  const field = (key, label, placeholder, extra = {}) => (
    <div className="form-group" style={{ flex: '1 1 200px', minWidth: 0 }}>
      <label className="form-label">{label}</label>
      <input className="form-input" value={form[key] || ''} placeholder={placeholder} {...extra}
        onChange={e => { setSaved(false); setForm(f => ({ ...f, [key]: e.target.value })); }} />
    </div>
  );

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 6 }}>Details for guests</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Shown on the Home screen under the guest's name, and on the TV's Hotel Guide. An empty field is left off.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {field('wifi_ssid', 'Guest Wi-Fi name', 'Zahill-Guest')}
        {field('wifi_password', 'Wi-Fi password', 'Leave empty if there is none')}
        {field('checkout_time', 'Check-out time', '12:00', { maxLength: 5, style: { maxWidth: 120 } })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {field('breakfast_hours', 'Breakfast hours', '07:00 – 10:30')}
        {field('breakfast_outlet', 'Breakfast served at', 'Restaurant name')}
      </div>
      <SaveRow busy={busy} saved={saved} error={error} onSave={save} />
    </div>
  );
}

// ─── Watch row apps ──────────────────────────────────────────────────────────

function WatchApps({ s, onSaved }) {
  const [apps, setApps] = useState(s.watch_apps || []);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const own = apps.length > 0;
  const shown = own ? apps : BUILT_IN;
  const changed = JSON.stringify(apps) !== JSON.stringify(s.watch_apps || []);
  const full = apps.length >= MAX_APPS;

  function edit(next) { setSaved(false); setError(''); setApps(next); }
  function add(pkg) {
    pkg = pkg.trim();
    if (!pkg) return;
    if (!PACKAGE.test(pkg)) { setError(`"${pkg}" is not an Android package name, like com.netflix.ninja`); return; }
    if (apps.includes(pkg)) return;
    edit([...apps, pkg]);
    setCustom('');
  }
  const move = (i, d) => { const n = [...apps]; [n[i], n[i + d]] = [n[i + d], n[i]]; edit(n); };

  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try { const data = await putTv({ watch_apps: apps }); onSaved(data); setApps(data.watch_apps || []); setSaved(true); }
    catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  }

  const available = KNOWN_APPS.filter(a => !apps.includes(a.pkg));

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 6 }}>Watch row apps</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
        The streaming apps on the Home screen, left to right (at most {MAX_APPS}; <b>Cast from phone</b> always comes last).
        A TV that doesn't have an app installed leaves it out — install apps from the Google Play Store on the TV.
      </div>

      {!own && (
        <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 13 }}>
          <div>
            Nothing chosen yet — the TVs use their own list: {BUILT_IN.map(appLabel).join(', ')}.{' '}
            <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 6 }} onClick={() => edit(BUILT_IN)}>Start from this list</button>
          </div>
        </div>
      )}

      {own && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {shown.map((pkg, i) => (
            <div key={pkg} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8,
              background: 'var(--cream)', border: '1px solid var(--border)' }}>
              <span style={{ width: 22, fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{appLabel(pkg)}</div>
                {appLabel(pkg) !== pkg && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pkg}</div>}
              </div>
              <button type="button" className="btn btn-sm btn-secondary" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-sm btn-secondary" aria-label="Move down" disabled={i === shown.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn-sm btn-secondary" aria-label={`Remove ${appLabel(pkg)}`} style={{ color: '#DC2626' }}
                onClick={() => edit(apps.filter(p => p !== pkg))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {own && !full && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {available.map(a => (
            <button key={a.pkg} type="button" className="btn btn-sm btn-secondary" onClick={() => add(a.pkg)}>+ {a.label}</button>
          ))}
          <div style={{ display: 'flex', gap: 6, flex: '1 1 260px' }}>
            <input className="form-input" style={{ padding: '6px 10px', fontSize: 13 }} value={custom}
              placeholder="Other app — package name, e.g. com.example.tv"
              onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(custom); }} />
            <button type="button" className="btn btn-sm btn-secondary" disabled={!custom.trim()} onClick={() => add(custom)}>Add</button>
          </div>
        </div>
      )}
      {own && full && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>The row is full — remove an app to add another.</div>}

      {(own || changed) && (
        <SaveRow busy={busy} saved={saved} error={error} onSave={save} label={own ? 'Save' : 'Save — use the TVs\' own list'} />
      )}
      {!own && !changed && error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}

// ─── Background photo ───────────────────────────────────────────────────────

function Backgrounds({ s, onSaved }) {
  const [starts, setStarts] = useState(() => Object.fromEntries(s.backgrounds.map(b => [b.slot, b.start])));
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const fileRefs = { morning: useRef(null), day: useRef(null), night: useRef(null) };

  async function run(key, fn) {
    setBusy(key); setError(''); setSaved(false);
    try { onSaved(await fn()); return true; }
    catch (err) { setError(err.response?.data?.error || 'Save failed'); return false; }
    finally { setBusy(''); }
  }

  async function upload(slot, e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1048576) { setError('A photo can be at most 10 MB.'); return; }
    const fd = new FormData();
    fd.append('image', file);
    run(slot, async () => (await api.post(`/api/board/tv/background/${slot}`, fd, { timeout: 0 })).data);
  }

  function removePhoto(slot) {
    if (!confirm(`Remove the ${SLOT_LABEL[slot].toLowerCase()} photo?`)) return;
    run(slot, async () => (await api.delete(`/api/board/tv/background/${slot}`)).data);
  }

  const photos = s.backgrounds.filter(b => b.image_url).length;
  const timesChanged = s.backgrounds.some(b => b.start !== starts[b.slot]);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="card-title" style={{ margin: 0 }}>Home background photo</div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={s.use_board} disabled={!!busy} onChange={e => run('board', () => putTv({ use_board: e.target.checked }))} />
          Rotate the Guest Board's pictures
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {s.use_board
          ? 'The pictures of the Guest Board cards rotate behind the Home screen. The photos here are used only when no card has a picture.'
          : 'The photo for the time of day is shown — each from its start time until the next one starts.'}
        {' '}One photo = all day. No photo = the TV's own sunrise picture. A wide landscape photo (16:9) works best.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
        {s.backgrounds.map(b => (
          <div key={b.slot} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--cream)' }}>
            <div style={{ aspectRatio: '16 / 9', background: b.image_url ? `#000 center / cover no-repeat url(${b.image_url})` : 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              {!b.image_url && 'No photo'}
            </div>
            <div style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{SLOT_LABEL[b.slot]}</div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                from
                <input type="time" className="form-input" style={{ padding: '4px 6px', width: 130 }} value={starts[b.slot] || ''}
                  onChange={e => { setSaved(false); setStarts(st => ({ ...st, [b.slot]: e.target.value })); }} />
              </label>
              <input ref={fileRefs[b.slot]} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => upload(b.slot, e)} />
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                <button className="btn btn-sm btn-secondary" style={{ fontSize: 11 }} disabled={!!busy} onClick={() => fileRefs[b.slot].current?.click()}>
                  {busy === b.slot ? 'Saving…' : b.image_url ? 'Replace' : 'Add photo'}
                </button>
                {b.image_url && (
                  <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, color: '#dc2626' }} disabled={!!busy} onClick={() => removePhoto(b.slot)}>Remove</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {photos === 1 && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Only one photo — it is used all day.</div>}

      {(timesChanged || saved || error) ? (
        <SaveRow busy={busy === 'times'} saved={saved} error={error} label="Save start times"
          onSave={async () => { if (await run('times', () => putTv({ starts }))) setSaved(true); }} />
      ) : null}
    </div>
  );
}
