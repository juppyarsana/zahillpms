// Settings → Property → Room tablets (migration 115): how well the room
// tablets stay connected. A drop = the tablet could not reach the PMS for more
// than a minute (it asks every 10 s). Drops where 5+ rooms went quiet at the
// same moment are the internet line, router or server — shown apart and not
// counted against a room. Kept 30 days. Owner, or the room_tablets permission.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { PROPERTY_TZ, fmtYmd } from '../lib/propertyTime';

const TH = { textAlign: 'left', padding: '6px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const TD = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };
const R = { textAlign: 'right', whiteSpace: 'nowrap' };

const fmtTime = (iso, withDay = true) => !iso ? '—' : new Date(iso).toLocaleString('en-GB', {
  timeZone: PROPERTY_TZ, hour: '2-digit', minute: '2-digit', ...(withDay ? { day: 'numeric', month: 'short' } : {}),
});
const fmtDur = (sec) => {
  const m = Math.round(sec / 60);
  if (sec < 90) return `${Math.round(sec)} s`;
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const ago = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

// Signal: the usual WiFi bands. Shown with a word, never colour alone.
function signal(rssi) {
  if (rssi == null) return null;
  if (rssi >= -67) return { label: 'Good', color: 'var(--success-text)', bg: 'var(--success-bg)' };
  if (rssi >= -75) return { label: 'Weak', color: 'var(--warning-text)', bg: 'var(--warning-bg)' };
  return { label: 'Poor', color: 'var(--danger-text)', bg: 'var(--danger-bg)' };
}
// The kiosk app reports every 2 minutes; older than 10 means what we show is
// its LAST report, not live.
const isStale = (d) => !d?.reported_at || Date.now() - new Date(d.reported_at).getTime() > 10 * 60000;
const MUTED = { bg: '#F3F4F6', color: '#6B7280' };
const band = (mhz) => (!mhz ? '' : mhz >= 5900 ? '6 GHz' : mhz >= 4900 ? '5 GHz' : '2.4 GHz');
const apLabel = (d) => d?.ap_name || (d?.bssid ? `AP …${d.bssid.slice(-5)}` : null);

// Drops per day: one hue, light → dark. 0 stays neutral.
const HEAT = [
  { max: 0, bg: '#F3F4F6', fg: '#6B7280' },
  { max: 2, bg: '#FEE7D1', fg: '#7C2D12' },
  { max: 5, bg: '#FDBA74', fg: '#7C2D12' },
  { max: 10, bg: '#F97316', fg: '#FFFFFF' },
  { max: 20, bg: '#C2410C', fg: '#FFFFFF' },
  { max: Infinity, bg: '#7C2D12', fg: '#FFFFFF' },
];
const heat = (n) => HEAT.find((h) => n <= h.max);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } },
};

