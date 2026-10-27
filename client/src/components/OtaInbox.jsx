import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// OTA bookings for front desk (migration 123). One poll for the whole app
// (OtaInboxProvider in Layout): what the channel manager booked, changed or
// cancelled, or left for FO, that nobody has pressed OK on yet. Shown as a
// pop-up on every page (OtaPopup), a counter on the 🌐 OTA bookings menu item,
// and in full on the Dashboard box and the page.

const POLL_MS = 20_000;
const Ctx = createContext({ enabled: false, unseen: [], open: 0, badge: 0 });
export const useOtaInbox = () => useContext(Ctx);

// A short two-note chime (Web Audio, nothing to download).
function chime() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1320, 0.16]].forEach(([f, at]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ac.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.35);
      o.connect(g); g.connect(ac.destination);
      o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.4);
    });
    setTimeout(() => ac.close().catch(() => {}), 1200);
  } catch { /* no sound — the pop-up still shows */ }
}

export function OtaInboxProvider({ children }) {
  const { user, can, hasModule } = useAuth();
  const enabled = !!user && !user.is_superadmin && hasModule('channel_manager') && can('reservations');
  const [state, setState] = useState({ unseen: [], open: 0 });
  const known = useRef(null);   // ids already shown in this tab (no chime twice)

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await api.get('/api/ota-inbox/unseen');
      const ids = data.unseen.map(r => r.id);
      if (known.current && ids.some(id => !known.current.has(id))) chime();
      known.current = new Set([...(known.current || []), ...ids]);
      setState(data);
    } catch { /* keep the last state; tried again on the next poll */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setState({ unseen: [], open: 0 }); return undefined; }
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, refresh]);

  const markSeen = useCallback(async (ids) => {
    setState(s => ({ ...s, unseen: s.unseen.filter(r => !ids.includes(r.id)) }));
    await api.post('/api/ota-inbox/seen', { ids }).catch(() => {});
    refresh();
  }, [refresh]);
  const markAll = useCallback(async () => {
    setState(s => ({ ...s, unseen: [] }));
    await api.post('/api/ota-inbox/seen', { all: true }).catch(() => {});
    refresh();
  }, [refresh]);

  // Not seen yet + still needing someone (an unseen item that needs you counts once).
  const badge = state.unseen.length + state.open
    - state.unseen.filter(r => r.kind === 'attention' && !r.handled_at).length;
  return <Ctx.Provider value={{ enabled, ...state, badge: Math.max(0, badge), refresh, markSeen, markAll }}>{children}</Ctx.Provider>;
}

// ── Shared bits ─────────────────────────────────────────────

const KIND = {
  new:       { icon: '🆕', color: '#15803D', bg: '#F0FDF4', title: r => `New ${r.ota_name || 'OTA'} booking` },
  changed:   { icon: '✏️', color: '#1D4ED8', bg: '#EFF6FF', title: r => `${r.ota_name || 'OTA'} booking changed` },
  cancelled: { icon: '✖', color: '#B91C1C', bg: '#FEF2F2', title: r => `${r.ota_name || 'OTA'} booking cancelled` },
  attention: { icon: '⚠️', color: '#B45309', bg: '#FFFBEB', title: r => `${r.ota_name || 'OTA'} booking needs you` },
};
export const kindOf = r => KIND[r.kind] || KIND.new;

