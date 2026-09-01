import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { SourceBadge, useSettings } from '../context/SettingsContext';

const TYPE_ORDER = ['Villa', 'Suite', 'Glamping', 'Deluxe'];
function typeRank(t) {
  const i = TYPE_ORDER.findIndex(x => (t || '').includes(x));
  return i === -1 ? 99 : i;
}
function groupUnitsByType(units) {
  const m = new Map();
  for (const u of units) {
    const k = u.type || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(u);
  }
  return [...m.entries()]
    .map(([type, list]) => ({
      type,
      list: list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.type.localeCompare(b.type));
}
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
  const [view, setView]     = useState('calendar');
  const calScrollRef        = useRef(null);

  // Room-type filter (calendar only). null = all types.
  const [selTypes, setSelTypes] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('resv-cal-types')); return Array.isArray(s) && s.length ? new Set(s) : null; }
    catch { return null; }
  });
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());

  useEffect(() => { api.get('/api/units').then(r => setUnits(r.data)); }, []);
  useEffect(() => {
    api.get(`/api/bookings?month=${month}&year=${year}`).then(r => setBookings(r.data));
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
    for (const b of bookings) {
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      const rec = { ...b, _ci: toDate(b.check_in_date).getTime(), _co: toDate(b.check_out_date).getTime() };
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
    if (stay) return { type: 'stay', booking: stay, isCI: stay._ci === t };
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
      const bg   = STATUS_BG[info.booking.status]   || '#F3F4F6';
      const tc   = STATUS_TEXT[info.booking.status]  || '#6B7280';
      const dot  = srcColor(info.booking.source);
      const text = info.isCI ? (isT ? '▶' : '') + (info.booking.guest_name?.split(' ')[0] || '') : '';
      const doneStyle = info.booking.status === 'checked_out' ? { opacity: 0.4, filter: 'grayscale(0.6)' } : {};
      return (
        <div
          key={key}
          className={`cal-cell${todayCls}`}
          style={{ background: bg, color: tc, ...doneStyle }}
          title={`${info.booking.guest_name} · ${STATUS_LABELS[info.booking.status] || info.booking.status} · ${sources.find(s => s.id === info.booking.source)?.label || info.booking.source}`}
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

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reservations</div>
          <div className="page-subtitle">
            {monthName} {year} · {selTypes && view === 'calendar' ? `${visibleUnits.length}/${units.length}` : units.length} units · {view === 'calendar' ? 'Timeline view' : 'List view'}
          </div>
        </div>
        <Link to="/reservations/new" className="btn btn-primary">+ New Booking</Link>
      </div>

      <div className="flex gap-2 mb-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={prevMonth}>← {new Date(year, month - 2).toLocaleString('en', { month: 'short' })}</button>
        <button className="btn btn-ghost btn-sm" onClick={nextMonth}>{new Date(year, month).toLocaleString('en', { month: 'short' })} →</button>

        {view === 'calendar' && allTypes.length > 1 && (
          <div style={{ position: 'relative' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setTypeMenuOpen(o => !o)}>
              {selTypes ? `${selTypes.size} type${selTypes.size !== 1 ? 's' : ''}` : 'All types'} ▾
            </button>
            {typeMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setTypeMenuOpen(false)} />
                <div className="card" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41, padding: 8, minWidth: 160, boxShadow: 'var(--shadow-md)' }}>
                  {[...allTypes].sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b)).map(t => (
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

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${view === 'calendar' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('calendar')}>Calendar</button>
          <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('list')}>List</button>
        </div>
      </div>

      {view === 'calendar' ? (
        <>
          {/* Legend */}
          <div className="flex gap-3 mb-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status:</span>
            {STATUS_LEGEND.map(l => (
              <div key={l.label} className="flex gap-2" style={{ alignItems: 'center' }}>
                <div style={{
                  width: 14, height: 14, borderRadius: 3,
                  background: l.diagonal ? 'linear-gradient(135deg, #FED7AA 50%, #F3F4F6 50%)' : l.bg,
                  border: l.dashed ? '1px dashed #9CA3AF' : '1px solid rgba(0,0,0,0.08)',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{l.label}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mb-3" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source:</span>
            {sources.filter(s => s.is_active).map(s => (
              <div key={s.id} className="flex gap-2" style={{ alignItems: 'center' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: s.color || '#9CA3AF', border: '1.5px solid rgba(0,0,0,0.12)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Calendar grid — frozen header row + room-label column */}
          <div className="card mb-3" style={{ padding: 0 }}>
            <div className="cal-scroll" ref={calScrollRef}>
              <div className="cal-grid" style={{ gridTemplateColumns: gridTemplate }}>

                {/* header row */}
                <div className="cal-corner" />
                {dayArr.map(d => (
                  <div key={`h${d}`} className={`cal-dhdr${isToday(d) ? ' today' : ''}`}>
                    {isToday(d) ? <><b>{d}</b><br /><span style={{ fontWeight: 400, fontSize: 8 }}>Today</span></> : d}
                  </div>
                ))}

                {/* groups */}
                {groups.map(g => {
                  const isCol = collapsed.has(g.type);
                  return (
                    <Fragment key={g.type}>
                      <button className="cal-group-hdr" onClick={() => toggleGroup(g.type)}>
                        <span style={{ display: 'inline-block', width: 10 }}>{isCol ? '▸' : '▾'}</span>
                        {g.type} ({g.list.length})
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
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{b.guest_name}</div>
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
      ) : (
        /* List view */
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
                {bookings.map(b => {
                  const isDone      = b.status === 'checked_out';
                  const isCancelled = b.status === 'cancelled' || b.status === 'no_show';
                  return (
                    <tr
                      key={b.id}
                      style={{
                        cursor: 'pointer',
                        opacity: isCancelled ? 0.4 : isDone ? 0.6 : 1,
                        filter: isDone || isCancelled ? 'grayscale(0.4)' : 'none',
                      }}
                      onClick={() => nav(`/reservations/${b.id}`)}
                    >
                      <td style={{ fontWeight: 600 }}>
                        {b.guest_name}
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
                  );
                })}
                {bookings.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No bookings this month</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
