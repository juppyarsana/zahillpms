import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Room TV Home (migration 142): what the room TV's own Home screen shows besides the
// guest's stay — Wi-Fi, breakfast, check-out time — and its background photo.
const SLOT_LABEL = { morning: 'Morning', day: 'Day', night: 'Night' };
const FIELDS = ['wifi_ssid', 'wifi_password', 'breakfast_hours', 'breakfast_outlet', 'checkout_time'];

export default function TvHomeCard() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState({});
  const [starts, setStarts] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const fileRefs = { morning: useRef(null), day: useRef(null), night: useRef(null) };

  function apply(data) {
    setS(data);
    setForm(Object.fromEntries(FIELDS.map(f => [f, data[f] || ''])));
    setStarts(Object.fromEntries(data.backgrounds.map(b => [b.slot, b.start])));
  }

  useEffect(() => {
    api.get('/api/board/tv').then(({ data }) => apply(data)).catch(() => setError('Could not load the TV settings.'));
  }, []);

  async function put(body) {
    setError(''); setSaved(false);
    try { apply((await api.put('/api/board/tv', body)).data); return true; }
    catch (err) { setError(err.response?.data?.error || 'Save failed'); return false; }
  }

  async function saveDetails() {
    setBusy('details');
    if (await put({ ...form, starts })) setSaved(true);
    setBusy('');
  }

  async function upload(slot, e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1048576) { setError('A photo can be at most 10 MB.'); return; }
    const fd = new FormData();
    fd.append('image', file);
    setBusy(slot); setError('');
    try { apply((await api.post(`/api/board/tv/background/${slot}`, fd, { timeout: 0 })).data); }
    catch (err) { setError(err.response?.data?.error || 'Upload failed'); }
    finally { setBusy(''); }
  }

  async function removePhoto(slot) {
    if (!confirm(`Remove the ${SLOT_LABEL[slot].toLowerCase()} photo?`)) return;
    setBusy(slot); setError('');
    try { apply((await api.delete(`/api/board/tv/background/${slot}`)).data); }
    catch (err) { setError(err.response?.data?.error || 'Remove failed'); }
    finally { setBusy(''); }
  }

  if (!s) return error ? <div className="card"><div className="alert alert-error">{error}</div></div> : null;

  const photos = s.backgrounds.filter(b => b.image_url).length;
  const field = (key, label, placeholder, extra = {}) => (
    <div className="form-group" style={{ flex: '1 1 200px', minWidth: 0 }}>
      <label className="form-label">{label}</label>
      <input className="form-input" value={form[key] || ''} placeholder={placeholder} {...extra}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 6 }}>📺 Room TV Home</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        The room TVs open on a Home screen with the guest's name, their check-out day and the streaming apps.
        Fill in what guests should see there — an empty field is left off the screen.
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

      <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0 16px' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Background photo</div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={s.use_board} onChange={e => put({ use_board: e.target.checked })} />
          Rotate the Guest Board's pictures
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {s.use_board
          ? 'The pictures of the cards below rotate behind the Home screen. The photos here are used only when no card has a picture.'
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
                  onChange={e => setStarts(st => ({ ...st, [b.slot]: e.target.value }))} />
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

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={saveDetails}>
          {busy === 'details' ? 'Saving…' : 'Save'}
        </button>
        {saved && <span style={{ fontSize: 12, color: 'var(--green-dark)' }}>Saved — the TVs pick it up within a minute.</span>}
      </div>
    </div>
  );
}