export default function RoomTablets() {
  const [tab, setTab] = useState('overview');
  const [days, setDays] = useState(() => store.get('roomTablets.days', 14));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openRoom, setOpenRoom] = useState(null);

  const load = () => {
    setLoading(true); setError('');
    return api.get('/api/room-tablets', { params: { days } })
      .then((r) => setData(r.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); store.set('roomTablets.days', days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  // The "now" tiles follow the tablets — refresh every minute while open.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) api.get('/api/room-tablets', { params: { days } }).then((r) => setData(r.data)).catch(() => {}); }, 60000);
    return () => clearInterval(id);
  }, [days]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Room tablets</div>
          <div className="page-subtitle">How well the room tablets stay connected — a drop is a tablet that could not reach the PMS for more than a minute</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {[7, 14, 30].map((n) => (
            <button key={n} className={`btn ${days === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(n)}>{n} days</button>
          ))}
          <button className="btn btn-secondary" onClick={load} disabled={loading}>↻</button>
          <Link className="btn btn-secondary" to="/guide/room-tablets">📘 Guide</Link>
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 16 }}>
        {[['overview', 'Overview'], ['compare', 'Before / after'], ['aps', 'Access points']].map(([id, label]) => (
          <button key={id} className={`tab-bar-item${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {tab === 'overview' && (loading && !data ? <div className="text-muted">Loading…</div> : data && <Overview data={data} onOpen={setOpenRoom} />)}
      {tab === 'compare' && <Compare rooms={data?.rooms || []} />}
      {tab === 'aps' && <AccessPoints onOpen={setOpenRoom} />}
      {openRoom && <RoomModal room={openRoom} info={data?.rooms.find((r) => r.room === openRoom)} onClose={() => setOpenRoom(null)} />}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────

function Overview({ data, onOpen }) {
  const [sort, setSort] = useState(() => store.get('roomTablets.sort', 'room'));
  useEffect(() => store.set('roomTablets.sort', sort), [sort]);
  const tablets = data.rooms.filter((r) => r.has_history);
  const noTablet = data.rooms.filter((r) => !r.has_history);
  const online = tablets.filter((r) => r.online).length;
  const offline = tablets.filter((r) => r.online === false);
  const yesterday = data.days[data.days.length - 2];
  const dropsYesterday = yesterday ? tablets.reduce((s, r) => s + (r.per_day[yesterday]?.drops || 0), 0) : 0;
  const worst = [...tablets].sort((a, b) => b.totals.drops - a.totals.drops)[0];
  const rows = sort === 'worst' ? [...tablets].sort((a, b) => b.totals.drops - a.totals.drops || b.totals.minutes - a.totals.minutes) : tablets;
  const name = (r) => r.unit_name || r.room;

  return (<>
    <div className="stat-grid">
      <div className="stat-card">
        <div className="stat-label">Online now</div>
        <div className="stat-value">{online} <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>of {tablets.length}</span></div>
        <div className="stat-sub">{offline.length ? `Offline: ${offline.map(name).join(', ')}`
          : tablets.some((r) => r.online == null) ? 'Checking the others — the PMS has just started' : 'Every tablet is reaching the PMS'}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Drops yesterday</div>
        <div className="stat-value">{dropsYesterday}</div>
        <div className="stat-sub">all rooms, the tablet alone</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Most drops · {data.days.length} days</div>
        <div className="stat-value">{worst && worst.totals.drops ? name(worst) : '—'}</div>
        <div className="stat-sub">{worst && worst.totals.drops ? `${worst.totals.drops} drops · ${fmtDur(worst.totals.minutes * 60)} lost` : 'No drops'}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Many rooms at once</div>
        <div className="stat-value">{data.mass_events.length}</div>
        <div className="stat-sub">internet line, router or server</div>
      </div>
    </div>

    <div className="card">
      <div className="card-title">Now</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {tablets.map((r) => <NowTile key={r.room} r={r} onClick={() => onOpen(r.room)} />)}
      </div>
      {noTablet.length > 0 && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
          No tablet heard from: {noTablet.map(name).join(', ')}
        </div>
      )}
    </div>

    <div className="card mt-3">
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div className="card-title" style={{ margin: 0 }}>Drops per day — the tablet alone</div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <span className="text-muted" style={{ fontSize: 12 }}>Sort</span>
          <select className="form-select" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }}>
            <option value="room">By room</option>
            <option value="worst">Most drops first</option>
          </select>
        </div>
      </div>
      <DropGrid data={data} rows={rows} onOpen={onOpen} />
      <HeatLegend />
    </div>

    <div className="card mt-3">
      <div className="card-title">Many rooms at the same time</div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {data.mass} or more tablets went quiet within the same 90 seconds — the internet line, the router or the PMS server, not the WiFi in one room. These are not counted in the grid above.
      </div>
      {!data.mass_events.length ? <div className="text-muted" style={{ fontSize: 13 }}>None in this period.</div> : (
        <div className="table-wrap">
          <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse' }}>
            <thead><tr><th style={TH}>Started</th><th style={TH}>Longest</th><th style={{ ...TH, ...R }}>Rooms</th><th style={TH}>Which</th></tr></thead>
            <tbody>
              {[...data.mass_events].reverse().map((e) => (
                <tr key={e.from}>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtTime(e.from)}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtDur(e.minutes * 60)}</td>
                  <td style={{ ...TD, ...R, fontWeight: 600 }}>{e.rooms.length}</td>
                  <td style={{ ...TD, fontSize: 12 }} className="text-muted">{e.rooms.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    <div className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
      History kept {data.keep_days} days. Recording since the PMS last started: {fmtTime(data.tracking_since)}. Signal and access point come only from tablets running the kiosk app.
    </div>
  </>);
}

function NowTile({ r, onClick }) {
  const d = r.device;
  const stale = isStale(d);
  const sig = signal(d?.rssi);
  const shown = sig && stale ? { ...sig, ...MUTED } : sig;
  const state = r.online === true ? { dot: 'var(--success)', text: 'Online' }
    : r.online === false ? { dot: 'var(--danger)', text: r.last_seen ? `Offline · ${ago(r.last_seen)}` : 'Offline' }
    : { dot: '#9CA3AF', text: 'Checking…' };
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', border: '1px solid var(--border)', borderLeft: `4px solid ${state.dot}`, borderRadius: 8,
      background: 'white', padding: '8px 10px', cursor: 'pointer', font: 'inherit', color: 'inherit',
    }}>
      <div className="flex-between">
        <span style={{ fontWeight: 700 }}>{r.unit_name || r.room}</span>
        {d?.battery != null && <span title={stale ? `Last report ${ago(d.reported_at)}` : undefined} style={{ fontSize: 11, color: !stale && d.battery <= 20 && !d.charging ? 'var(--danger-text)' : 'var(--text-muted)' }}>{!stale && d.charging ? '⚡' : ''}{d.battery}%</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: state.dot, marginRight: 4 }} />{state.text}
      </div>
      {d?.internet_ok === false && (
        <div style={{ fontSize: 11, marginTop: 4, color: 'var(--danger-text)', fontWeight: 600 }}>⚠ WiFi but no internet{stale ? ` · ${ago(d.reported_at)}` : ''}</div>
      )}
      {sig ? (
        <div style={{ fontSize: 11, marginTop: 4 }}>
          {stale && <span className="text-muted">Last known </span>}
          <span style={{ background: shown.bg, color: shown.color, borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>{sig.label} {d.rssi}</span>
          <span className="text-muted"> {band(d.mhz)}</span>
          <div className="text-muted" style={{ marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{apLabel(d)}</div>
        </div>
      ) : <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>{d ? 'No WiFi reading' : 'Browser only — no WiFi reading'}</div>}
    </button>
  );
}

function DropGrid({ data, rows, onOpen }) {
  const [hover, setHover] = useState(null);
  const cell = 34;
  return (
    <div className="table-wrap" style={{ position: 'relative' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
        <thead>
          <tr>
            <th style={{ ...TH, borderBottom: 'none', position: 'sticky', left: 0, background: 'white' }}>Room</th>
            {data.days.map((d) => (
              <th key={d} style={{ ...TH, borderBottom: 'none', textAlign: 'center', padding: '4px 0', width: cell }}>
                <div>{fmtYmd(d, { weekday: 'short' }).slice(0, 2)}</div><div style={{ color: 'var(--text)' }}>{d.slice(8)}</div>
              </th>
            ))}
            <th style={{ ...TH, borderBottom: 'none', ...R }}>Drops</th>
            <th style={{ ...TH, borderBottom: 'none', ...R }}>Lost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.room}>
              <td style={{ padding: '2px 8px', fontWeight: 600, fontSize: 13, position: 'sticky', left: 0, background: 'white', cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => onOpen(r.room)}>{r.unit_name || r.room}</td>
              {data.days.map((d) => {
                const v = r.per_day[d];
                const seen = v && (v.seen_hours > 0 || v.drops_all > 0);
                const h = heat(v?.drops || 0);
                return (
                  <td key={d}
                    onMouseEnter={(e) => setHover({ r, d, v, seen, x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onOpen(r.room)}
                    style={{
                      width: cell, height: 26, textAlign: 'center', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                      background: seen ? h.bg : 'transparent', color: seen ? h.fg : '#C0C4CC',
                      border: seen ? 'none' : '1px dashed var(--border)', fontWeight: v?.drops ? 600 : 400,
                    }}>
                    {seen ? (v.drops || '') : '·'}
                  </td>
                );
              })}
              <td style={{ padding: '2px 8px', fontSize: 13, ...R, fontWeight: 600 }}>{r.totals.drops}</td>
              <td style={{ padding: '2px 8px', fontSize: 12, ...R }} className="text-muted">{fmtDur(r.totals.minutes * 60)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hover && (
        <div style={{
          position: 'absolute', left: Math.max(0, hover.x - 70), top: hover.y + 30, zIndex: 5, pointerEvents: 'none',
          background: '#111827', color: 'white', borderRadius: 6, padding: '6px 9px', fontSize: 12, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,.2)',
        }}>
          <div style={{ fontWeight: 700 }}>{hover.r.unit_name || hover.r.room} · {fmtYmd(hover.d, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          {hover.seen ? (<>
            <div>{hover.v.drops} drop{hover.v.drops === 1 ? '' : 's'} · {fmtDur(hover.v.minutes * 60)} lost</div>
            {hover.v.drops_all > hover.v.drops && <div style={{ opacity: 0.75 }}>+ {hover.v.drops_all - hover.v.drops} with many rooms at once</div>}
            <div style={{ opacity: 0.75 }}>Running {hover.v.seen_hours} h that day</div>
          </>) : <div style={{ opacity: 0.75 }}>Not heard from that day</div>}
        </div>
      )}
    </div>
  );
}

function HeatLegend() {
  const steps = [['0', HEAT[0]], ['1–2', HEAT[1]], ['3–5', HEAT[2]], ['6–10', HEAT[3]], ['11–20', HEAT[4]], ['21+', HEAT[5]]];
  return (
    <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: 11 }}>
      <span className="text-muted">Drops a day:</span>
      {steps.map(([l, h]) => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: h.bg, display: 'inline-block' }} />{l}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, border: '1px dashed var(--border)', display: 'inline-block' }} />not heard from
      </span>
    </div>
  );
}

// ── Before / after ─────────────────────────────────────────────────────────

function Compare({ rooms }) {
  const tablets = rooms.filter((r) => r.has_history);
  const [since, setSince] = useState(() => store.get('roomTablets.since', ''));
  const [picked, setPicked] = useState(() => store.get('roomTablets.changed', []));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const run = () => {
    if (!since) return;
    setLoading(true); setError('');
    store.set('roomTablets.since', since); store.set('roomTablets.changed', picked);
    api.get('/api/room-tablets/compare', { params: { since, rooms: picked.join(',') } })
      .then((r) => setData(r.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (since) run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (room) => setPicked((p) => (p.includes(room) ? p.filter((x) => x !== room) : [...p, room]));
  const pct = (v) => (v == null ? '—' : `${v % 1 ? v.toFixed(1) : v}%`);
  const OnlineBar = ({ v }) => {
    if (!v) return <span className="text-muted">—</span>;
    const c = v.online_pct >= 99 ? 'var(--success)' : v.online_pct >= 90 ? '#F59E0B' : 'var(--danger)';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
        <span style={{ width: 60, height: 6, borderRadius: 3, background: '#E5E7EB', overflow: 'hidden', display: 'inline-block' }}>
          <span style={{ width: `${v.online_pct}%`, height: '100%', background: c, display: 'block', borderRadius: 3 }} />
        </span>
        <b style={{ minWidth: 44, textAlign: 'right' }}>{pct(v.online_pct)}</b>
      </span>
    );
  };
  const VERDICT = {
    better: <span className="badge badge-green">Better</span>,
    worse: <span className="badge badge-red">Worse</span>,
    same: <span className="badge badge-gray">About the same</span>,
  };
  const verdictOf = (r) => {
    if (r.verdict === 'silent') return <span className="badge badge-red">Not heard from since {fmtTime(r.after.silent_since)}</span>;
    if (r.verdict === 'early') return <span className="badge badge-gray" title={`Fewer than ${data.early_hours} hours after the change`}>Too early ({r.after.hours} h)</span>;
    return VERDICT[r.verdict] || null;
  };
  const arrow = (b, a, f) => <>{b ? f(b) : '—'} <span className="text-muted">→</span> {a ? f(a) : '—'}</>;

  return (<>
    <div className="card">
      <div className="card-title">What changed, and when</div>
      <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Pick when the change was made (e.g. new WiFi) and tick the rooms it covered. Each room shows how much of the time its tablet was online before and after, so a few hours "after" can be set against two weeks "before". The other rooms show whether something else changed at the same time.
      </div>
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>Changed at</span>
        <input className="form-input" type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} style={{ width: 220 }} />
        <span className="text-muted" style={{ fontSize: 12 }}>WITA</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {tablets.map((r) => (
          <button key={r.room} onClick={() => toggle(r.room)}
            className={`btn btn-sm ${picked.includes(r.room) ? 'btn-primary' : 'btn-secondary'}`}>{r.unit_name || r.room}</button>
        ))}
      </div>
      <div className="flex gap-2" style={{ alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={run} disabled={!since || loading}>{loading ? 'Working…' : 'Compare'}</button>
        <span className="text-muted" style={{ fontSize: 12 }}>{picked.length} room{picked.length === 1 ? '' : 's'} ticked</span>
      </div>
    </div>

    {error && <div className="alert alert-error mt-3">{error}</div>}
    {data && (<>
      <div className="stat-grid stat-grid-money mt-3">
        {[['Rooms changed', data.groups.changed], ['Other rooms', data.groups.others]].map(([label, g]) => (
          <div className="stat-card" key={label}>
            <div className="stat-label">{label} · online</div>
            <div className="stat-value">{arrow(g.before, g.after, (x) => pct(x.online_pct))}</div>
            <div className="stat-sub">
              offline a day {arrow(g.before, g.after, (x) => fmtDur(x.offline_minutes_per_day * 60))}
              <br />drops a day {arrow(g.before, g.after, (x) => x.drops_per_day)} · {(g.before || g.after)?.rooms || 0} rooms
            </div>
          </div>
        ))}
      </div>
      {data.groups.changed.after && data.groups.changed.after.hours < data.early_hours && (
        <div className="alert alert-warn">
          <div>Only {data.groups.changed.after.hours} hours since the change — a few drops still swing the numbers a lot. Look again after a full day.</div>
        </div>
      )}
      <div className="card">
        <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
          <b>Online</b> = the share of the time the tablet could reach the PMS (100% = never lost it). <b>Offline a day</b> = how long its screen was cut off, on an average day. <b>Drops a day</b> = how many times it lost the connection. Before: {fmtTime(data.from)} – {fmtTime(data.since)} · After: {fmtTime(data.since)} – now. Moments when many rooms dropped together are left out.
        </div>
        <div className="table-wrap">
          <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Room</th><th style={TH}>Group</th>
              <th style={{ ...TH, ...R }}>Online before</th><th style={{ ...TH, ...R }}>Online after</th>
              <th style={{ ...TH, ...R }}>Offline a day</th><th style={{ ...TH, ...R }}>Drops a day</th><th style={TH}>Result</th>
            </tr></thead>
            <tbody>
              {[...data.rows].sort((a, b) => (b.changed - a.changed) || a.room.localeCompare(b.room, undefined, { numeric: true })).map((r) => (
                <tr key={r.room}>
                  <td style={{ ...TD, fontWeight: 600 }}>{r.unit_name || r.room}</td>
                  <td style={TD}>{r.changed ? 'Changed' : <span className="text-muted">Other</span>}</td>
                  <td style={{ ...TD, ...R }}><OnlineBar v={r.before} /></td>
                  <td style={{ ...TD, ...R }}><OnlineBar v={r.after} /></td>
                  <td style={{ ...TD, ...R }}>{arrow(r.before, r.after, (x) => fmtDur(x.offline_minutes_per_day * 60))}</td>
                  <td style={{ ...TD, ...R }}>{arrow(r.before, r.after, (x) => x.drops_per_day)}</td>
                  <td style={TD}>{verdictOf(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>)}
  </>);
}

// ── Access points ──────────────────────────────────────────────────────────

function AccessPoints({ onOpen }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [names, setNames] = useState({});
  const [saving, setSaving] = useState('');
  const load = () => api.get('/api/room-tablets/access-points')
    .then((r) => { setList(r.data); setNames(Object.fromEntries(r.data.map((a) => [a.bssid, a.name || '']))); })
    .catch((err) => setError(err.response?.data?.error || 'Failed to load'));
  useEffect(() => { load(); }, []);
  const save = async (bssid) => {
    setSaving(bssid);
    try { await api.put(`/api/room-tablets/access-points/${encodeURIComponent(bssid)}`, { name: names[bssid] }); await load(); }
    catch (err) { alert(err.response?.data?.error || 'Could not save'); }
    finally { setSaving(''); }
  };
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!list) return <div className="text-muted">Loading…</div>;
  return (
    <div className="card">
      <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Every access point a tablet connected to in the last 7 days, by its hardware address. Give each a name you recognise (e.g. "Block 200 corridor") — the page then shows the name everywhere.
      </div>
      {!list.length ? <div className="text-muted" style={{ fontSize: 13 }}>No WiFi readings yet — they come from tablets running the kiosk app, every few minutes.</div> : (
        <div className="table-wrap">
          <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Name</th><th style={TH}>Address · WiFi</th><th style={TH}>Band</th>
              <th style={TH}>Tablets on it now</th><th style={TH}>Last 7 days</th><th style={{ ...TH, ...R }}>Signal avg / worst</th>
            </tr></thead>
            <tbody>
              {list.map((a) => {
                const sig = signal(a.avg_rssi);
                const dirty = (names[a.bssid] || '') !== (a.name || '');
                return (
                  <tr key={a.bssid}>
                    <td style={{ ...TD, minWidth: 220 }}>
                      <div className="flex gap-2">
                        <input className="form-input" value={names[a.bssid] || ''} placeholder="Name this access point" maxLength={60}
                          onChange={(e) => setNames((n) => ({ ...n, [a.bssid]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && dirty) save(a.bssid); }} style={{ padding: '4px 8px' }} />
                        {dirty && <button className="btn btn-primary btn-sm" onClick={() => save(a.bssid)} disabled={saving === a.bssid}>Save</button>}
                      </div>
                    </td>
                    <td style={{ ...TD, fontSize: 12 }}><code>{a.bssid}</code><div className="text-muted">{a.ssid || ''}</div></td>
                    <td style={TD}>{band(a.mhz)}</td>
                    <td style={TD}>{a.rooms_now.length ? a.rooms_now.map((r) => (
                      <button key={r} className="btn btn-secondary btn-sm" style={{ margin: '0 4px 4px 0' }} onClick={() => onOpen(r)}>{r}</button>
                    )) : <span className="text-muted">—</span>}</td>
                    <td style={{ ...TD, fontSize: 12 }} className="text-muted">{a.rooms_7d.join(', ') || '—'}</td>
                    <td style={{ ...TD, ...R }}>
                      {sig ? <span style={{ background: sig.bg, color: sig.color, borderRadius: 4, padding: '1px 6px', fontWeight: 600, fontSize: 12 }}>{sig.label} {a.avg_rssi}</span> : '—'}
                      {a.worst_rssi != null && <span className="text-muted" style={{ fontSize: 12 }}> / {a.worst_rssi}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── One room ───────────────────────────────────────────────────────────────

function RoomModal({ room, info, onClose }) {
  const [days, setDays] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let off = false;
    setData(null); setError('');
    api.get(`/api/room-tablets/room/${encodeURIComponent(room)}`, { params: { days } })
      .then((r) => { if (!off) setData(r.data); })
      .catch((err) => { if (!off) setError(err.response?.data?.error || 'Failed to load'); });
    return () => { off = true; };
  }, [room, days]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const switches = useMemo(() => {
    if (!data) return [];
    const out = [];
    let prev;
    for (const r of data.readings) {
      if (r.bssid && prev !== undefined && r.bssid !== prev) out.push(r);
      if (r.bssid) prev = r.bssid;
    }
    return out.reverse();
  }, [data]);
  const own = data ? data.drops.filter((d) => d.own) : [];
  // Minutes inside the chosen window only (a drop may have started before it).
  const winFrom = Date.now() - days * 86400e3;
  const lostIn = (list) => list.reduce((s, x) => s + Math.max(0, Math.min(Date.now(), new Date(x.to).getTime()) - Math.max(winFrom, new Date(x.from).getTime())), 0) / 1000;
  const d = data?.device;
  const sig = signal(d?.rssi);
  const stale = isStale(d);
  const sigColor = stale ? MUTED.color : sig?.color;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 820 }}>
        <div className="modal-header">
          <div className="modal-title">Room {data?.unit_name || room} — tablet</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="flex gap-2" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            {[[1, 'Last 24 h'], [7, '7 days'], [30, '30 days']].map(([n, l]) => (
              <button key={n} className={`btn btn-sm ${days === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(n)}>{l}</button>
            ))}
          </div>
          {!data ? <div className="text-muted">Loading…</div> : (<>
            {d?.internet_ok === false && (
              <div className="alert alert-error"><div>
                The tablet's {stale ? `last report (${ago(d.reported_at)})` : 'report'} said: <b>connected to WiFi{d.ssid ? ` "${d.ssid}"` : ''}{sig ? ` with a ${sig.label.toLowerCase()} signal` : ''}, but no internet</b>. The tablet is on the WiFi, but that network is not getting through to the internet — look at the access point / router (DHCP, gateway, firewall), not the signal.
              </div></div>
            )}
            {info?.online === false && stale && d && (
              <div className="alert alert-warn"><div>
                This tablet is offline. Signal, access point and battery below are from its last report ({ago(d.reported_at)}), not live.
              </div></div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, fontSize: 13, marginBottom: 14 }}>
              <Fact label={stale ? 'Signal · last report' : 'Signal now'} value={sig ? <span style={{ color: sigColor, fontWeight: 700 }}>{sig.label} · {d.rssi} dBm</span> : '—'} />
              <Fact label={stale ? 'Access point · last report' : 'Access point'} value={apLabel(d) || '—'} sub={[d?.ssid, band(d?.mhz), d?.mbps ? `${d.mbps} Mbps` : ''].filter(Boolean).join(' · ')} />
              <Fact label={stale ? 'Battery · last report' : 'Battery'} value={d?.battery != null ? `${d.battery}%${d.charging ? ' · charging' : ''}` : '—'} />
              <Fact label="Last heard from" value={<>Screen: {info?.online ? 'now' : info?.last_seen ? ago(info.last_seen) : '—'}</>}
                sub={d ? `Kiosk app: ${d.reported_at ? ago(d.reported_at) : '—'}` : 'No kiosk app (browser only)'} />
              <Fact label={`Drops · ${days === 1 ? '24 h' : `${days} days`}`} value={own.length} sub={`${fmtDur(lostIn(own))} offline · ${data.drops.length - own.length} with many rooms`} />
            </div>

            <div className="card-title" style={{ fontSize: 13 }}>Signal</div>
            <SignalChart readings={data.readings} drops={data.drops} days={days} />

            {switches.length > 0 && (<>
              <div className="card-title" style={{ fontSize: 13, marginTop: 14 }}>Changed access point</div>
              <div style={{ fontSize: 13 }}>
                {switches.slice(0, 20).map((s) => (
                  <div key={s.at} className="flex-between" style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{fmtTime(s.at)}</span>
                    <span>→ {s.ap_name || s.bssid} <span className="text-muted">{band(s.mhz)} · {s.rssi} dBm</span></span>
                  </div>
                ))}
                {switches.length > 20 && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>and {switches.length - 20} more</div>}
              </div>
            </>)}

            <div className="card-title" style={{ fontSize: 13, marginTop: 14 }}>Drops</div>
            {!data.drops.length ? <div className="text-muted" style={{ fontSize: 13 }}>No drops in this period.</div> : (
              <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Went quiet</th><th style={TH}>Back</th><th style={{ ...TH, ...R }}>For</th><th style={TH}>Alone?</th></tr></thead>
                  <tbody>
                    {data.drops.map((x) => (
                      <tr key={x.from}>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtTime(x.from)}</td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtTime(x.to, false)}</td>
                        <td style={{ ...TD, ...R }}>{fmtDur(x.seconds)}</td>
                        <td style={{ ...TD, fontSize: 12 }}>{x.own ? (x.together > 1 ? `with ${x.together - 1} other room${x.together > 2 ? 's' : ''}` : 'Alone') : <span className="text-muted">{x.together} rooms at once</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, sub }) {
  return (
    <div>
      <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
      {sub && <div className="text-muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

// Signal strength over time (one series, so no legend — the title names it).
// Bands mark weak (−67…−75) and poor (below −75). Red ticks on the base = drops.
function SignalChart({ readings, drops, days }) {
  const wrap = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 760, H = 190, L = 40, Rr = 8, T = 8, B = 24;
  const to = Date.now(), from = to - days * 86400e3;
  const pts = readings.filter((r) => r.rssi != null).map((r) => ({ ...r, t: new Date(r.at).getTime() }));
  if (!pts.length) {
    return <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>No signal readings in this period — they come from the kiosk app every few minutes (and only since this page was added).</div>;
  }
  const yMin = -95, yMax = -35;
  const x = (t) => L + ((t - from) / (to - from)) * (W - L - Rr);
  const y = (v) => T + ((yMax - Math.max(yMin, Math.min(yMax, v))) / (yMax - yMin)) * (H - T - B);
  // Break the line where readings are more than 15 minutes apart.
  const paths = [];
  pts.forEach((p, i) => {
    const xy = `${x(p.t).toFixed(1)},${y(p.rssi).toFixed(1)}`;
    if (!i || p.t - pts[i - 1].t > 15 * 60e3) paths.push(`M${xy}`);
    else paths[paths.length - 1] += `L${xy}`;
  });
  const ticks = [];
  const step = days === 1 ? 3 * 3600e3 : 86400e3 * (days > 10 ? 5 : 1);
  const startTick = days === 1 ? Math.ceil(from / step) * step : Date.parse(new Date(from + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10) + 'T00:00:00+08:00');
  for (let t = startTick; t < to; t += step) ticks.push(t);

  const onMove = (e) => {
    const rect = wrap.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = from + ((px - L) / (W - L - Rr)) * (to - from);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setHover({ p: best, left: (x(best.t) / W) * 100 });
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={wrap} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Signal strength over time">
        <rect x={L} y={y(-75)} width={W - L - Rr} height={y(yMin) - y(-75)} fill="#FEF2F2" />
        <rect x={L} y={y(-67)} width={W - L - Rr} height={y(-75) - y(-67)} fill="#FFFBEB" />
        {[-40, -50, -60, -67, -75, -90].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} stroke="#E5E7EB" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#6B7280">{v}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6B7280">
            {days === 1 ? fmtTime(new Date(t).toISOString(), false) : new Date(t).toLocaleDateString('en-GB', { timeZone: PROPERTY_TZ, day: 'numeric', month: 'short' })}
          </text>
        ))}
        <text x={W - Rr - 4} y={y(-71) + 3} textAnchor="end" fontSize="10" fill="#92400E">weak</text>
        <text x={W - Rr - 4} y={y(-85) + 3} textAnchor="end" fontSize="10" fill="#991B1B">poor</text>
        {paths.filter(Boolean).map((d, i) => <path key={i} d={d} fill="none" stroke="var(--green-dark)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {drops.filter((d) => new Date(d.from).getTime() >= from).map((d) => {
          const a = x(new Date(d.from).getTime()), b = x(new Date(d.to).getTime());
          return <rect key={d.from} x={a} y={H - B - 5} width={Math.max(2, b - a)} height={5} rx="1" fill={d.own ? '#DC2626' : '#9CA3AF'} />;
        })}
        {hover && (<>
          <line x1={x(hover.p.t)} x2={x(hover.p.t)} y1={T} y2={H - B} stroke="#9CA3AF" strokeWidth="1" />
          <circle cx={x(hover.p.t)} cy={y(hover.p.rssi)} r="4" fill="var(--green-dark)" stroke="white" strokeWidth="2" />
        </>)}
      </svg>
      {hover && (
        <div style={{
          position: 'absolute', top: 0, left: `${Math.min(hover.left, 70)}%`, transform: 'translateX(8px)', pointerEvents: 'none',
          background: '#111827', color: 'white', borderRadius: 6, padding: '6px 9px', fontSize: 12, whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 700 }}>{fmtTime(hover.p.at)}</div>
          <div>{hover.p.rssi} dBm · {signal(hover.p.rssi).label}</div>
          <div style={{ opacity: 0.8 }}>{hover.p.ap_name || hover.p.bssid || '—'} · {band(hover.p.mhz)}{hover.p.mbps ? ` · ${hover.p.mbps} Mbps` : ''}</div>
          {hover.p.internet_ok === false && <div style={{ color: '#FCA5A5' }}>No internet</div>}
        </div>
      )}
      <div className="flex gap-2" style={{ fontSize: 11, marginTop: 4, flexWrap: 'wrap' }}>
        <span className="text-muted"><span style={{ display: 'inline-block', width: 12, height: 5, background: '#DC2626', borderRadius: 1, marginRight: 4 }} />drop (this tablet)</span>
        <span className="text-muted"><span style={{ display: 'inline-block', width: 12, height: 5, background: '#9CA3AF', borderRadius: 1, marginRight: 4 }} />drop (many rooms at once)</span>
      </div>
    </div>
  );
}
