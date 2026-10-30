import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyToday, propertyClock } from '../lib/propertyTime';
import DateNav from '../components/DateNav';
import Icon from '../components/Icon';
import { TodaySection } from '../components/DashboardSections';
import UnitStatusBoard, { cleanAskedText } from '../components/UnitStatusBoard';
import { useCheckInOut } from '../components/CheckInOutWindows';
import LateArrivals from '../components/LateArrivals';
import { useOtaToday } from '../components/OtaInbox';
import { NoteReminders } from '../components/StaffNotes';
import RegistrationCardModal from '../components/RegistrationCardModal';

// Today — front desk's one page for the day: the day's figures, what needs
// someone now, the live room board, and who arrives / stays / leaves with the
// Check in / Check out buttons (the same windows as Check-in / out). Another
// day (‹ ›) shows that day's guest lists, read-only, like Guest Lists.
// Lists from GET /api/bookings/guest-lists (the one rule every page uses);
// the buttons from /api/bookings/today/arrivals, /today/departures, /in-house.
// A group's arrivals sit under one header with Check in whole group (the
// Check-in / out page's POST /api/checkin/group/:id/start). Balance due is
// the Guest Lists tab's list (/api/bookings/balance-due), shortened. Each
// list has "Full page" to Check-in / out or Guest Lists for a busy day.

// Rows of a group (2+ rooms in this list) folded under one item, in the order
// their first room appears.
function clusterByGroup(list) {
  const counts = new Map();
  for (const r of list) if (r.reservation_group_id) counts.set(r.reservation_group_id, (counts.get(r.reservation_group_id) || 0) + 1);
  const out = []; const seen = new Set();
  for (const r of list) {
    const g = r.reservation_group_id;
    if (g && counts.get(g) > 1) {
      if (seen.has(g)) continue;
      seen.add(g);
      out.push({ type: 'group', groupId: g, rows: list.filter(x => x.reservation_group_id === g) });
    } else out.push({ type: 'single', row: r });
  }
  return out;
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function fmtIDR(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }
function addDays(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
function fmtShort(ymd) { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtLong(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); }

async function downloadPdf(url, params, filename) {
  const r = await api.get(url, { params, responseType: 'blob' });
  const href = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = href; a.download = filename; a.click();
  window.URL.revokeObjectURL(href);
}

// One line in a list: room, guest, what's left to do, and the button.
function GuestRow({ r, list, action, canOpen, onCheckin, onCheckout, onRegCard }) {
  const done = r.status === 'checked_out' || (list === 'arrivals' && r.status === 'checked_in');
  const state = r.late_arrival ? { text: `Late · was due ${fmtShort(r.check_in_date)}`, cls: 'badge-red' }
    : r.status === 'checked_out' ? { text: 'Checked out', cls: 'badge-gray' }
    : r.status === 'checked_in' ? { text: list === 'arrivals' ? 'Arrived' : list === 'departures' ? 'Due out' : 'In house', cls: list === 'departures' ? 'badge-amber' : 'badge-green' }
    : { text: list === 'arrivals' ? 'Expected' : 'Not checked in', cls: 'badge-blue' };
  const due = parseFloat(r.balance_due) || 0;
  const sub = [r.unit_type, `${r.num_guests}${r.children ? `+${r.children}` : ''} pax`, `${r.nights} night${r.nights === 1 ? '' : 's'}`, r.rate_plan_code, r.source_label, r.nationality].filter(Boolean).join(' · ');
  return (
    <div className={`today-row${done ? ' done' : ''}`}>
      <div className="today-row-room">{r.unit_name}</div>
      <div className="today-row-guest">
        <div>
          {canOpen ? <Link to={`/reservations/${r.id}`} className="today-row-name">{r.guest_name}</Link> : <span className="today-row-name">{r.guest_name}</span>}
          <span className={`badge ${state.cls}`} style={{ marginLeft: 6 }}>{state.text}</span>
        </div>
        <div className="text-muted today-row-sub">{sub}</div>
        {list === 'arrivals' && r.status !== 'checked_in' && r.housekeeping_status === 'dirty' && (
          <div className="today-row-warn">Room not cleaned yet</div>
        )}
        {r.special_requests && <div className="today-row-req">{r.special_requests}</div>}
      </div>
      <div className="today-row-money">
        {due > 0 ? <span style={{ color: 'var(--danger-text)', fontWeight: 600 }}>{fmtIDR(due)}{r.is_ota && <span className="text-muted" style={{ fontWeight: 400 }}> (OTA)</span>}</span>
          : r.group_billed ? <span className="badge badge-gray" title="The room is on the group's bill — see Balance due or the group page">Group bill</span>
          : <span className="badge badge-green">Paid</span>}
      </div>
      <div className="today-row-actions">
        {list === 'arrivals' && r.status !== 'checked_in' && r.status !== 'checked_out' && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => onRegCard(r.id)}>Reg. card</button>
        )}
        {list === 'arrivals' && action?.kind === 'in' && <button type="button" className="btn btn-sm btn-primary" onClick={() => onCheckin(action.row)}>Check in</button>}
        {list !== 'arrivals' && action?.kind === 'out' && <button type="button" className="btn btn-sm btn-primary" onClick={() => onCheckout(action.row)}>Check out</button>}
      </div>
    </div>
  );
}

