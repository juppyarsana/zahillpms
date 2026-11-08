// Settings → Front desk phones (migration 162): the phones with the Front
// Desk Phone app. Add a phone → a pairing code typed once in the app; the
// phone then rings for room calls like the PMS screens. Owner only.
import { useEffect, useState } from 'react';
import api from '../services/api';

const when = iso => (iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '—');
const fresh = iso => iso && Date.now() - new Date(iso) < 3 * 60 * 1000;

export default function SettingsFoPhones() {
  const [phones, setPhones] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.get('/api/settings/fo-phones').then(r => setPhones(r.data)).catch(e => setError(e.response?.data?.error || 'Could not load'));
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e.response?.data?.error || 'Something went wrong'); } finally { setBusy(false); }
  };
  const add = () => run(async () => { await api.post('/api/settings/fo-phones', { name: name || 'Front desk phone' }); setName(''); });
  const newCode = (p) => {
    if (p.paired && !window.confirm(`Make a new code for "${p.name}"? The app on the phone it is on now stops until the new code is typed.`)) return;
    run(() => api.post(`/api/settings/fo-phones/${p.id}/code`));
  };
  const remove = (p) => {
    if (!window.confirm(`Remove "${p.name}"? It stops ringing at once.`)) return;
    run(() => api.delete(`/api/settings/fo-phones/${p.id}`));
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Front desk phones</h1>
          <div className="page-subtitle">Phones with the Front Desk Phone app ring for room calls, like the PMS screens. The first to answer takes the call.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Add a phone</div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <input className="form-input" style={{ maxWidth: 280 }} placeholder="Name, e.g. Front desk phone 1" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary" disabled={busy} onClick={add}>Add phone</button>
        </div>
        <p className="text-muted" style={{ fontSize: 13, marginTop: 10 }}>
          You get a code for 30 minutes. On the phone: open <b>Front Desk Phone</b> → type the code. The app then walks through the phone's settings
          (microphone, notifications, battery) so it keeps ringing with the screen off.
        </p>
      </div>

      {error && <div className="alert alert-error"><div>{error}</div></div>}

      <div className="card">
        <div className="card-title">Phones</div>
        {!phones && <p className="text-muted">Loading…</p>}
        {phones && phones.length === 0 && <p className="text-muted">No phones yet.</p>}
        {phones && phones.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              {p.paired ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6, background: fresh(p.last_seen_at) ? '#16A34A' : '#9CA3AF' }} />
                  {fresh(p.last_seen_at) ? 'Online' : `Last seen ${when(p.last_seen_at)}`}{p.app_version ? ` · app ${p.app_version}` : ''}
                </div>
              ) : p.pair_code && new Date(p.pair_expires_at) > new Date() ? (
                <div style={{ fontSize: 13 }}>
                  Code: <b style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: 2 }}>{p.pair_code}</b>
                  <span className="text-muted"> · until {when(p.pair_expires_at)}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not paired — the code expired. Make a new one.</div>
              )}
            </div>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => newCode(p)}>{p.paired ? 'Move to another phone' : 'New code'}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => remove(p)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
