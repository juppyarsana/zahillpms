import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { PROPERTY_TZ } from '../lib/propertyTime';

// Housekeeping (migration 132) — replaces the Operations task board for
// cleaning. Every room with its state; "Clean these first" = rooms to clean
// with a guest arriving today, the longest waiting first. Marking a room clean
// tells front desk on Telegram; asking for a clean tells housekeeping.

const STATES = {
  to_clean:     { label: 'To clean',         hint: 'Guest left — clean the room' },
  request:      { label: 'Clean on request', hint: 'Guest in the room asked for a clean' },
  ready:        { label: 'Ready',            hint: 'Clean and empty' },
  occupied:     { label: 'Guest in room',    hint: 'Nothing to do now' },
  dnd:          { label: 'Do not disturb',   hint: "Don't knock" },
  out_of_order: { label: 'Out of order',     hint: 'Not for sale' },
};
const ORDER = ['to_clean', 'request', 'ready', 'occupied', 'dnd', 'out_of_order'];

const hm = d => d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: PROPERTY_TZ, hour: '2-digit', minute: '2-digit' }) : '';
// A time today ("10:15"), else the day ("22 Oct").
const when = d => {
  if (!d) return '';
  const ymd = x => new Date(x).toLocaleDateString('en-CA', { timeZone: PROPERTY_TZ });
  return ymd(d) === ymd(Date.now()) ? hm(d) : new Date(d).toLocaleDateString('en-GB', { timeZone: PROPERTY_TZ, day: 'numeric', month: 'short' });
};
const day = ymd => ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
function waited(from) {
  if (!from) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return h >= 24 ? `${Math.floor(h / 24)} d` : m ? `${h} h ${m}` : `${h} h`;
}
const nightsText = n => `${n} night${n === 1 ? '' : 's'}`;
const askedBy = r => r.request?.via === 'guest' ? 'the guest (room tablet)' : `front desk${r.request?.by_name ? ` (${r.request.by_name})` : ''}`;

// The short line under a room's state.
function roomLine(r) {
  switch (r.state) {
    case 'to_clean': return r.checked_out_at ? `Checked out ${hm(r.checked_out_at)}` : r.since ? `Since ${when(r.since)}` : '';
    case 'request': return `Asked by ${r.request?.via === 'guest' ? 'the guest' : 'front desk'} · ${when(r.request?.at)}`;
    case 'ready': return r.since ? `Clean since ${when(r.since)}` : '';
    case 'dnd': return r.dnd_since ? `Since ${when(r.dnd_since)}` : '';
    case 'out_of_order': return [r.out_of_order?.reason, r.out_of_order?.expected_back && `back ${day(r.out_of_order.expected_back)}`].filter(Boolean).join(' · ');
    default: return r.due_out ? 'Due out today' : r.current_check_out ? `Leaves ${day(r.current_check_out)}` : '';
  }
}

