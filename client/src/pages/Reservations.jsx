import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { SourceBadge, useSettings } from '../context/SettingsContext';

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
  const calWrapRef          = useRef(null);

  useEffect(() => { api.get('/api/units').then(r => setUnits(r.data)); }, []);
  useEffect(() => {
    api.get(`/api/bookings?month=${month}&year=${year}`).then(r => setBookings(r.data));
    api.get(`/api/pricing/calendar?month=${month}&year=${year}`).then(r => setRates(r.data));
  }, [month, year]);

  // Scroll today into view at the left edge (cell = 72px + 2px gap = 74px per column)
  useEffect(() => {
    if (!calWrapRef.current) return;
    const isCurrentMonth = month === today.getMonth() + 1 && year === today.getFullYear();
    calWrapRef.current.scrollLeft = isCurrentMonth ? (today.getDate() - 1) * 74 : 0;
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
  const colTemplate = `130px repeat(${days}, 72px)`;

  function isToday(d) {
    return d === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();
  }

  function activeBookings() {
    return bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show');
  }

  function srcColor(sourceId) {
    return sources.find(s => s.id === sourceId)?.color || '#9CA3AF';
  }

  function getCellInfo(unitId, day) {
    const date = new Date(year, month - 1, day);
    const active = activeBookings();

    const checkout = active.find(b =>
      b.unit_id === unitId && toDate(b.check_out_date).getTime() === date.getTime()
    );
    const arrival = active.find(b =>
      b.unit_id === unitId && toDate(b.check_in_date).getTime() === date.getTime()
    );

    // Same-day checkout + check-in → split cell
    if (checkout && arrival) return { type: 'split', checkout, arrival };

    if (checkout) return { type: 'out', booking: checkout };

    const stay = active.find(b => {
      const ci = toDate(b.check_in_date);
      const co = toDate(b.check_out_date);
      return b.unit_id === unitId && date >= ci && date < co;
    });
    if (stay) return { type: 'stay', booking: stay, isCI: toDate(stay.check_in_date).getTime() === date.getTime() };

    return { type: 'avail' };
  }

  function renderCell(info, unitId, d) {
    const isT = isToday(d);
    const todayCls = isT ? ' today-col' : '';

    if (info.type === 'split') {
      const arrBg   = STATUS_BG[info.arrival.status]   || '#F3F4F6';
      const arrText = STATUS_TEXT[info.arrival.status]  || '#6B7280';
      const arrDot  = srcColor(info.arrival.source);
      const arrName = (isT ? '▶ ' : '') + (info.arrival.guest_name?.split(' ')[0] || '');
      return (
        <div
          key={d}
          className={`cal-cell${todayCls}`}
          style={{ position: 'relative', width: 72, flexShrink: 0, padding: 0, overflow: 'hidden', background: 'transparent' }}
          title={`↑ Out: ${info.checkout.guest_name}  |  ↓ In: ${info.arrival.guest_name}`}
        >
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, #FED7AA 50%, ${arrBg} 50%)`, borderRadius: 6 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, transparent calc(50% - 1.5px), white calc(50% - 1.5px), white calc(50% + 1.5px), transparent calc(50% + 1.5px))', borderRadius: 6 }} />
          <div style={{ position: 'absolute', top: 5, left: 5, fontSize: 9, fontWeight: 800, color: '#9A3412', lineHeight: 1, cursor: 'pointer', zIndex: 1 }}
            onClick={() => nav(`/reservations/${info.checkout.id}`)}>→ out</div>
          <div style={{ position: 'absolute', bottom: 5, right: 5, fontSize: 9, fontWeight: 800, color: arrText, lineHeight: 1, cursor: 'pointer', zIndex: 1, textAlign: 'right' }}
            onClick={() => nav(`/reservations/${info.arrival.id}`)}>
            {arrName}
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: arrDot, marginLeft: 'auto', marginTop: 2, border: '2px solid rgba(255,255,255,0.9)' }} />
          </div>
        </div>
      );
    }

    if (info.type === 'out') {
      const dd = String(d).padStart(2,'0'), mm = String(month).padStart(2,'0');
      const outDone = info.booking.status === 'checked_out';
      return (
        <div
          key={d}
          className={`cal-cell${todayCls}`}
          style={{ position: 'relative', width: 72, flexShrink: 0, padding: 0, overflow: 'hidden', background: 'transparent' }}
          title={`↑ Out: ${info.booking.guest_name}  |  Available from this date`}
        >
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #FED7AA 50%, #F3F4F6 50%)', borderRadius: 6 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, transparent calc(50% - 1.5px), white calc(50% - 1.5px), white calc(50% + 1.5px), transparent calc(50% + 1.5px))', borderRadius: 6 }} />
          <div style={{ position: 'absolute', top: 5, left: 5, fontSize: 9, fontWeight: 800, color: '#9A3412', lineHeight: 1, cursor: 'pointer', zIndex: 1, opacity: outDone ? 0.4 : 1 }}
            onClick={() => nav(`/reservations/${info.booking.id}`)}>→ out</div>
          <div style={{ position: 'absolute', bottom: 5, right: 5, fontSize: 9, fontWeight: 700, color: '#6B7280', lineHeight: 1, cursor: 'pointer', zIndex: 1 }}
            onClick={e => { e.stopPropagation(); nav(`/reservations/new?unit=${unitId}&date=${year}-${mm}-${dd}`); }}>+ new</div>
        </div>
      );
    }

    if (info.type === 'stay') {
      const bg   = STATUS_BG[info.booking.status]   || '#F3F4F6';
      const tc   = STATUS_TEXT[info.booking.status]  || '#6B7280';
      const dot  = srcColor(info.booking.source);
      const text = info.isCI ? (isT ? '▶ ' : '') + (info.booking.guest_name?.split(' ')[0] || '') : '';
      const doneStyle = info.booking.status === 'checked_out' ? { opacity: 0.4, filter: 'grayscale(0.6)' } : {};
      return (
        <div
          key={d}
          className={`cal-cell${todayCls}`}
          style={{ width: 72, flexShrink: 0, background: bg, color: tc, position: 'relative', ...doneStyle }}
          title={`${info.booking.guest_name} · ${STATUS_LABELS[info.booking.status] || info.booking.status} · ${sources.find(s => s.id === info.booking.source)?.label || info.booking.source}`}
          onClick={() => nav(`/reservations/${info.booking.id}`)}
        >
          <div style={{ position: 'absolute', top: 4, right: 4, width: 11, height: 11, borderRadius: '50%', background: dot, border: '2px solid rgba(255,255,255,0.9)', flexShrink: 0 }} />
          {text}
        </div>
      );
    }

    // Available
    const dd2 = String(d).padStart(2,'0'), mm2 = String(month).padStart(2,'0');
    const rate = rates[unitId]?.[d];
    return (
      <div
        key={d}
        className={`cal-cell avail${todayCls}`}
        style={{ width: 72, flexShrink: 0 }}
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
          <div className="page-subtitle">{monthName} {year} · {units.length} units · {view === 'calendar' ? 'Timeline view' : 'List view'}</div>
        </div>
        <Link to="/reservations/new" className="btn btn-primary">+ New Booking</Link>
      </div>

      <div className="flex gap-2 mb-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={prevMonth}>← {new Date(year, month - 2).toLocaleString('en', { month: 'short' })}</button>
        <button className="btn btn-ghost btn-sm" onClick={nextMonth}>{new Date(year, month).toLocaleString('en', { month: 'short' })} →</button>
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

          {/* Calendar grid */}
          <div className="card mb-3" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex' }}>

              {/* ── Frozen unit-label column ── */}
              <div style={{ flexShrink: 0, padding: '20px 12px 20px 20px', borderRight: '2px solid var(--border)', background: 'var(--white)', zIndex: 3 }}>
                <div style={{ height: 40 }} /> {/* spacer aligns with header row */}
                {units.map(unit => (
                  <div key={unit.id} className="cal-unit-label" style={{ height: 46, marginBottom: 2, boxShadow: 'none' }}>
                    🏕 {unit.name}
                  </div>
                ))}
              </div>

              {/* ── Scrollable day columns ── */}
              <div ref={calWrapRef} style={{ flex: 1, overflowX: 'auto', padding: '20px 20px 20px 8px' }}>
                {/* Header */}
                <div style={{ display: 'flex', gap: 2, marginBottom: 3, height: 40, alignItems: 'flex-end' }}>
                  {dayArr.map(d => (
                    <div key={d} className={`cal-day-hdr${isToday(d) ? ' today' : ''}`} style={{ width: 72, flexShrink: 0 }}>
                      {isToday(d) ? <><span>{d} ◀</span><br /><span style={{ fontWeight: 400 }}>Today</span></> : d}
                    </div>
                  ))}
                </div>
                {/* Rows */}
                {units.map(unit => (
                  <div key={unit.id} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
                    {dayArr.map(d => renderCell(getCellInfo(unit.id, d), unit.id, d))}
                  </div>
                ))}
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
