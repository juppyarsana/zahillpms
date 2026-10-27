import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { propertyToday, addDaysYmd, fmtYmd, PROPERTY_TZ } from '../lib/propertyTime';
import api from '../services/api';
import Icon from '../components/Icon';
import { SourceBadge, useSettings } from '../context/SettingsContext';
import { groupUnitsByType, typeComparator } from '../lib/roomTypeOrder';

const groupStorageKey = t => `resv-cal-group-${(t || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const PALETTE = ['#5C1A2E','#7A2540','#C9A227','#1E40AF','#7C3AED','#DB2777','#0891B2','#9A3412'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function initials(name = '') {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

const STATUS_LABELS = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };
const STATUS_BADGE  = { confirmed: 'badge-green', deposit_paid: 'badge-amber', pending: 'badge-amber', checked_in: 'badge-blue', checked_out: 'badge-gray', cancelled: 'badge-red', no_show: 'badge-red' };

const PENDING_STRIPE = 'repeating-linear-gradient(45deg, #FEF08A, #FEF08A 4px, #FEFCE8 4px, #FEFCE8 10px)';

const STATUS_BG   = { pending: PENDING_STRIPE, deposit_paid: '#FDBA74', confirmed: '#86EFAC', checked_in: '#93C5FD', checked_out: '#E5E7EB' };
const STATUS_TEXT = { pending: '#713F12',      deposit_paid: '#7C2D12', confirmed: '#14532D', checked_in: '#1E3A8A', checked_out: '#6B7280' };

const STATUS_LEGEND = [
  { bg: PENDING_STRIPE, label: 'Pending' },
  { bg: '#FDBA74', label: 'Deposit Paid' },
  { bg: '#86EFAC', label: 'Confirmed' },
  { bg: '#93C5FD', label: 'Checked In' },
  { bg: '#FED7AA', label: 'Check-out Day', diagonal: true },
  { bg: '#F3F4F6', label: 'Available', dashed: true },
];

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function toDate(str) {
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatRate(rate) {
  if (!rate) return '';
  if (rate >= 1000000) return `${(rate % 1000000 === 0 ? rate / 1000000 : (rate / 1000000).toFixed(1))}jt`;
  if (rate >= 1000) return `${Math.round(rate / 1000)}rb`;
  return String(rate);
}

// Small "👥 Group" tag on a booking that belongs to a group booking — click it
// to open the group page (stops the row's own click from opening the room).
function GroupTag({ groupId, nav }) {
  if (!groupId) return null;
  return (
    <span className="badge badge-blue" title="Part of a group booking — open the group"
      style={{ marginLeft: 6, cursor: 'pointer', fontSize: 10 }}
      onClick={e => { e.stopPropagation(); nav(`/reservations/group/${groupId}`); }}>
      👥 Group
    </span>
  );
}

// Groups view: one row per group booking (booker, dates, rooms, guests still
// to assign, balance) → click to open the group page.
function GroupsView({ nav }) {
  const [when, setWhen] = useState('current');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 300); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => {
    setLoading(true);
    api.get('/api/bookings/groups', { params: { when, ...(q ? { q } : {}) } })
      .then(r => setGroups(r.data))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [when, q]);

  const statusOf = g => {
    if (g.group_status === 'cancelled' || g.active_rooms === 0) return ['Cancelled', 'badge-red'];
    if (g.checked_out_rooms === g.active_rooms) return ['Checked out', 'badge-gray'];
    if (g.checked_in_rooms > 0) return [`In house ${g.checked_in_rooms}/${g.active_rooms}`, 'badge-blue'];
    return ['Upcoming', 'badge-green'];
  };

  return (
    <>
      <div className="card mb-3">
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <label className="form-label">Search</label>
            <input className="form-input" placeholder="Booker or guest name…" value={qInput} onChange={e => setQInput(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Show</label>
            <select className="form-select" value={when} onChange={e => setWhen(e.target.value)}>
              <option value="current">Upcoming &amp; in house</option>
              <option value="past">Past</option>
              <option value="all">All groups</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Booked by</th><th>Dates</th><th>Rooms</th><th>Guests</th><th>Status</th><th>Guest names</th><th>Balance due</th>
              </tr>
            </thead>
            <tbody>
              {!loading && groups.map(g => {
                const [label, cls] = statusOf(g);
                return (
                  <tr key={g.id} style={{ cursor: 'pointer', opacity: label === 'Cancelled' ? 0.5 : 1 }} onClick={() => nav(`/reservations/group/${g.id}`)}>
                    <td style={{ fontWeight: 600 }}>{g.booker_name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{g.check_in_date?.slice(0, 10)} → {g.check_out_date?.slice(0, 10)}</td>
                    <td>
                      {g.active_rooms} room{g.active_rooms === 1 ? '' : 's'}
                      {g.room_names && <div className="text-muted" style={{ fontSize: 11 }}>{g.room_names}</div>}
                    </td>
                    <td>{g.pax}</td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                    <td>
                      {g.rooms_with_booker > 0
                        ? <span className="badge badge-amber" title="Rooms still under the booker's name — use Assign Guests on the group page">{g.rooms_with_booker} to assign</span>
                        : <span className="text-muted" style={{ fontSize: 12 }}>✓ Assigned</span>}
                    </td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap', color: g.balance_due > 0.5 ? 'var(--danger-text)' : undefined }}>
                      {g.balance_due > 0.5 ? `Rp ${Math.round(g.balance_due).toLocaleString('id-ID')}` : 'Paid'}
                    </td>
                  </tr>
                );
              })}
              {loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>Loading…</td></tr>}
              {!loading && groups.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  {q ? 'No group matches this search' : when === 'past' ? 'No past group bookings' : 'No upcoming or in-house group bookings'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// A group counts once — the To check badge and tabs count reservations.
function countReservations(rows) {
  return new Set(rows.map(r => r.reservation_group_id || r.id)).size;
}

// The rows of one reservation folded into one line: a group's rooms together,
// each open point once with the rooms it is on.
function foldReservations(rows) {
  const byRes = new Map();
  for (const b of rows) {
    const key = b.reservation_group_id || b.id;
    if (!byRes.has(key)) byRes.set(key, { key, groupId: b.reservation_group_id, rows: [] });
    byRes.get(key).rows.push(b);
  }
  return [...byRes.values()].map(r => {
    const first = r.rows[0];
    const points = new Map();
    for (const b of r.rows) for (const p of (b.points || [])) {
      if (!points.has(p.text)) points.set(p.text, { ...p, rooms: [], done: 0 });
      const e = points.get(p.text);
      e.rooms.push(b.unit_name);
      if (p.resolved) e.done += 1;
    }
    return {
      ...r,
      arrival: r.rows.reduce((m, b) => (b.check_in_date < m ? b.check_in_date : m), first.check_in_date),
      departure: r.rows.reduce((m, b) => (b.check_out_date > m ? b.check_out_date : m), first.check_out_date),
      name: r.groupId ? (first.group_booker || first.guest_name) : first.guest_name,
      source: first.agent_name || first.source_label || '—',
      points: [...points.values()],
      doneBy: first.to_check_done_by_name, doneAt: first.to_check_done_at,
    };
  });
}

// "To check" view: bookings with points front desk still has to look at
// (migration 109 — written by the VHP import: a room picked by the import,
// an agent not found, no rate, placeholder names…), one line per reservation
// (a group's rooms together). A point FO has fixed (price edited, guest
// assigned, room changed…) is struck through by itself; Checked takes the
// reservation off the list. Bookings waiting only for their guest names have
// their own tab, so they don't hide the ones with work to do.
function ToCheckView({ nav, onCount }) {
  const [tab, setTab] = useState('open');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const load = () => {
    setLoading(true);
    return api.get('/api/bookings/to-check', { params: { view: tab } })
      .then(r => { setRows(r.data); if (tab === 'open') onCount?.(countReservations(r.data)); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const check = async (res, undo = false) => {
    setBusy(res.key); setErr('');
    try {
      if (res.groupId) await api.put(`/api/bookings/group/${res.groupId}/to-check/done`, undo ? { undo: true } : {});
      else await api.put(`/api/bookings/${res.rows[0].id}/to-check/done`, undo ? { undo: true } : {});
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save — try again');
    } finally { setBusy(null); }
  };

  const list = foldReservations(rows);
  const open = (res) => nav(res.groupId ? `/reservations/group/${res.groupId}` : `/reservations/${res.rows[0].id}`);
  const intro = {
    open: 'One line per reservation (a group\'s rooms together). Open it, fix what is listed — a point you fix is struck through by itself — then press Checked. Guest names can wait: once checked, a reservation that only needs its guest names moves to "Waiting for guest names".',
    names: 'Reservations where only the guest names are missing — they leave this list by themselves once the guests are assigned (Assign Guests on the group page, Change Guest on a room).',
    done: 'Reservations with nothing left to check (latest 200). "Put back" returns one to the To check list.',
  }[tab];

  return (
    <div className="card">
      <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="text-muted" style={{ fontSize: 13, maxWidth: 640 }}>{intro} <Link to="/guide/to-check">Guide →</Link></div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <div className="seg">
            <button type="button" className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>To check</button>
            <button type="button" className={tab === 'names' ? 'active' : ''} onClick={() => setTab('names')}>Waiting for guest names</button>
            <button type="button" className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}>Done</button>
          </div>
        </div>
      </div>
      {err && <div className="alert alert-error mb-3"><div>{err}</div></div>}
      {!loading && list.length > 0 && (
        <div className="text-muted mb-2" style={{ fontSize: 12 }}>
          {list.length} reservation{list.length === 1 ? '' : 's'} · {rows.length} room{rows.length === 1 ? '' : 's'}
        </div>
      )}
      <div className="table-wrap">
        <table style={{ minWidth: 720 }}>
          <thead>
            <tr><th>Arrival</th><th>Reservation</th><th>Source / agent</th><th>To check</th><th></th></tr>
          </thead>
          <tbody>
            {!loading && list.map(res => (
              <tr key={res.key} style={{ cursor: 'pointer', verticalAlign: 'top' }} onClick={() => open(res)}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtYmd(res.arrival?.slice(0, 10))}
                  <div className="text-muted" style={{ fontSize: 11 }}>→ {fmtYmd(res.departure?.slice(0, 10))}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{res.name}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {res.groupId ? `👥 Group · ${res.rows.length} room${res.rows.length === 1 ? '' : 's'}: ` : ''}
                    {res.rows.map(b => b.unit_name).join(', ')}
                  </div>
                </td>
                <td style={{ fontSize: 12 }}>{res.source}</td>
                <td style={{ fontSize: 12 }}>
                  {res.points.map(p => {
                    const allDone = p.done === p.rooms.length;
                    const roomsTxt = res.rows.length > 1 && p.rooms.length < res.rows.length ? ` (${p.rooms.join(', ')})` : '';
                    return (
                      <div key={p.text} style={allDone ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : undefined}>
                        {allDone ? '✓' : '•'} {p.text}{roomsTxt}
                        {!allDone && p.done > 0 && <span className="text-muted"> — {p.done} of {p.rooms.length} done</span>}
                      </div>
                    );
                  })}
                  {tab === 'done' && res.doneBy && (
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                      Checked by {res.doneBy}{res.doneAt && ` · ${new Date(res.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: PROPERTY_TZ })}`}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  {tab === 'open' && (
                    <button className="btn btn-sm btn-secondary" disabled={busy === res.key} onClick={() => check(res)}
                      title={res.groupId ? 'Mark every room of this group as checked' : 'Mark this booking as checked'}>
                      {busy === res.key ? '…' : res.groupId ? '✓ Checked whole group' : '✓ Checked'}
                    </button>
                  )}
                  {tab === 'done' && res.doneBy && (
                    <button className="btn btn-sm btn-secondary" disabled={busy === res.key} onClick={() => check(res, true)}>Put back</button>
                  )}
                </td>
              </tr>
            ))}
            {loading && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>Loading…</td></tr>}
            {!loading && list.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                {tab === 'open' ? '✓ Nothing left to check' : tab === 'names' ? 'No reservation is waiting for guest names' : 'Nothing done yet'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// "Booked on" view: reservations by the day they were MADE (any stay date) —
// "how many reservations did we take today?". A group is one row. Same
// numbers as the Dashboard's "New reservations" and the Daily Close
// (GET /api/bookings/booked → services/bookingPickup).
const fmtIDRr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
function bookedRange(pick, custom) {
  const t = propertyToday();
  if (pick === 'today') return [t, t];
  if (pick === 'yesterday') { const y = addDaysYmd(t, -1); return [y, y]; }
  if (pick === 'week') {   // Monday → today
    const dow = new Date(t + 'T00:00:00Z').getUTCDay();
    return [addDaysYmd(t, -((dow + 6) % 7)), t];
  }
  if (pick === 'month') return [t.slice(0, 8) + '01', t];
  return [custom.from || t, custom.to || custom.from || t];
}
function bookedStatus(r) {
  if (r.cancelled_rooms === r.rooms) return ['Cancelled', 'badge-red'];
  const live = r.statuses.filter(s => s !== 'cancelled');
  const one = live.every(s => s === live[0]) ? live[0] : null;
  const label = one ? STATUS_LABELS[one] : 'Mixed';
  return [r.cancelled_rooms ? `${label} · ${r.cancelled_rooms} cancelled` : label, one ? STATUS_BADGE[one] : 'badge-gray'];
}
function BookedView({ nav }) {
  const [pick, setPick] = useState('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, to] = bookedRange(pick, custom);

  useEffect(() => {
    setLoading(true); setError('');
    api.get('/api/bookings/booked', { params: { from, to } })
      .then(r => setData(r.data))
      .catch(err => { setData(null); setError(err.response?.data?.error || 'Could not load'); })
      .finally(() => setLoading(false));
  }, [from, to]);

  const open = r => nav(r.group_id ? `/reservations/group/${r.group_id}` : `/reservations/${r.id}`);
  const madeAt = iso => {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-CA', { timeZone: PROPERTY_TZ });
    const time = d.toLocaleTimeString('en-GB', { timeZone: PROPERTY_TZ, hour: '2-digit', minute: '2-digit' });
    return from === to ? time : `${fmtYmd(day)} · ${time}`;
  };
  const rangeLabel = from === to ? fmtYmd(from, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmtYmd(from)} – ${fmtYmd(to)}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const rowsTable = (rows, empty, cancelled) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Booked</th><th>Guest</th><th>Rooms</th><th>Stay</th><th>Guests</th><th>Source</th>
            <th style={{ textAlign: 'right' }} title="Net — room + meals after discount, before service and tax">Value (net)</th>
            {!cancelled && <th>Status</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const [label, cls] = bookedStatus(r);
            return (
              <tr key={r.group_id || r.id} style={{ cursor: 'pointer', opacity: !cancelled && label === 'Cancelled' ? 0.55 : 1 }} onClick={() => open(r)}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {cancelled ? fmtYmd(new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: PROPERTY_TZ })) : madeAt(r.created_at)}
                  {r.created_by_name && <div className="text-muted" style={{ fontSize: 11 }}>by {r.created_by_name}</div>}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {r.guest_name}
                  {r.group_id && <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 10 }}>👥 Group</span>}
                </td>
                <td>
                  {plural(r.rooms, 'room')}
                  <div className="text-muted" style={{ fontSize: 11 }}>{r.unit_names.join(', ')}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtYmd(r.check_in_date)} → {fmtYmd(r.check_out_date)}
                  <div className="text-muted" style={{ fontSize: 11 }}>{plural(r.nights, r.rooms > 1 ? 'room-night' : 'night')}</div>
                </td>
                <td>{r.guests}</td>
                <td>{r.source_label}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtIDRr(r.value)}</td>
                {!cancelled && <td><span className={`badge ${cls}`}>{label}</span></td>}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 28 }}>{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="card mb-3">
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Booked on</label>
            <div className="seg">
              {[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Pick dates']].map(([k, l]) => (
                <button key={k} type="button" className={pick === k ? 'active' : ''} onClick={() => setPick(k)}>{l}</button>
              ))}
            </div>
          </div>
          {pick === 'custom' && (
            <>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">From</label>
                <input type="date" className="form-input" value={custom.from} max={propertyToday()} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">To</label>
                <input type="date" className="form-input" value={custom.to} min={custom.from || undefined} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
              </div>
            </>
          )}
        </div>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
          Reservations by the day they were <b>made</b>, for any stay date. A group booking is one row.
          Times are property time (WITA).
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="text-muted" style={{ padding: 30, textAlign: 'center' }}>Loading…</div> : data && (
        <>
          <div className="card mb-3" style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}>
            {[
              ['Reservations made', plural(data.made.bookings, 'booking'), rangeLabel],
              ['Rooms', plural(data.made.rooms, 'room'), plural(data.made.nights, 'room-night')],
              ['Guests', String(data.made.guests), 'in these bookings'],
              ['Value', fmtIDRr(data.made.value), 'net · before service & tax'],
              ['Cancelled', plural(data.cancelled.bookings, 'booking'), data.cancelled.rooms ? `${plural(data.cancelled.rooms, 'room')} · ${fmtIDRr(data.cancelled.value)}` : 'none'],
            ].map(([label, value, sub], i) => (
              <div key={label} style={{ flex: '1 1 150px', padding: '14px 18px', borderLeft: i > 0 ? '1px solid var(--border)' : 'none' }}>
                <div className="stat-label">{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: label === 'Cancelled' && data.cancelled.bookings ? 'var(--danger-text)' : undefined }}>{value}</div>
                <div className="stat-sub">{sub}</div>
              </div>
            ))}
          </div>
          <div className="card mb-3">
            {rowsTable(data.rows, pick === 'today' ? 'No reservations made yet today.' : 'No reservations made in this period.')}
          </div>
          {data.cancelled_rows.length > 0 && (
            <div className="card">
              <div className="card-title">Cancelled in this period</div>
              {rowsTable(data.cancelled_rows, '', true)}
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function Reservations() {
  const nav = useNavigate();
  const { sources } = useSettings();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [year, setYear]     = useState(now.getFullYear());
  const [month, setMonth]   = useState(now.getMonth() + 1);
  const [bookings, setBookings] = useState([]);
  const [units, setUnits]   = useState([]);
  const [rates, setRates]   = useState({});
  // ?view=booked (e.g. from the Dashboard's "New reservations" box).
  const [params] = useSearchParams();
  const [view, setView]     = useState(['list', 'groups', 'booked', 'tocheck'].includes(params.get('view')) ? params.get('view') : 'calendar');
  const calScrollRef        = useRef(null);
  // Bookings still "to check" (migration 109) — the button only shows when there are any.
  // Counted in reservations (a group = 1). Also shown while bookings only
  // wait for their guest names, so that list stays reachable.
  const [toCheckCount, setToCheckCount] = useState(0);
  const [namesWaiting, setNamesWaiting] = useState(0);
  useEffect(() => {
    api.get('/api/bookings/to-check').then(r => setToCheckCount(countReservations(r.data))).catch(() => {});
    api.get('/api/bookings/to-check', { params: { view: 'names' } }).then(r => setNamesWaiting(countReservations(r.data))).catch(() => {});
  }, []);

  // List view filters — kept separate from the calendar's month/year-driven
  // `bookings` fetch above, so switching between views never contaminates
  // the calendar grid with a filtered/searched result set.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState(''); // debounced
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [listBookings, setListBookings] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const hasActiveFilters = !!(searchQuery || filterStatus || filterSource || dateFrom || dateTo);

  // Search or an explicit date range searches across all dates (not just the
  // calendar's currently selected month) — that's the whole point of being
  // able to find a reservation regardless of which month it's in.
  function buildListParams() {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (dateFrom && dateTo) { params.set('date_from', dateFrom); params.set('date_to', dateTo); }
    else if (!searchQuery) { params.set('month', month); params.set('year', year); }
    if (filterStatus) params.set('status', filterStatus);
    if (filterSource) params.set('source', filterSource);
    return params;
  }

  useEffect(() => {
    if (view !== 'list') return;
    api.get(`/api/bookings?${buildListParams().toString()}`).then(r => setListBookings(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, searchQuery, filterStatus, filterSource, dateFrom, dateTo, month, year]);

  function clearFilters() {
    setSearchInput(''); setSearchQuery(''); setFilterStatus(''); setFilterSource(''); setDateFrom(''); setDateTo('');
  }

  const [exportingPdf, setExportingPdf] = useState(false);
  async function exportGuestReportPdf() {
    setExportingPdf(true);
    try {
      const r = await api.get(`/api/bookings/guest-report/pdf?${buildListParams().toString()}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `guest-report-${dateFrom && dateTo ? `${dateFrom}_${dateTo}` : `${year}-${String(month).padStart(2, '0')}`}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to generate guest report');
    } finally {
      setExportingPdf(false);
    }
  }

  // Room-type filter (calendar only). null = all types.
  const [selTypes, setSelTypes] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('resv-cal-types')); return Array.isArray(s) && s.length ? new Set(s) : null; }
    catch { return null; }
  });
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());

  useEffect(() => { api.get('/api/units').then(r => setUnits(r.data)); }, []);
  useEffect(() => {
    // Every stay overlapping this month (not just ones that check in in it —
    // a 28 Sep–3 Oct stay belongs on October's calendar too), from the day
    // before the 1st so a stay checking out on the 1st still draws its "out"
    // half-cell; plus guests still checked in past their check-out (overdue).
    const pad = n => String(n).padStart(2, '0');
    const prev = new Date(year, month - 1, 0);
    const from = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
    const to = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
    api.get('/api/bookings', { params: { date_from: from, date_to: to, include_overdue: 1 } }).then(r => setBookings(r.data));
    api.get(`/api/pricing/calendar?month=${month}&year=${year}`).then(r => setRates(r.data));
  }, [month, year]);

  const allTypes = useMemo(() => [...new Set(units.map(u => u.type || 'Other'))], [units]);
  const visibleUnits = useMemo(
    () => (selTypes ? units.filter(u => selTypes.has(u.type || 'Other')) : units),
    [units, selTypes]
  );
  const groups = useMemo(() => groupUnitsByType(visibleUnits), [visibleUnits]);

  const groupTypesKey = groups.map(g => g.type).join('|');
  useEffect(() => {
    setCollapsed(new Set(groups.filter(g => localStorage.getItem(groupStorageKey(g.type)) === 'closed').map(g => g.type)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupTypesKey]);

  function toggleGroup(t) {
    setCollapsed(prev => {
      const next = new Set(prev);
      const nowClosed = !next.has(t);
      if (nowClosed) next.add(t); else next.delete(t);
      localStorage.setItem(groupStorageKey(t), nowClosed ? 'closed' : 'open');
      return next;
    });
  }
  function toggleType(t) {
    setSelTypes(prev => {
      const next = new Set(prev ?? allTypes);
      if (next.has(t)) next.delete(t); else next.add(t);
      const resolved = next.size >= allTypes.length ? null : next;
      if (resolved) localStorage.setItem('resv-cal-types', JSON.stringify([...resolved]));
      else localStorage.removeItem('resv-cal-types');
      return resolved;
    });
  }

  // Scroll today into view near the left edge (cell = 72px + 2px gap = 74px per column)
  useEffect(() => {
    if (!calScrollRef.current) return;
    const isCurrentMonth = month === today.getMonth() + 1 && year === today.getFullYear();
    calScrollRef.current.scrollLeft = isCurrentMonth ? Math.max(0, (today.getDate() - 1) * 74 - 40) : 0;
  }, [month, year, view]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const days = getDaysInMonth(year, month);
  const dayArr = Array.from({ length: days }, (_, i) => i + 1);
  const monthName = new Date(year, month - 1).toLocaleString('en', { month: 'long' });
  const gridTemplate = `var(--cal-label-w) repeat(${days}, 72px)`;

  function isToday(d) {
    return d === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();
  }

  function srcColor(sourceId) {
    return sources.find(s => s.id === sourceId)?.color || '#9CA3AF';
  }

  // Per-unit booking index — built once per bookings change; check-in/out
  // pre-parsed to epoch ms so getCellInfo does no Date work in the loop.
  const bookingsByUnit = useMemo(() => {
    const m = new Map();
    // Overdue = still checked in after check-out: draw the stay on up to
    // today (red from the original check-out), since the guest is still here.
    const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    for (const b of bookings) {
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      const rec = { ...b, _ci: toDate(b.check_in_date).getTime(), _co: toDate(b.check_out_date).getTime() };
      if (b.status === 'checked_in' && rec._co < todayMs) {
        rec._overdueFrom = rec._co;
        rec._co = todayMs + 86400000;
      }
      if (!m.has(b.unit_id)) m.set(b.unit_id, []);
      m.get(b.unit_id).push(rec);
    }
    return m;
  }, [bookings]);

  function getCellInfo(unitId, day) {
    const list = bookingsByUnit.get(unitId);
    if (!list) return { type: 'avail' };
    const t = new Date(year, month - 1, day).getTime();
    const checkout = list.find(b => b._co === t);
    const arrival  = list.find(b => b._ci === t);
    if (checkout && arrival) return { type: 'split', checkout, arrival };
    if (checkout) return { type: 'out', booking: checkout };
    const stay = list.find(b => t >= b._ci && t < b._co);
    if (stay) return {
      type: 'stay', booking: stay,
      isCI: stay._ci === t,
      overdue: stay._overdueFrom != null && t >= stay._overdueFrom,
      overdueStart: stay._overdueFrom === t,
    };
    return { type: 'avail' };
  }

  function renderCell(info, unitId, d) {
    const key = `${unitId}-${d}`;
    const isT = isToday(d);
    const todayCls = isT ? ' today-col' : '';

    if (info.type === 'split') {
      const arrBg   = STATUS_BG[info.arrival.status]   || '#F3F4F6';
      const arrText = STATUS_TEXT[info.arrival.status]  || '#6B7280';
      const arrDot  = srcColor(info.arrival.source);
      const arrName = (isT ? '▶' : '') + (info.arrival.guest_name?.split(' ')[0] || '');
      return (
        <div
          key={key}
          className={`cal-cell${todayCls}`}
          style={{ padding: 0, background: 'transparent' }}
          title={`↑ Out: ${info.checkout.guest_name}  |  ↓ In: ${info.arrival.guest_name}`}
        >
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, #FED7AA 50%, ${arrBg} 50%)`, borderRadius: 5 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, transparent calc(50% - 1.5px), white calc(50% - 1.5px), white calc(50% + 1.5px), transparent calc(50% + 1.5px))', borderRadius: 5 }} />
          <div style={{ position: 'absolute', top: 2, left: 3, fontSize: 8, fontWeight: 800, color: '#9A3412', lineHeight: 1, cursor: 'pointer', zIndex: 1 }}
            onClick={() => nav(`/reservations/${info.checkout.id}`)}>out</div>
          <div style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 8, fontWeight: 800, color: arrText, lineHeight: 1, cursor: 'pointer', zIndex: 1, textAlign: 'right' }}
            onClick={() => nav(`/reservations/${info.arrival.id}`)}>
            {arrName}
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: arrDot, marginLeft: 'auto', marginTop: 1, border: '1.5px solid rgba(255,255,255,0.9)' }} />
          </div>
        </div>
      );
    }

    if (info.type === 'out') {
      const dd = String(d).padStart(2,'0'), mm = String(month).padStart(2,'0');
      const outDone = info.booking.status === 'checked_out';
      return (
        <div
          key={key}
          className={`cal-cell${todayCls}`}
          style={{ padding: 0, background: 'transparent' }}
          title={`↑ Out: ${info.booking.guest_name}  |  Available from this date`}
        >
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #FED7AA 50%, #F3F4F6 50%)', borderRadius: 5 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, transparent calc(50% - 1.5px), white calc(50% - 1.5px), white calc(50% + 1.5px), transparent calc(50% + 1.5px))', borderRadius: 5 }} />
          <div style={{ position: 'absolute', top: 2, left: 3, fontSize: 8, fontWeight: 800, color: '#9A3412', lineHeight: 1, cursor: 'pointer', zIndex: 1, opacity: outDone ? 0.4 : 1 }}
            onClick={() => nav(`/reservations/${info.booking.id}`)}>out</div>
          <div style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 8, fontWeight: 700, color: '#6B7280', lineHeight: 1, cursor: 'pointer', zIndex: 1 }}
            onClick={e => { e.stopPropagation(); nav(`/reservations/new?unit=${unitId}&date=${year}-${mm}-${dd}`); }}>+new</div>
        </div>
      );
    }

    if (info.type === 'stay') {
      const bg   = info.overdue ? '#FCA5A5' : (STATUS_BG[info.booking.status] || '#F3F4F6');
      const tc   = info.overdue ? '#7F1D1D' : (STATUS_TEXT[info.booking.status] || '#6B7280');
      const dot  = srcColor(info.booking.source);
      const text = info.overdueStart ? '⏰ overdue'
        : info.isCI ? (isT ? '▶' : '') + (info.booking.reservation_group_id ? '👥' : '') + (info.booking.guest_name?.split(' ')[0] || '') : '';
      const doneStyle = info.booking.status === 'checked_out' ? { opacity: 0.4, filter: 'grayscale(0.6)' } : {};
      return (
        <div
          key={key}
          className={`cal-cell${todayCls}`}
          style={{ background: bg, color: tc, ...doneStyle }}
          title={`${info.booking.guest_name} · ${STATUS_LABELS[info.booking.status] || info.booking.status} · ${sources.find(s => s.id === info.booking.source)?.label || info.booking.source}${info.booking.rate_plan_code && info.booking.rate_plan_code !== 'RO' ? ` · ${info.booking.rate_plan_code}` : ''}${info.booking.bed_preference ? ` · ${info.booking.bed_preference} bed` : ''}${info.booking.reservation_group_id ? ' · Group booking' : ''}${info.overdue ? ` · OVERDUE — was due out ${String(info.booking.check_out_date).slice(0, 10)}, still checked in` : ''}`}
          onClick={() => nav(`/reservations/${info.booking.id}`)}
        >
          <div style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: dot, border: '1.5px solid rgba(255,255,255,0.9)' }} />
          {text}
        </div>
      );
    }

    // Available
    const dd2 = String(d).padStart(2,'0'), mm2 = String(month).padStart(2,'0');
    const rate = rates[unitId]?.[d];
    return (
      <div
        key={key}
        className={`cal-cell avail${todayCls}`}
        title={rate ? `Rp ${rate.toLocaleString('id-ID')} / night — click to book` : 'Available — click to book'}
        onClick={() => nav(`/reservations/new?unit=${unitId}&date=${year}-${mm2}-${dd2}`)}
      >
        {rate ? formatRate(rate) : ''}
      </div>
    );
  }

  // Upcoming arrivals in the next 7 days
  const upcoming = bookings
    .filter(b => {
      if (b.status === 'cancelled' || b.status === 'no_show') return false;
      const ci = toDate(b.check_in_date);
      const diff = Math.floor((ci - today) / 86400000);
      return diff >= 0 && diff <= 6;
    })
    .sort((a, b) => toDate(a.check_in_date) - toDate(b.check_in_date));

  // List view sort — plain ascending-by-check-in-date (the API's default
  // order) puts day 1 of whatever month is selected at the very top
  // regardless of whether that's already weeks in the past, burying the
  // arrivals staff actually need next below a wall of old stays. Reorder
  // so today/upcoming (soonest first) always leads, with past stays
  // (most recent first) following after — the same "today is the
  // reference point" framing the calendar view already uses (it
  // auto-scrolls to today rather than starting at day 1).
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const upcomingList = listBookings.filter(b => b.check_in_date?.slice(0, 10) >= todayStr)
    .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date));
  const pastList = listBookings.filter(b => b.check_in_date?.slice(0, 10) < todayStr)
    .sort((a, b) => b.check_in_date.localeCompare(a.check_in_date));
  const sortedListBookings = [...upcomingList, ...pastList];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reservations</div>
          <div className="page-subtitle">
            {units.length} rooms{allTypes.length > 1 ? ` · ${allTypes.length} room types` : ''}
          </div>
        </div>
        <div>
          <Link to="/availability" className="btn btn-secondary"><Icon name="search" />Check availability</Link>
          <Link to="/reservations/new" className="btn btn-primary"><Icon name="plus" />New booking</Link>
        </div>
      </div>

      <div className="tab-bar">
        {[['calendar', 'Calendar'], ['list', 'List'], ['groups', 'Groups'], ['booked', 'Booked on', 'Reservations by the day they were made — e.g. how many we took today']].map(([k, l, hint]) => (
          <button key={k} type="button" className={`tab-bar-item${view === k ? ' active' : ''}`} onClick={() => setView(k)} title={hint}>{l}</button>
        ))}
        {(toCheckCount > 0 || namesWaiting > 0 || view === 'tocheck') && (
          <button type="button" className={`tab-bar-item${view === 'tocheck' ? ' active' : ''}`} onClick={() => setView('tocheck')}
            title="Bookings with points to look at (e.g. imported from the old system)">
            To check{toCheckCount > 0 && <span className="tab-count">{toCheckCount}</span>}
          </button>
        )}
      </div>

      {(view === 'calendar' || view === 'list') && (
        <div className="page-toolbar">
          <div className="date-nav">
            <button type="button" onClick={prevMonth} aria-label="Previous month" title={new Date(year, month - 2).toLocaleString('en', { month: 'long' })}><Icon name="chevronLeft" /></button>
            <span className="date-nav-label">{monthName} {year}</span>
            <button type="button" onClick={nextMonth} aria-label="Next month" title={new Date(year, month).toLocaleString('en', { month: 'long' })}><Icon name="chevronRight" /></button>
          </div>
          {(month !== today.getMonth() + 1 || year !== today.getFullYear()) && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMonth(today.getMonth() + 1); setYear(today.getFullYear()); }}>Today</button>
          )}

          {view === 'calendar' && allTypes.length > 1 && (
            <div style={{ position: 'relative' }}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setTypeMenuOpen(o => !o)}>
                {selTypes ? `${selTypes.size} of ${allTypes.length} room types` : 'All room types'}<Icon name="chevronDown" size={14} />
              </button>
              {typeMenuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setTypeMenuOpen(false)} />
                  <div className="card" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41, padding: 8, minWidth: 180, boxShadow: 'var(--shadow-md)' }}>
                    {[...allTypes].sort(typeComparator(units)).map(t => (
                      <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selTypes ? selTypes.has(t) : true} onChange={() => toggleType(t)} />
                        {t}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {view === 'calendar' && (
            <div className="page-toolbar-end">
              <div className="key-hint">
                {STATUS_LEGEND.slice(0, 4).map(l => (
                  <span key={l.label}><i className="key-swatch" style={{ background: l.bg }} />{l.label}</span>
                ))}
              </div>
              <div style={{ position: 'relative' }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ borderColor: 'transparent' }} onClick={() => setKeyOpen(o => !o)} aria-expanded={keyOpen}>
                  <Icon name="info" size={15} />Colour key
                </button>
                {keyOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setKeyOpen(false)} />
                    <div className="key-pop">
                      <h4>Status</h4>
                      <div className="key-grid">
                        {STATUS_LEGEND.map(l => (
                          <span key={l.label}>
                            <i className="key-swatch" style={{
                              background: l.diagonal ? 'linear-gradient(135deg, #FED7AA 50%, #F3F4F6 50%)' : l.bg,
                              border: l.dashed ? '1px dashed #9CA3AF' : undefined,
                            }} />{l.label}
                          </span>
                        ))}
                      </div>
                      <h4>Source (dot on the booking)</h4>
                      <div className="key-grid">
                        {sources.filter(s => s.is_active).map(s => (
                          <span key={s.id}><i className="key-dot" style={{ background: s.color || '#9CA3AF' }} />{s.label}</span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'calendar' ? (
        <>
          {/* Calendar grid — frozen header row + room-label column */}
          <div className="card mb-3" style={{ padding: 0 }}>
            <div className="cal-scroll" ref={calScrollRef}>
              <div className="cal-grid" style={{ gridTemplateColumns: gridTemplate }}>

                {/* header row */}
                <div className="cal-corner" />
                {dayArr.map(d => (
                  <div key={`h${d}`} className={`cal-dhdr${isToday(d) ? ' today' : ''}`}>
                    <span className="cal-dhdr-date">{d}</span>
                    <span className="cal-dhdr-dow">
                      {isToday(d) ? 'Today' : new Date(year, month - 1, d).toLocaleDateString('en', { weekday: 'short' })}
                    </span>
                  </div>
                ))}

                {/* groups */}
                {groups.map(g => {
                  const isCol = collapsed.has(g.type);
                  return (
                    <Fragment key={g.type}>
                      <button className="cal-group-hdr" onClick={() => toggleGroup(g.type)}>
                        <span className="cal-group-hdr-label">
                          <span style={{ display: 'inline-block', width: 10 }}>{isCol ? '▸' : '▾'}</span>
                          {g.type} ({g.list.length})
                        </span>
                      </button>
                      {!isCol && g.list.map(unit => (
                        <Fragment key={unit.id}>
                          <div className="cal-rowlabel">🏕 {unit.name}</div>
                          {dayArr.map(d => renderCell(getCellInfo(unit.id, d), unit.id, d))}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}

              </div>
            </div>
          </div>

          {/* Upcoming arrivals this week */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title" style={{ margin: 0 }}>Upcoming Arrivals This Week</div>
              <Link to="/reservations" className="btn btn-ghost btn-sm" onClick={() => setView('list')}>View All →</Link>
            </div>
            {upcoming.length === 0 && <p className="text-muted">No arrivals in the next 7 days</p>}
            {upcoming.map(b => (
              <div key={b.id} className="guest-row" style={{ marginBottom: 8 }} onClick={() => nav(`/reservations/${b.id}`)}>
                <div className="avatar avatar-md" style={{ background: avatarColor(b.guest_name), flexShrink: 0 }}>
                  {initials(b.guest_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{b.guest_name}<GroupTag groupId={b.reservation_group_id} nav={nav} /></div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {b.unit_name} · {b.check_in_date?.slice(0,10)} – {b.check_out_date?.slice(0,10)} · {b.num_guests} guest{b.num_guests > 1 ? 's' : ''} · {b.nights} night{b.nights > 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <SourceBadge sourceId={b.source} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Rp {Number(b.total_amount).toLocaleString('id-ID')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : view === 'groups' ? (
        <GroupsView nav={nav} />
      ) : view === 'booked' ? (
        <BookedView nav={nav} />
      ) : view === 'tocheck' ? (
        <ToCheckView nav={nav} onCount={setToCheckCount} />
      ) : (
        /* List view */
        <>
          <div className="card mb-3">
            <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
                <label className="form-label">Search guest</label>
                <input
                  className="form-input"
                  placeholder="Guest name…"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Status</label>
                <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Source</label>
                <select className="form-select" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
                  <option value="">All sources</option>
                  {sources.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">From</label>
                <input className="form-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">To</label>
                <input className="form-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              {hasActiveFilters && (
                <button className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>
              )}
              <button className="btn btn-secondary" onClick={exportGuestReportPdf} disabled={exportingPdf} style={{ marginLeft: 'auto' }}>
                {exportingPdf ? 'Generating…' : '⬇ Guest Report PDF'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guest</th><th>Unit</th><th>Check-in</th><th>Check-out</th>
                    <th>Nights</th><th>Source</th><th>Status</th><th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedListBookings.map((b, i) => {
                    const isDone      = b.status === 'checked_out';
                    const isCancelled = b.status === 'cancelled' || b.status === 'no_show';
                    // Divider right where the list crosses from today/upcoming
                    // into past stays, so the reordering (soonest-first, not
                    // strictly chronological) reads as deliberate, not broken.
                    const showPastDivider = i > 0 && i === upcomingList.length && pastList.length > 0;
                    return (
                      <Fragment key={b.id}>
                        {showPastDivider && (
                          <tr key="past-divider">
                            <td colSpan={8} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg-subtle, #f9fafb)', padding: '6px 12px' }}>
                              Past
                            </td>
                          </tr>
                        )}
                        <tr
                          style={{
                            cursor: 'pointer',
                            opacity: isCancelled ? 0.4 : isDone ? 0.6 : 1,
                            filter: isDone || isCancelled ? 'grayscale(0.4)' : 'none',
                          }}
                          onClick={() => nav(`/reservations/${b.id}`)}
                        >
                          <td style={{ fontWeight: 600 }}>
                            {b.guest_name}
                            <GroupTag groupId={b.reservation_group_id} nav={nav} />
                            {b.has_condition_notes && (
                              <span title="Has unit condition notes" style={{ marginLeft: 6, fontSize: 12, cursor: 'default' }}>📋</span>
                            )}
                          </td>
                          <td>{b.unit_name}</td>
                          <td>{b.check_in_date?.slice(0, 10)}</td>
                          <td>{b.check_out_date?.slice(0, 10)}</td>
                          <td>{b.nights}</td>
                          <td><SourceBadge sourceId={b.source} /></td>
                          <td><span className={`badge ${STATUS_BADGE[b.status] || 'badge-gray'}`}>{STATUS_LABELS[b.status] || b.status}</span></td>
                          <td style={{ fontWeight: 600 }}>Rp {Number(b.total_amount).toLocaleString('id-ID')}</td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  {listBookings.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                      {hasActiveFilters ? 'No bookings match this filter' : 'No bookings this month'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