function fmtDay(d) {
  return new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export function stayText(r) {
  const parts = [];
  if (r.rooms?.length) parts.push(`${r.rooms.length === 1 ? 'Room' : 'Rooms'} ${r.rooms.join(', ')}`);
  if (r.arrival && r.departure) {
    const n = Math.round((Date.parse(r.departure) - Date.parse(r.arrival)) / 86400000);
    parts.push(`${fmtDay(r.arrival)} – ${fmtDay(r.departure)} · ${n} night${n === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}
export function timeText(t) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('en-GB', today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function openPath(r) {
  if (r.group_id) return `/reservations/group/${r.group_id}`;
  if (r.booking_id) return `/reservations/${r.booking_id}`;
  return null;
}

// One reservation notice as a row (Dashboard box, page).
export function OtaRow({ r, onHandled, busy, compact }) {
  const k = kindOf(r);
  const path = openPath(r);
  const showMsg = r.kind === 'attention' || !compact;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border, #E5E7EB)' }}>
      <span style={{ width: 28, height: 28, flex: 'none', borderRadius: 8, background: k.bg, color: k.color, display: 'grid', placeItems: 'center', fontSize: 14 }}>{k.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {r.guest_name || 'Guest'} <span style={{ color: k.color, fontWeight: 500, fontSize: 12 }}>· {k.title(r)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted, #6B7280)' }}>
          {[stayText(r), r.ota_code && `${r.ota_name} ${r.ota_code}`, timeText(r.received_at)].filter(Boolean).join(' · ')}
        </div>
        {showMsg && r.message && <div style={{ fontSize: 12, marginTop: 3, color: r.kind === 'attention' ? '#92400E' : 'inherit' }}>{r.message}</div>}
        {r.handled_at && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>✓ Handled{r.handled_by_name ? ` by ${r.handled_by_name}` : ''}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {path && <Link className="btn btn-secondary btn-sm" to={path}>Open</Link>}
        {onHandled && r.kind === 'attention' && !r.handled_at && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onHandled(r)}>Done — handled</button>
        )}
      </div>
    </div>
  );
}

// ── The pop-up ──────────────────────────────────────────────

export function OtaPopup() {
  const { enabled, unseen, markSeen, markAll } = useOtaInbox();
  const navigate = useNavigate();
  if (!enabled || !unseen.length) return null;
  const shown = unseen.slice(-3).reverse();   // newest on top
  const more = unseen.length - shown.length;
  return (
    <div className="ota-popup" role="status" aria-live="polite">
      {shown.map(r => {
        const k = kindOf(r);
        const path = openPath(r);
        return (
          <div key={r.id} className="ota-popup-card" style={{ borderLeftColor: k.color }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span>{k.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: k.color, fontSize: 13 }}>{k.title(r)}</div>
                <div style={{ fontWeight: 600 }}>{r.guest_name || 'Guest'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #6B7280)' }}>{stayText(r)}</div>
                {r.kind === 'attention' && r.message && <div style={{ fontSize: 12, marginTop: 4, color: '#92400E' }}>{r.message}</div>}
                {r.kind === 'cancelled' && r.message && <div style={{ fontSize: 12, marginTop: 4 }}>{r.message}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
              {r.kind === 'attention'
                ? <button className="btn btn-secondary btn-sm" onClick={() => { markSeen([r.id]); navigate('/ota-bookings'); }}>See what to do</button>
                : path && <button className="btn btn-secondary btn-sm" onClick={() => { markSeen([r.id]); navigate(path); }}>Open</button>}
              <button className="btn btn-primary btn-sm" onClick={() => markSeen([r.id])}>OK</button>
            </div>
          </div>
        );
      })}
      {(more > 0 || unseen.length > 1) && (
        <div className="ota-popup-more">
          {more > 0 && <Link to="/ota-bookings" onClick={() => markAll()}>+ {more} more</Link>}
          <button className="btn-link" onClick={markAll}>All seen</button>
        </div>
      )}
    </div>
  );
}

// ── The Dashboard box ───────────────────────────────────────

// Today's OTA counts for a one-line summary (the Today page's Needs you now):
// null while off / loading, else { new, changed, cancelled, needs }.
export function useOtaToday() {
  const { enabled, unseen, open } = useOtaInbox();
  const [data, setData] = useState(null);
  const sig = `${unseen.map(r => r.id).join(',')}|${open}`;
  useEffect(() => {
    if (!enabled) { setData(null); return; }
    api.get('/api/ota-inbox').then(r => setData(r.data)).catch(() => {});
  }, [enabled, sig]);
  if (!enabled || !data) return null;
  return { new: data.today.new, changed: data.today.changed, cancelled: data.today.cancelled, needs: data.open.length };
}

export function OtaTodayBox() {
  const { enabled, unseen, open } = useOtaInbox();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/api/ota-inbox').then(r => setData(r.data)).catch(() => {}), []);
  // Reload whenever the pop-up's poll sees something new.
  const sig = `${unseen.map(r => r.id).join(',')}|${open}`;
  useEffect(() => { if (enabled) load(); }, [enabled, load, sig]);
  if (!enabled || !data) return null;
  const t = data.today;
  const needs = data.open;
  async function handled(r) {
    setBusy(true);
    try { await api.post(`/api/ota-inbox/${r.id}/handled`); await load(); } finally { setBusy(false); }
  }
  const items = t.items.filter(r => r.kind !== 'attention' || r.handled_at).slice(0, 5);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>🌐 From the OTAs — today</h3>
        <Link to="/ota-bookings" style={{ fontSize: 13 }}>All OTA bookings →</Link>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, margin: '8px 0 4px', color: 'var(--text-muted, #6B7280)' }}>
        <span><b style={{ color: '#15803D', fontSize: 16 }}>{t.new}</b> new</span>
        <span><b style={{ color: '#1D4ED8', fontSize: 16 }}>{t.changed}</b> changed</span>
        <span><b style={{ color: '#B91C1C', fontSize: 16 }}>{t.cancelled}</b> cancelled</span>
        {needs.length > 0 && <span><b style={{ color: '#B45309', fontSize: 16 }}>{needs.length}</b> need{needs.length === 1 ? 's' : ''} you</span>}
      </div>
      {needs.map(r => <OtaRow key={r.id} r={r} onHandled={handled} busy={busy} compact />)}
      {items.map(r => <OtaRow key={r.id} r={r} compact />)}
      {!needs.length && !items.length && <div style={{ fontSize: 13, color: 'var(--text-muted, #6B7280)', paddingTop: 6 }}>Nothing from the OTAs yet today.</div>}
    </div>
  );
}
