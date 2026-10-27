import { useState, useEffect, useCallback } from 'react';
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
import { OtaTodayBox } from '../components/OtaInbox';
import { NoteReminders } from '../components/StaffNotes';
import RegistrationCardModal from '../components/RegistrationCardModal';

// Today — front desk's one page for the day: the day's figures, what needs
// someone now, the live room board, and who arrives / stays / leaves with the
// Check in / Check out buttons (the same windows as Check-in / out). Another
// day (‹ ›) shows that day's guest lists, read-only, like Guest Lists.
// Lists from GET /api/bookings/guest-lists (the one rule every page uses);
// the buttons from /api/bookings/today/arrivals, /today/departures, /in-house.

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

  const canDesk = can('checkin_full');
  const canRes = can('reservations') && hasModule('reservations');
  const canLists = can('guest_lists') || canDesk || can('reservations');

  const load = useCallback(async () => {
    try {
      const reqs = [
        isToday ? api.get('/api/dashboard/summary').then(r => r.data) : Promise.resolve(null),
        canLists ? api.get('/api/bookings/guest-lists', { params: { date } }).then(r => r.data) : Promise.resolve(null),
      ];
      reqs.push(isToday && canDesk && hasModule('front_desk')
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
      reqs.push(isToday && hasModule('operations')
        ? api.get('/api/tasks').then(r => r.data.filter(t => t.type === 'guest_request' && t.status !== 'done')).catch(() => [])
        : Promise.resolve([]));
      const [s, l, m, gr] = await Promise.all(reqs);
      setSummary(s); setLists(l); setActions(m || new Map()); setGuestRequests(gr); setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load');
    }
  }, [date, isToday, canDesk, canLists, hasModule]);

  const { startCheckin, startCheckout, windows } = useCheckInOut({ onChanged: load });

  useEffect(() => {
    load();
    if (!isToday) return undefined;
    // Same pace as the Dashboard: the board follows housekeeping and the tablets.
    const id = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    const onVisible = () => { if (!document.hidden) load(); };
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

  const rows = lists ? (tab === 'in_house' ? lists.in_house : tab === 'departures' ? lists.departures : lists.arrivals) : [];
  const s = lists?.summary;
  const tabs = s ? [
    { id: 'arrivals', label: 'Arrivals', count: s.arrivals.rooms },
    { id: 'in_house', label: 'In house', count: s.in_house.rooms },
    { id: 'departures', label: 'Departures', count: s.departures.rooms },
    { id: 'kitchen', label: 'Kitchen', count: `breakfast ${s.breakfast_pax}` },
  ] : [];
  const kitchenLink = hasModule('pos_integration') && can('restaurant') ? '/restaurant?tab=kitchen' : can('guest_lists') ? '/guest-lists' : null;

  const listsCard = lists && (
    <div className="card today-lists-card">
      <div className="tab-bar today-tabs">
        {tabs.map(t => (
          <button key={t.id} type="button" className={`tab-bar-item${tab === t.id ? ' active' : ''}`} onClick={() => pickTab(t.id)}>
            {t.label} <span className="tab-count">{t.count}</span>
          </button>
        ))}
      </div>
      {tab === 'kitchen' ? (
        <div className="today-kitchen">
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-label">Breakfast this morning</div><div className="stat-value">{s.breakfast_pax}</div>
              <div className="stat-sub">guests{s.breakfast_kids ? ` + ${plural(s.breakfast_kids, 'kid')} free` : ''}</div></div>
            <div className="stat-card"><div className="stat-label">Dinner tonight</div><div className="stat-value">{s.dinner_pax}</div><div className="stat-sub">guests on half / full board</div></div>
          </div>
          {kitchenLink && <Link to={kitchenLink} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>Room by room for the kitchen →</Link>}
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
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="text-muted" style={{ padding: '18px 16px' }}>
              {tab === 'arrivals' ? 'No arrivals' : tab === 'in_house' ? 'Nobody staying over' : 'No departures'} {isToday ? 'today' : 'on this day'}.
            </div>
          ) : rows.map(r => (
            <GuestRow key={r.id} r={r} list={tab} action={actions.get(r.id)} canOpen={canRes}
              onCheckin={startCheckin} onCheckout={startCheckout} onRegCard={setRegCardFor} />
          ))}
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
        <TodaySection today={summary.today} occupancy={summary.occupancy} canLists={false} canReservations={canRes} />
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
      {isToday && (overdue.length > 0 || cleanAsked.length > 0 || notReady.length > 0) && (
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
        </div>
      )}
      {isToday && canDesk && hasModule('front_desk') && <LateArrivals lang="en" onRestored={load} />}
      {isToday && <OtaTodayBox />}
      {canRes && <NoteReminders date={date} title={isToday ? 'Reminders for today' : 'Reminders for this day'} />}

      {isToday ? (
        <div className="today-cols">
          <div className="card today-board">
            <div className="card-title">Live unit status</div>
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