export default function Housekeeping() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [selId, setSelId] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => api.get('/api/housekeeping')
    .then(r => { setData(r.data); setError(''); })
    .catch(e => setError(e.response?.data?.error || 'Could not load the rooms')), []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 15000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  if (!data) return (
    <div className="page-wrap">
      <div className="page-header"><div><h1 className="page-title">Housekeeping</h1></div></div>
      {error ? <div className="alert alert-error"><div>{error}</div></div> : <div className="text-muted">Loading…</div>}
    </div>
  );

  const byId = new Map(data.rooms.map(r => [r.id, r]));
  const sel = selId ? byId.get(selId) : null;
  const shown = data.rooms.filter(r => filter === 'all' || r.state === filter);
  const groups = [];
  for (const r of shown) {
    const g = groups.find(x => x.name === r.room_type);
    if (g) g.rooms.push(r); else groups.push({ name: r.room_type, rooms: [r] });
  }
  const typeSummary = name => {
    const all = data.rooms.filter(r => r.room_type === name);
    const dirty = all.filter(r => r.state === 'to_clean' || r.state === 'request').length;
    const ready = all.filter(r => r.state === 'ready').length;
    return `${all.length} room${all.length === 1 ? '' : 's'} · ${dirty} to clean · ${ready} ready`;
  };
  const first = data.first.map(id => byId.get(id)).filter(Boolean);
  const later = data.later.map(id => byId.get(id)).filter(Boolean);

  async function act(fn, done) {
    setBusy(true);
    try { await fn(); setConfirm(false); setNotice(done); await load(); }
    catch (e) { setNotice(''); alert(e.response?.data?.error || 'Something went wrong'); }
    setBusy(false);
  }
  const pick = id => { setSelId(id); setConfirm(false); };
  const markClean = r => act(() => api.post(`/api/housekeeping/rooms/${r.id}/clean`),
    `Room ${r.name} marked clean — front desk is told on Telegram${r.arrival && r.state !== 'request' ? ` (${r.arrival.guest} can check in)` : ''}.`);
  const askClean = r => act(() => api.post(`/api/housekeeping/rooms/${r.id}/request`),
    `Clean asked for room ${r.name} — housekeeping is told on Telegram.`);
  const cancelAsk = r => act(() => api.delete(`/api/housekeeping/rooms/${r.id}/request`), `Clean request for room ${r.name} cancelled.`);
  const toClean = r => act(() => api.post(`/api/housekeeping/rooms/${r.id}/to-clean`), `Room ${r.name} is to clean again.`);

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Housekeeping</h1>
          <div className="page-subtitle">Every room's cleaning state — updates by itself</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <span className="hk-stat">Arriving today <b>{data.arrivals_today}</b></span>
          <span className="hk-stat">Due out today <b>{data.departures_today}</b></span>
        </div>
      </div>

      {notice && (
        <div className="alert alert-success" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}>{notice}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setNotice('')}>OK</button>
        </div>
      )}
      {error && <div className="alert alert-error"><div>{error}</div></div>}

      <div className="hk-chips" role="group" aria-label="Show rooms">
        {[['all', 'All rooms', data.rooms.length], ...ORDER.map(k => [k, STATES[k].label, data.counts[k] || 0])].map(([k, label, n]) => (
          <button key={k} className={`hk-chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
            {k !== 'all' && <span className={`hk-dot s-${k}`} />}{label} <b>{n}</b>
          </button>
        ))}
      </div>

      <div className="hk-layout">
        <div className="hk-main">
          <div className="card hk-first">
            <div className="hk-first-head">
              <h2>Clean these first</h2>
              <span className="text-muted">Rooms to clean with a guest arriving today, longest waiting first</span>
            </div>
            {first.map((r, i) => (
              <button key={r.id} className="hk-first-row" onClick={() => pick(r.id)}>
                <span className="hk-rank">{i + 1}</span>
                <span className="hk-first-no">{r.name}</span>
                <span className="hk-first-text">
                  <b>Arriving: {r.arrival.guest} · {nightsText(r.arrival.nights)}</b>
                  <span className="text-muted">{r.room_type} · {roomLine(r)}</span>
                </span>
                <span className="hk-badge s-to_clean">waiting {waited(r.checked_out_at || r.since)}</span>
              </button>
            ))}
            {!first.length && <div className="hk-first-empty">Every room with a guest arriving today is ready.</div>}
            {later.length > 0 && (
              <div className="hk-first-later text-muted">After these: {later.map(r => r.name + (r.state === 'request' ? ' (on request)' : '')).join(', ')}</div>
            )}
          </div>

          {groups.map(g => (
            <section key={g.name} className="hk-group">
              <div className="hk-group-head"><h2>{g.name || 'Rooms'}</h2><span className="text-muted">{typeSummary(g.name)}</span></div>
              <div className="hk-grid">
                {g.rooms.map(r => (
                  <button key={r.id} className={`hk-tile t-${r.state}${selId === r.id ? ' on' : ''}`} onClick={() => pick(r.id)}
                    aria-label={`Room ${r.name}, ${STATES[r.state].label}${r.arrival ? ', guest arriving today' : ''}`}>
                    <span className="hk-tile-top">
                      <span className="hk-tile-no">{r.name}</span>
                      {r.arrival && <span className="hk-arrival">ARRIVAL</span>}
                    </span>
                    <span className={`hk-badge s-${r.state}`}><span className={`hk-dot s-${r.state}`} />{STATES[r.state].label}</span>
                    {roomLine(r) && <span className="hk-tile-line">{roomLine(r)}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!groups.length && <div className="text-muted">No rooms in this list.</div>}

          <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Other tasks (maintenance, supplies) are still on the <Link to="/operations">old task list</Link>.
          </div>
        </div>

        <aside className={`card hk-panel${sel ? ' open' : ''}`}>
          {!sel ? (
            <>
              <h2 style={{ margin: 0, fontSize: 16 }}>Pick a room</h2>
              <p className="text-muted" style={{ margin: '6px 0 12px', fontSize: 13 }}>Tap a room to see why it needs attention, mark it clean or ask for a clean.</p>
              <div className="hk-legend">
                {ORDER.map(k => <span key={k} className={`hk-badge s-${k}`}><span className={`hk-dot s-${k}`} />{STATES[k].label} — {STATES[k].hint}</span>)}
              </div>
            </>
          ) : (
            <>
              <div className="flex-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="hk-panel-no">Room {sel.name}</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>{sel.room_type}</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelId(null)}>Close</button>
              </div>
              <span className={`hk-badge s-${sel.state}`} style={{ marginTop: 10 }}><span className={`hk-dot s-${sel.state}`} />{STATES[sel.state].label}</span>
              <dl className="hk-facts">
                {!sel.request && roomLine(sel) && <><dt>Now</dt><dd>{roomLine(sel)}</dd></>}
                {sel.state === 'to_clean' && <><dt>Waiting</dt><dd>{waited(sel.checked_out_at || sel.since)}</dd></>}
                {sel.request && <><dt>Asked by</dt><dd>{askedBy(sel)} · {when(sel.request.at)}</dd></>}
                {sel.current_guest && <><dt>Guest</dt><dd>{sel.current_guest}{sel.current_check_out ? ` · leaves ${day(sel.current_check_out)}` : ''}</dd></>}
                {sel.arrival && <><dt>Arriving</dt><dd>{sel.arrival.guest} · {nightsText(sel.arrival.nights)} — today</dd></>}
              </dl>

              {(sel.state === 'to_clean' || sel.state === 'request') && (
                <div className="hk-actions">
                  {confirm ? (
                    <>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Is room {sel.name} fully cleaned and ready?</div>
                      <div className="flex gap-2">
                        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => markClean(sel)}>{busy ? '…' : "Yes, it's clean"}</button>
                        <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-primary" onClick={() => setConfirm(true)}>Mark clean</button>
                      <div className="text-muted" style={{ fontSize: 12 }}>Front desk gets a Telegram message straight away.</div>
                    </>
                  )}
                  {sel.state === 'request' && (
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => cancelAsk(sel)}>Cancel the request</button>
                  )}
                </div>
              )}
              {sel.state === 'occupied' && (
                <div className="hk-actions">
                  <button className="btn btn-primary" disabled={busy} onClick={() => askClean(sel)}>{busy ? '…' : 'Clean on request'}</button>
                  <div className="text-muted" style={{ fontSize: 12 }}>For a guest who asked the front desk. Housekeeping gets a Telegram message.</div>
                </div>
              )}
              {sel.state === 'ready' && (
                <div className="hk-actions">
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => toClean(sel)}>Needs cleaning again</button>
                </div>
              )}
              {sel.state === 'dnd' && (
                <div className="hk-note-dnd">The guest asked not to be disturbed. Don't knock — it clears when the guest switches it off on the tablet.</div>
              )}
              {sel.state === 'out_of_order' && (
                <div className="text-muted" style={{ fontSize: 13, marginTop: 12 }}>Put the room back in service from its room window on Today.</div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