const LISTS_EVERY_MS = 60_000;

export default function Today() {
  const navigate = useNavigate();
  const { can, hasModule } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = propertyToday();
  const date = params.get('date') || today;
  const isToday = date === today;
  const [tab, setTab] = useState(params.get('tab') || 'arrivals');

  const [summary, setSummary] = useState(null);   // /api/dashboard/summary — figures, board, alerts
  const [lists, setLists] = useState(null);       // /api/bookings/guest-lists
  const [actions, setActions] = useState(new Map()); // booking id → { kind: 'in' | 'out', row }
  const [guestRequests, setGuestRequests] = useState([]);
  const [error, setError] = useState('');
  const [regCardFor, setRegCardFor] = useState(null);
  const [busy, setBusy] = useState('');
  const [balance, setBalance] = useState(null);       // /api/bookings/balance-due, loaded on its tab
  const [groupBusy, setGroupBusy] = useState(null);
  const [groupResult, setGroupResult] = useState(null);

  const canDesk = can('checkin_full');
  const canRes = can('reservations') && hasModule('reservations');
  const canLists = can('guest_lists') || canDesk || can('reservations');
  // Plain values: hasModule itself is a new function whenever the login context
  // changes, which would run load again when the module list arrives.
  const hasDesk = hasModule('front_desk');
  const hasOps = hasModule('operations');
  const loadSeq = useRef(0);
  const loading = useRef(false);
  const listsAt = useRef(0);

  // The lists work out every room's balance, so a background refresh takes them
  // once a minute; the board and alerts keep the 15-second pace. An action
  // (no `background`) always reloads everything at once.
  const load = useCallback(async ({ background = false } = {}) => {
    if (background && loading.current) return;
    const withLists = !background || Date.now() - listsAt.current >= LISTS_EVERY_MS;
    const seq = ++loadSeq.current;
    loading.current = true;
    try {
      const reqs = [
        isToday ? api.get('/api/dashboard/summary').then(r => r.data) : Promise.resolve(null),
        withLists && canLists ? api.get('/api/bookings/guest-lists', { params: { date } }).then(r => r.data) : Promise.resolve(null),
      ];
      reqs.push(withLists && isToday && canDesk && hasDesk
        ? Promise.all([
          api.get('/api/bookings/today/arrivals'), api.get('/api/bookings/today/departures'), api.get('/api/bookings/in-house'),
        ]).then(([a, d, h]) => {
          const m = new Map();
          for (const row of a.data) m.set(row.id, { kind: 'in', row });
          for (const row of [...h.data, ...d.data]) m.set(row.id, { kind: 'out', row });
          return m;
        })
        : Promise.resolve(null));
      // Do Not Disturb is an open guest_request task — the board shows it on the tile.
      reqs.push(isToday && hasOps
        ? api.get('/api/tasks', { params: { type: 'guest_request' } }).then(r => r.data.filter(t => t.status !== 'done')).catch(() => [])
        : Promise.resolve([]));
      const [s, l, m, gr] = await Promise.all(reqs);
      if (seq !== loadSeq.current) return; // the date changed or an action reloaded meanwhile
      setSummary(s); setGuestRequests(gr); setError('');
      if (withLists) { setLists(l); setActions(m || new Map()); listsAt.current = Date.now(); }
    } catch (err) {
      if (seq === loadSeq.current) setError(err.response?.data?.error || 'Failed to load');
    } finally {
      if (seq === loadSeq.current) loading.current = false;
    }
  }, [date, isToday, canDesk, canLists, hasDesk, hasOps]);

  const { startCheckin, startCheckout, windows } = useCheckInOut({ onChanged: load });

  useEffect(() => {
    if (tab !== 'balance' || !canDesk) return;
    setBalance(null);
    api.get('/api/bookings/balance-due', { params: { date } }).then(r => setBalance(r.data)).catch(() => setBalance({ error: true }));
  }, [tab, date, canDesk]);

  async function checkInGroup(groupId) {
    setGroupBusy(groupId); setGroupResult(null);
    try {
      const r = await api.post(`/api/checkin/group/${groupId}/start`);
      setGroupResult({ groupId, ...r.data });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to check in the group');
    } finally { setGroupBusy(null); }
  }

  useEffect(() => {
    load();
    if (!isToday) return undefined;
    // Same pace as the Dashboard: the board follows housekeeping and the tablets.
    const id = setInterval(() => { if (!document.hidden) load({ background: true }); }, 15_000);
    const onVisible = () => { if (!document.hidden) load({ background: true }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, isToday]);

  function goDate(d) {
    const next = new URLSearchParams(params);
    if (d === today) next.delete('date'); else next.set('date', d);
    setParams(next, { replace: true });
  }
  function pickTab(t) {
    setTab(t);
    const next = new URLSearchParams(params); next.set('tab', t); setParams(next, { replace: true });
  }

  async function markClean(unitId) {
    try { await api.post(`/api/housekeeping/rooms/${unitId}/clean`); load(); } catch { /* the board shows the state on the next load */ }
  }
  async function download(kind) {
    setBusy(kind);
    try {
      if (kind === 'cards') await downloadPdf('/api/checkin/registration-cards', { date }, `registration-cards-${date}.pdf`);
      else await downloadPdf('/api/bookings/guest-lists/pdf', { date }, `guest-lists-${date}.pdf`);
    } catch (err) {
      alert(err.response?.status === 404 ? 'No arrivals on this day.' : 'Download failed');
    } finally { setBusy(''); }
  }

  const units = summary?.occupancy?.units || [];
  const cleanAsked = units.filter(u => u.clean_request_at);
  const notReady = units.filter(u => u.arriving_booking_id && u.housekeeping_status === 'dirty' && u.status !== 'occupied');
  const overdue = summary?.overdue_checkouts || [];
  // Stays already over that never checked in, and today's OTA news — one line each in Needs you now.
  const neverArrived = summary?.today?.never_arrived || [];
  const ota = useOtaToday();
  const otaActive = ota && (ota.new + ota.changed + ota.cancelled + ota.needs) > 0;

  const rows = lists ? (tab === 'in_house' ? lists.in_house : tab === 'departures' ? lists.departures : lists.arrivals) : [];
  const s = lists?.summary;
  const tabs = s ? [
    { id: 'arrivals', label: 'Arrivals', count: s.arrivals.rooms },
    { id: 'in_house', label: 'In house', count: s.in_house.rooms },
    { id: 'departures', label: 'Departures', count: s.departures.rooms },
    { id: 'kitchen', label: 'Kitchen', count: `breakfast ${s.breakfast_pax}` },
    canDesk && { id: 'balance', label: 'Balance due', count: null },
  ].filter(Boolean) : [];
  const dateQ = isToday ? '' : `date=${date}`;
  const listsPage = (t) => (can('guest_lists') || canDesk ? `/guest-lists?${[dateQ, t && `tab=${t}`].filter(Boolean).join('&')}` : null);
  const kitchenLink = hasModule('pos_integration') ? (can('restaurant') ? '/restaurant?tab=kitchen' : null) : listsPage('kitchen');
  // The bigger screen for a busy day: Check-in / out (today, with the buttons) or Guest Lists.
  const fullPage = isToday && canDesk && hasModule('front_desk') ? { to: '/checkin', label: 'Check-in / out' } : listsPage() && { to: listsPage(), label: 'Guest Lists' };
  const owing = balance && !balance.error
    ? ['overdue', 'departing', 'staying'].flatMap(sec => (balance[sec] || []).map(r => ({ ...r, section: sec }))) : [];

  const row = r => (
    <GuestRow key={r.id} r={r} list={tab} action={actions.get(r.id)} canOpen={canRes}
      onCheckin={startCheckin} onCheckout={startCheckout} onRegCard={setRegCardFor} />
  );
  const groupBlock = item => {
    const first = item.rows[0];
    const canGroup = isToday && canDesk && hasModule('front_desk') && item.rows.some(r => actions.get(r.id)?.kind === 'in');
    const res = groupResult?.groupId === item.groupId ? groupResult : null;
    return (
      <div key={item.groupId} className="today-group">
        <div className="today-group-head">
          <div>
            <span className="today-group-name">👥 {canRes ? <Link to={`/reservations/group/${item.groupId}`}>{first.group_booker || first.guest_name}</Link> : (first.group_booker || first.guest_name)}</span>
            <span className="text-muted"> · {plural(item.rows.length, 'room')} · {plural(item.rows.reduce((n, r) => n + (r.num_guests || 0), 0), 'guest')}</span>
            {res && <div className={`today-group-result${res.failed > 0 ? ' warn' : ''}`}>{res.succeeded} of {res.attempted} rooms checked in{res.failed > 0 && ` — ${res.failed} not: ${[...new Set(res.results.filter(x => !x.ok).map(x => x.error))].join(' · ')}`}</div>}
          </div>
          {canGroup && (
            <button type="button" className="btn btn-sm btn-primary" disabled={groupBusy === item.groupId} onClick={() => checkInGroup(item.groupId)}>
              {groupBusy === item.groupId ? 'Checking in…' : 'Check in whole group'}
            </button>
          )}
        </div>
        {item.rows.map(row)}
      </div>
    );
  };

  const listsCard = lists && (
    <div className="card today-lists-card">
      <div className="tab-bar today-tabs">
        {tabs.map(t => (
          <button key={t.id} type="button" className={`tab-bar-item${tab === t.id ? ' active' : ''}`} onClick={() => pickTab(t.id)}>
            {t.label}{t.count != null && <> <span className="tab-count">{t.count}</span></>}
          </button>
        ))}
      </div>
      {tab === 'balance' ? (
        <div className="today-balance">
          {!balance ? <div className="text-muted" style={{ padding: 16 }}>Loading…</div>
            : balance.error ? <div className="text-muted" style={{ padding: 16 }}>Could not load the balances.</div> : (<>
            <div className="today-list-tools">
              <span style={{ fontSize: 13 }}>
                To collect from guests leaving <b style={{ color: 'var(--danger-text)' }}>{fmtIDR(balance.totals.departing + balance.totals.overdue)}</b>
                <span className="text-muted"> · all owing {fmtIDR(balance.totals.all)}</span>
              </span>
              {listsPage('balance') && <Link to={listsPage('balance')} className="btn btn-sm btn-secondary">Full page →</Link>}
            </div>
            {owing.length === 0 ? <div className="text-muted" style={{ padding: '18px 16px' }}>Nobody owes anything.</div> : owing.map(r => (
              <div key={r.id || `g${r.group_id}`} className="today-row">
                <div className="today-row-room">{r.is_group ? 'Group' : r.unit_name}</div>
                <div className="today-row-guest">
                  <div className="today-row-name">{r.is_group && '👥 '}{r.guest_name}</div>
                  <div className="text-muted today-row-sub">
                    {r.is_group && `Rooms ${r.unit_name.replace(/^Group · /, '')} · `}
                    {r.section === 'overdue' ? 'Overdue — still checked in' : r.section === 'departing' ? 'Leaving' : 'Staying'} · out {fmtShort(r.check_out_date)}
                    {r.is_group ? ' · group bill' : r.agent_billed ? ' · billed to agent' : r.is_ota ? ' · OTA' : ''}
                  </div>
                </div>
                <div className="today-row-money">
                  <span style={{ color: r.agent_billed ? 'var(--text-muted)' : 'var(--danger-text)', fontWeight: 600 }}>{fmtIDR(r.balance_due)}</span>
                </div>
                <div className="today-row-actions">
                  {r.is_group
                    ? <Link to={`/reservations/group/${r.group_id}`} className="btn btn-sm btn-secondary">Group</Link>
                    : !r.agent_billed && <Link to={`/reservations/${r.id}#record-payment`} className="btn btn-sm btn-secondary">Record payment</Link>}
                </div>
              </div>
            ))}
          </>)}
        </div>
      ) : tab === 'kitchen' ? (
        <div className="today-kitchen">
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-label">Breakfast this morning</div><div className="stat-value">{s.breakfast_pax}</div>
              <div className="stat-sub">guests{s.breakfast_kids ? ` + ${plural(s.breakfast_kids, 'kid')} free` : ''}</div></div>
            <div className="stat-card"><div className="stat-label">Dinner tonight</div><div className="stat-value">{s.dinner_pax}</div><div className="stat-sub">guests on half / full board</div></div>
          </div>
          {kitchenLink && <Link to={kitchenLink} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>Full page — room by room for the kitchen →</Link>}
        </div>
      ) : (
        <>
          <div className="today-list-tools">
            <span className="text-muted" style={{ fontSize: 13 }}>
              {tab === 'arrivals' ? plural(s.arrivals.pax, 'guest') : tab === 'in_house' ? `${plural(s.in_house.pax, 'guest')} staying over` : plural(s.departures.pax, 'guest')}
            </span>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {tab === 'arrivals' && s.arrivals.rooms > 0 && (
                <button type="button" className="btn btn-sm btn-secondary" disabled={busy === 'cards'} onClick={() => download('cards')}>
                  <Icon name="download" />{busy === 'cards' ? 'Preparing…' : 'Print all arrival cards'}
                </button>
              )}
              <button type="button" className="btn btn-sm btn-secondary" disabled={busy === 'lists'} onClick={() => download('lists')}>
                <Icon name="download" />{busy === 'lists' ? 'Preparing…' : 'Guest lists PDF'}
              </button>
              {fullPage && <Link to={fullPage.to} className="btn btn-sm btn-secondary" title={`Open ${fullPage.label} — a bigger screen for a busy day`}>Full page →</Link>}
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="text-muted" style={{ padding: '18px 16px' }}>
              {tab === 'arrivals' ? 'No arrivals' : tab === 'in_house' ? 'Nobody staying over' : 'No departures'} {isToday ? 'today' : 'on this day'}.
            </div>
          ) : tab === 'arrivals'
            ? clusterByGroup(rows).map(item => (item.type === 'group' ? groupBlock(item) : row(item.row)))
            : rows.map(row)}
          {!isToday && <div className="text-muted" style={{ fontSize: 12, padding: '10px 16px' }}>Another day: the guests booked for {fmtLong(date)}. Check in and check out happen on today's page.</div>}
        </>
      )}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Today</div>
          <div className="page-subtitle">{isToday ? propertyClock() : fmtLong(date)} — who arrives, who stays, who leaves, and what needs you</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {listsPage() && <Link to={listsPage()} className="btn btn-secondary"><Icon name="book" />Guest Lists</Link>}
          {canRes && <button type="button" className="btn btn-secondary" onClick={() => navigate('/availability')}><Icon name="search" />Check availability</button>}
          {canRes && <button type="button" className="btn btn-primary" onClick={() => navigate('/reservations/new')}><Icon name="plus" />New booking</button>}
        </div>
      </div>

      <div className="page-toolbar">
        <DateNav value={date} onChange={goDate} onPrev={() => goDate(addDays(date, -1))} onNext={() => goDate(addDays(date, 1))}
          today={today} onToday={() => goDate(today)} />
      </div>

      {error && <div className="alert alert-error"><div>{error}</div></div>}

      {isToday && summary && (
        <TodaySection today={summary.today} occupancy={summary.occupancy} canLists={false} canReservations={canRes} hideNeverArrived />
      )}
      {!isToday && s && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">Arriving</div><div className="stat-value">{s.arrivals.rooms}</div><div className="stat-sub">{plural(s.arrivals.pax, 'guest')}</div></div>
          <div className="stat-card"><div className="stat-label">Staying over</div><div className="stat-value">{s.in_house.rooms}</div><div className="stat-sub">{plural(s.in_house.pax, 'guest')}</div></div>
          <div className="stat-card"><div className="stat-label">Departing</div><div className="stat-value">{s.departures.rooms}</div><div className="stat-sub">{plural(s.departures.pax, 'guest')}</div></div>
          <div className="stat-card"><div className="stat-label">Breakfast</div><div className="stat-value">{s.breakfast_pax}</div><div className="stat-sub">that morning</div></div>
        </div>
      )}

      {/* ── Needs you now — what used to be the Dashboard's banners (never-arrived
           bookings are already flagged by TodaySection) ── */}
      {isToday && (overdue.length > 0 || cleanAsked.length > 0 || notReady.length > 0 || neverArrived.length > 0 || otaActive) && (
        <div className="card today-needs">
          <div className="card-title">Needs you now</div>
          {overdue.map(o => (
            <div key={`o${o.id}`} className="today-need danger">
              <span className="today-need-tag">Overdue</span>
              <span className="today-need-text"><b>{o.unit_name}</b> · {o.guest_name} — was due out {fmtShort(o.check_out_date)}, still checked in. Check out, or Amend Dates if they stay on.
                {o.balance_due > 0 && <> <b>{fmtIDR(o.balance_due)} unpaid.</b></>}</span>
              {actions.get(o.id)?.kind === 'out'
                ? <button type="button" className="btn btn-sm btn-secondary" onClick={() => startCheckout(actions.get(o.id).row)}>Check out</button>
                : canRes && <Link to={`/reservations/${o.id}`} className="btn btn-sm btn-secondary">Open</Link>}
            </div>
          ))}
          {cleanAsked.map(u => (
            <div key={`c${u.id}`} className="today-need warn">
              <span className="today-need-tag">Clean asked</span>
              <span className="today-need-text">Room <b>{u.name}</b> — clean {cleanAskedText(u)}</span>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => markClean(u.id)}>Mark clean</button>
            </div>
          ))}
          {notReady.map(u => (
            <div key={`n${u.id}`} className="today-need warn">
              <span className="today-need-tag">Room not ready</span>
              <span className="today-need-text">Room <b>{u.name}</b> is still to clean — {u.arriving_guest_name} arrives today.</span>
              {hasModule('operations') && can('operations') && <Link to="/housekeeping" className="btn btn-sm btn-secondary">Housekeeping</Link>}
            </div>
          ))}
          {otaActive && (
            <div className={`today-need ${ota.needs > 0 ? 'danger' : 'info'}`}>
              <span className="today-need-tag">OTAs today</span>
              <span className="today-need-text">
                {[ota.new && `${ota.new} new`, ota.changed && `${ota.changed} changed`, ota.cancelled && `${ota.cancelled} cancelled`].filter(Boolean).join(' · ') || 'Nothing new'}
                {ota.needs > 0 && <b> · {ota.needs} need{ota.needs === 1 ? 's' : ''} you</b>}
              </span>
              {canRes && <Link to="/reservations?view=ota" className="btn btn-sm btn-secondary">Open</Link>}
            </div>
          )}
          {neverArrived.length > 0 && (
            <div className="today-need warn">
              <span className="today-need-tag">Never arrived</span>
              <span className="today-need-text"><b>{plural(neverArrived.length, 'stay')}</b> already over but never checked in — mark no-show or cancel; until then they count as sold.</span>
              {(can('guest_lists') || canDesk) && <Link to="/guest-lists" className="btn btn-sm btn-secondary">See the list</Link>}
            </div>
          )}
        </div>
      )}
      {isToday && canDesk && hasModule('front_desk') && <LateArrivals lang="en" onRestored={load} />}
      {canRes && <NoteReminders date={date} title={isToday ? 'Reminders for today' : 'Reminders for this day'} />}

      {isToday ? (
        <div className="today-cols">
          <div className="card today-board">
            <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Live unit status</h2>
            {summary && <UnitStatusBoard units={units} guestRequests={guestRequests} onChanged={load} />}
          </div>
          <div className="today-lists">{listsCard}</div>
        </div>
      ) : listsCard}

      {windows}
      {regCardFor && <RegistrationCardModal bookingId={regCardFor} onClose={() => setRegCardFor(null)} />}
    </div>
  );
}
