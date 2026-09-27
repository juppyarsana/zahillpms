import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { fmtYmd } from '../lib/propertyTime';

// Dashboard sections, top to bottom by time: Today (everyone) → … → This
// Month (owner or the month_summary permission). Numbers come from the
// server's shared definitions — Guest Lists for who's here, bookingPickup for
// reservations made, the Reports page's getReport for money — so they match
// Guest Lists, Reservations "Booked on", Reports and the emailed reports.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
// Rp 12.4M / Rp 850K — for tight boxes; the exact figure is in the tooltip.
function fmtShortIDR(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1e3) return `Rp ${Math.round(v / 1e3)}K`;
  return `Rp ${v}`;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function SectionHeading({ title, sub, right }) {
  return (
    <div className="dash-section-head">
      <div>
        <span className="dash-section-title">{title}</span>
        {sub && <span className="dash-section-sub">{sub}</span>}
      </div>
      {right}
    </div>
  );
}

// One box. `to` makes the whole box a link.
function Box({ label, value, children, to, title, accent }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="today-box-lines">{children}</div>
    </>
  );
  return to
    ? <Link to={to} className="stat-card today-box today-box-link" title={title}>{body}</Link>
    : <div className="stat-card today-box" title={title}>{body}</div>;
}

// Today: totals fixed for the whole day, progress inside ("12 arrived · 16 to
// come"), and Arriving + Staying over (+ overdue) = Tonight, visibly.
export function TodaySection({ today, occupancy, canLists, canReservations }) {
  if (!today) return null;
  const { arriving, staying, departing, tonight, made, tomorrow } = today;
  const lists = canLists ? '/guest-lists' : undefined;
  const oos = occupancy?.out_of_order || 0;
  return (
    <>
      <div className="today-strip">
        <Box label="Arriving" value={plural(arriving.rooms, 'room')} to={lists}
          title="Every booking arriving today — whether already checked in or not — plus late arrivals from earlier days who haven't come yet.">
          <div>{plural(arriving.guests, 'guest')}</div>
          {arriving.rooms > 0 && (
            <div>
              <b style={{ color: arriving.arrived ? '#15803D' : undefined }}>{arriving.arrived} arrived</b> · {arriving.to_come} to come
              {arriving.late > 0 && <span style={{ color: '#B91C1C' }}> ({arriving.late} late)</span>}
            </div>
          )}
        </Box>

        <Box label="Staying over" value={plural(staying.rooms, 'room')} to={lists}
          title="Checked in before today and leaving after today.">
          <div>{plural(staying.guests, 'guest')}</div>
        </Box>

        <Box label="Departing" value={plural(departing.rooms, 'room')} to={lists}
          title="Due out today, plus guests still checked in past their check-out date (overdue).">
          <div>{plural(departing.guests, 'guest')}</div>
          {departing.rooms > 0 && (
            <div>
              <b style={{ color: departing.out ? '#15803D' : undefined }}>{departing.out} checked out</b> · {departing.to_go} to go
              {departing.overdue > 0 && <span style={{ color: '#B91C1C' }}> ({departing.overdue} overdue)</span>}
            </div>
          )}
        </Box>

        <Box label="Tonight" value={<>{tonight.rooms}<span className="today-box-of">/{tonight.sellable}</span></>}
          title="Rooms with a guest tonight = arriving (whose stay covers tonight) + staying over + overdue guests. Same rule as availability and the reports.">
          <div><span className="badge badge-green">{tonight.pct}%</span> · {plural(tonight.guests, 'guest')}</div>
          <div>
            = {tonight.arriving} arriving + {tonight.staying} staying
            {tonight.overdue > 0 && <span style={{ color: '#B91C1C' }}> + {tonight.overdue} overdue</span>}
          </div>
          <div>{Math.max(0, tonight.sellable - tonight.rooms)} free{oos > 0 && ` · ${oos} out of order`}</div>
        </Box>

        <Box label="New reservations" value={plural(made.bookings, 'booking')}
          to={canReservations ? '/reservations?view=booked' : undefined}
          title="Reservations made today (by the day they were booked, for any stay date). A group counts as one booking. Value is net — room + meals after discount, before service and tax.">
          {made.rooms > 0
            ? <>
                <div>{plural(made.rooms, 'room')} · {plural(made.nights, 'night')}</div>
                <div title={fmtIDR(made.value)}><b>{fmtShortIDR(made.value)}</b> <span className="text-muted">net</span></div>
              </>
            : <div>None made yet today</div>}
          {made.cancelled.rooms > 0 && (
            <div style={{ color: '#B91C1C' }}>{made.cancelled.bookings} cancelled today</div>
          )}
        </Box>
      </div>

      {tomorrow && (
        <div className="tomorrow-line">
          <span className="tomorrow-label">Tomorrow · {fmtYmd(tomorrow.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <span><b>{tomorrow.arriving.rooms}</b> arriving ({plural(tomorrow.arriving.guests, 'guest')})</span>
          <span><b>{tomorrow.staying.rooms}</b> staying over</span>
          <span><b>{tomorrow.departing.rooms}</b> departing</span>
          <span><b>{tomorrow.tonight.rooms}/{tonight.sellable}</b> rooms that night ({tomorrow.tonight.pct}%)</span>
          {canLists && <Link to={`/guest-lists?date=${tomorrow.date}`} className="tomorrow-link">Guest Lists →</Link>}
        </div>
      )}

      {today.never_arrived?.length > 0 && (
        <div className="alert alert-warn" style={{ marginTop: 10 }}>
          <span>
            🗑 <b>{plural(today.never_arrived.length, 'old booking')} never checked in</b> and the stay is already over
            ({today.never_arrived.slice(0, 5).map(r => `${r.unit_name} ${r.guest_name}`).join(', ')}{today.never_arrived.length > 5 ? ', …' : ''}).
            Mark them no-show or cancel them — until then they count as sold in the reports.
            {canLists && <> <Link to="/guest-lists" style={{ color: 'inherit', fontWeight: 700 }}>See the list →</Link></>}
          </span>
        </div>
      )}
    </>
  );
}

function Change({ value, suffix = '%' }) {
  if (value == null) return <span className="text-muted">no data last month</span>;
  if (value === 0) return <span className="text-muted">same as last month</span>;
  const up = value > 0;
  return <span style={{ color: up ? '#15803D' : '#B91C1C', fontWeight: 600 }}>{up ? '▲' : '▼'} {Math.abs(value)}{suffix} <span style={{ fontWeight: 400 }} className="text-muted">vs last month</span></span>;
}

// Whole month, night by night: past nights solid, today dark, nights still
// to come (already booked) light.
function MonthChart({ daily, todayYmd }) {
  const max = Math.max(1, ...daily.map(d => d.revenue));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
        {daily.map(d => {
          const isToday = d.date === todayYmd;
          const future = d.date > todayYmd;
          return (
            <div key={d.date}
              title={`${fmtYmd(d.date, { weekday: 'short', day: 'numeric', month: 'short' })} — ${fmtIDR(d.revenue)} · ${plural(d.rooms, 'room')}${future ? ' (booked)' : ''}`}
              style={{ flex: 1, height: `${Math.max(3, Math.round((d.revenue / max) * 100))}%`, borderRadius: '3px 3px 0 0',
                background: isToday ? '#5C1A2E' : future ? '#F3E3E6' : '#C9A0AB' }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        <span>{fmtYmd(daily[0]?.date)}</span>
        <span><span style={{ color: '#C9A0AB' }}>■</span> stayed · <span style={{ color: '#5C1A2E' }}>■</span> today · <span style={{ color: '#E9CDD4' }}>■</span> booked ahead</span>
        <span>{fmtYmd(daily[daily.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

export function MonthSection({ isOwner }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/api/dashboard/month')
      .then(r => { if (alive) { setM(r.data); setError(''); } })
      .catch(err => { if (alive) setError(err.response?.data?.error || 'Could not load the month'); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const monthName = m ? fmtYmd(m.from, { month: 'long', year: 'numeric' }) : '';
  const range = m ? `${fmtYmd(m.from, { day: 'numeric' })}–${fmtYmd(m.to, { day: 'numeric', month: 'short' })}` : '';
  const prevRange = m ? `${fmtYmd(m.prev.from, { day: 'numeric' })}–${fmtYmd(m.prev.to, { day: 'numeric', month: 'short' })}` : '';

  return (
    <div style={{ marginTop: 24 }}>
      <SectionHeading title="This Month" sub={m ? `${monthName} · so far = ${range} (tonight included), compared with ${prevRange}` : ''}
        right={isOwner && <Link to="/reports" className="tomorrow-link">Full report →</Link>} />
      {error && <div className="alert alert-error">{error}</div>}
      {!m ? (!error && <div className="text-muted" style={{ padding: 20 }}>Loading…</div>) : (
        <>
          <div className="month-strip">
            <Box label="Revenue so far" value={<span title={fmtIDR(m.so_far.revenue)}>{fmtShortIDR(m.so_far.revenue)}</span>}>
              <div>room {fmtShortIDR(m.so_far.room)}{m.so_far.meals > 0 && ` · F&B ${fmtShortIDR(m.so_far.meals)}`}{m.so_far.extras > 0 && ` · extras ${fmtShortIDR(m.so_far.extras)}`}{m.so_far.activities > 0 && ` · activities ${fmtShortIDR(m.so_far.activities)}`}</div>
              <div><Change value={m.change.revenue} /></div>
            </Box>
            <Box label="Occupancy so far" value={`${m.so_far.occupancy}%`}>
              <div>{plural(m.so_far.room_nights, 'room-night')}</div>
              <div><Change value={m.change.occupancy_pts} suffix=" pts" /></div>
            </Box>
            <Box label="ADR" value={<span title={fmtIDR(m.so_far.adr)}>{fmtShortIDR(m.so_far.adr)}</span>}
              title="Average room rate per paid night (room revenue ÷ paid room-nights; complimentary nights left out).">
              <div>RevPAR {fmtShortIDR(m.so_far.revpar)}</div>
              <div><Change value={m.change.adr} /></div>
            </Box>
            <Box label="On the books" value={`${m.on_the_books.occupancy}%`}
              title="Where the whole month lands if nothing else is booked: nights stayed so far + nights still booked to the end of the month. Same as the Reports page for this month.">
              <div title={fmtIDR(m.on_the_books.revenue)}>{fmtShortIDR(m.on_the_books.revenue)} whole month</div>
              <div>{plural(m.on_the_books.room_nights, 'room-night')}</div>
            </Box>
            <Box label="Reservations made" value={plural(m.made.bookings, 'booking')}
              title="Made this month so far (any stay date). A group counts as one booking. Value is net.">
              <div>{plural(m.made.rooms, 'room')} · <span title={fmtIDR(m.made.value)}>{fmtShortIDR(m.made.value)}</span></div>
              <div>
                {m.made.cancelled.bookings > 0 && <span style={{ color: '#B91C1C' }}>{m.made.cancelled.bookings} cancelled · </span>}
                <Change value={m.change.made_value} />
              </div>
            </Box>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">Revenue night by night — {monthName}</div>
            <MonthChart daily={m.daily} todayYmd={m.to} />
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="stat-label">Where stays came from (whole month)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {m.by_source.length === 0
                    ? <span className="text-muted" style={{ fontSize: 12 }}>No stays yet</span>
                    : m.by_source.slice(0, 5).map(s => (
                        <span key={s.source} className="badge badge-gray" title={`${plural(s.count, 'booking')} · ${fmtIDR(s.revenue)}`}>
                          {s.source} {s.share}%
                        </span>
                      ))}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="stat-label">Deposits &amp; balances not yet paid</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#D97706', marginTop: 4 }}>
                  {fmtIDR(m.unpaid.amount)} · {plural(m.unpaid.bookings, 'booking')}
                </div>
                <div className="text-muted" style={{ fontSize: 11 }}>all upcoming and current stays</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
