// Overview: the owner's / manager's home (it took over the old Dashboard's
// numbers; front desk work from Today). Top to bottom: what needs them, today
// so far, yesterday vs the same weekday a week before, this month vs the same
// days of last month, what is still owed, the biggest costs, the next 14
// nights and the market. Each figure is the one its own page shows (server/
// services/overviewService.js, /api/dashboard/month); a part whose module is
// off is left out. Owner, or the `overview` permission.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyClock } from '../lib/propertyTime';
import { MonthSection, SectionHeading } from '../components/DashboardSections';
import MarketSection from '../components/MarketSection';

const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const jt = n => (Math.round((Number(n) || 0) / 100000) / 10).toLocaleString('id-ID') + ' jt';
const dayShort = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const weekday = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' }); };

// Who may open where each "needs you" item points.
const NEED_KEY = {
  complimentary: 'reservations', po: ['purchasing', 'approve_po'], ota: 'reservations', overdue_stay: 'reservations',
  never_arrived: 'guest_lists', agent_overdue: 'receivables', bills_overdue: 'payables', cost_jump: 'costs',
  night_audit: 'night_audit', holiday: 'pricing',
};

// ▲ 12% / ▼ 3 pts against the comparison day.
function Delta({ now, before, pts }) {
  if (before == null || now == null) return null;
  let v;
  if (pts) v = now - before;
  else if (before > 0) v = Math.round(((now - before) / before) * 100);
  else return <span className="text-muted">{now > 0 ? 'new' : '—'}</span>;
  if (v === 0) return <span className="text-muted">same</span>;
  return <span className={v > 0 ? 'ins-down' : 'ins-up'}>{v > 0 ? '▲' : '▼'} {Math.abs(v)}{pts ? ' pts' : '%'}</span>;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Yesterday, the day just closed, in one line under Today: revenue,
// occupancy and ADR against the same weekday a week before.
function YesterdayLine({ y }) {
  const b = y.before || {};
  return (
    <div className="tomorrow-line ov-yday">
      <span className="tomorrow-label">Yesterday · {weekday(y.date)} {dayShort(y.date)}</span>
      <span>revenue <b>{idr(y.revenue)}</b> <Delta now={y.revenue} before={b.revenue} /></span>
      <span>occupancy <b>{y.occupancy}%</b> <Delta now={y.occupancy} before={b.occupancy} pts /></span>
      <span>ADR <b>{idr(y.adr)}</b> <Delta now={y.adr} before={b.adr} /></span>
      <span className="text-muted">compared with {weekday(y.compare_date)} {dayShort(y.compare_date)}</span>
    </div>
  );
}

// "yesterday 28 rooms" under a Today card. Only rooms tonight get a ▲/▼ —
// money and reservations so far today are still growing, so an arrow against
// the whole of yesterday would mislead until the evening.
function VsYesterday({ now, before, pts, children }) {
  if (before == null) return null;
  return <div className="stat-sub ov-vs">{pts && <><Delta now={now} before={before} pts /> </>}<span className="text-muted">yesterday {children}</span></div>;
}

function greeting(hour) {
  if (hour < 11) return 'Good morning';
  if (hour < 15) return 'Good afternoon';
  return 'Good evening';
}

const More = ({ to, children, show }) => (show ? <Link to={to} style={{ fontSize: 13, fontWeight: 600 }}>{children} →</Link> : null);

export default function Overview() {
  const { user, can, hasModule } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api.get('/api/overview').then(r => { setData(r.data); setError(''); })
      .catch(err => setError(err.response?.data?.error || 'Failed to load'));
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 120000);
    return () => clearInterval(t);
  }, []);

  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Makassar' }));
  const first = (user?.name || '').split(' ')[0];
  const canKey = k => (Array.isArray(k) ? k.some(can) : can(k));

  const n = data?.needs_you || [];
  const maxCost = data?.costs?.departments?.length ? data.costs.departments[0].amount : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{greeting(hour)}{first ? `, ${first}` : ''}</div>
          <div className="page-subtitle">{propertyClock()} · everything at a glance</div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!data ? (!error && <div className="text-muted">Loading…</div>) : (<>
        {n.length > 0 ? (
          <div className="card ov-needs">
            <div className="card-title" style={{ color: 'var(--warning-text)', marginBottom: 10 }}>Needs you · {n.length}</div>
            <div className="ov-needs-grid">
              {n.map((x, i) => {
                const body = <><b>{x.title}</b><span className="text-muted">{x.text}</span></>;
                return canKey(NEED_KEY[x.kind] || 'dashboard')
                  ? <Link key={i} to={x.to} className="ov-need">{body}</Link>
                  : <div key={i} className="ov-need">{body}</div>;
              })}
            </div>
          </div>
        ) : (
          <div className="alert alert-success">Nothing needs you right now.</div>
        )}

        {data.tonight && (() => {
          const t = data.tonight;
          const y = data.yesterday;
          return (
            <div style={{ marginTop: 24 }}>
              <SectionHeading title="Today so far" sub="compared with yesterday"
                right={(can('checkin_full') || can('guest_lists') || can('dashboard')) && <Link to="/today" className="tomorrow-link">Open Today →</Link>} />
              <div className="stat-grid stat-grid-money" style={{ marginBottom: 0 }}>
                <div className="stat-card">
                  <div className="stat-label">Rooms tonight</div>
                  <div className="stat-value">{t.rooms} of {t.sellable} · {t.pct}%</div>
                  <div className="stat-sub">{t.staying} staying + {t.arriving} arriving{t.overdue > 0 ? ` + ${t.overdue} overdue` : ''}</div>
                  {y && <VsYesterday now={t.pct} before={y.occupancy} pts>{plural(y.room_nights, 'room')} ({y.occupancy}%)</VsYesterday>}
                </div>
                <div className="stat-card">
                  <div className="stat-label">Arriving · departing</div>
                  <div className="stat-value">{t.arriving_today} in · {t.departing_today} out</div>
                  <div className="stat-sub">{t.arrived} arrived, {t.to_come} to come · {t.checked_out} left, {t.to_go} to go</div>
                </div>
                <div className="stat-card" title="Reservations entered today (any stay date); a group counts once; value is net">
                  <div className="stat-label">Reservations made</div>
                  <div className="stat-value">{t.made_today.bookings} · {jt(t.made_today.value)}</div>
                  <div className="stat-sub">{plural(t.made_today.rooms, 'room')}</div>
                  {y?.made && <VsYesterday now={t.made_today.value} before={y.made.value}>{y.made.bookings} · {jt(y.made.value)}</VsYesterday>}
                </div>
                {t.money_in_today != null && (
                  <div className="stat-card" title="Money received so far today, every method (= Cashier Closing)">
                    <div className="stat-label">Money in</div>
                    <div className="stat-value">{idr(t.money_in_today)}</div>
                    <div className="stat-sub">so far today</div>
                    {y && y.money_in != null && <VsYesterday now={t.money_in_today} before={y.money_in}>{idr(y.money_in)}</VsYesterday>}
                  </div>
                )}
              </div>
              {y && <YesterdayLine y={y} />}
              {t.tomorrow && (
                <div className="tomorrow-line ov-yday">
                  <span className="tomorrow-label">Tomorrow · {weekday(t.tomorrow.date)} {dayShort(t.tomorrow.date)}</span>
                  <span><b>{t.tomorrow.arriving.rooms}</b> arriving ({plural(t.tomorrow.arriving.guests, 'guest')})</span>
                  <span><b>{t.tomorrow.staying.rooms}</b> staying over</span>
                  <span><b>{t.tomorrow.departing.rooms}</b> departing</span>
                  <span><b>{t.tomorrow.tonight.rooms} of {t.sellable}</b> rooms that night ({t.tomorrow.tonight.pct}%)</span>
                  {(can('guest_lists') || can('checkin_full')) && <Link to={`/today?date=${t.tomorrow.date}`} className="tomorrow-link">See the guests →</Link>}
                </div>
              )}
            </div>
          );
        })()}

        {hasModule('financial') && <MonthSection showReportLink={can('reports')} />}

        <div style={{ marginTop: 24 }}><SectionHeading title="Money and what is coming" /></div>
        <div className="ins-cols">
          <div className="ins-side">
          {data.owed && (
            <div className="stat-card">
              <div className="stat-label">Still owed to the hotel</div>
              <div className="stat-value">{idr(data.owed.total)}</div>
              <div className="stat-sub">Guests {jt(data.owed.guests)} · Agents & OTAs {jt(data.owed.agents)}</div>
            </div>
          )}
          {data.costs && (
            <div className="card">
              <div className="ins-row-head" style={{ marginBottom: 2 }}>
                <div className="card-title" style={{ margin: 0 }}>Biggest costs · {data.costs.month_label}{data.costs.partial ? ' so far' : ''}</div>
                <More to="/costs" show={can('costs')}>All departments</More>
              </div>
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Total {idr(data.costs.total)}
                {data.costs.change != null && <> · <span className={data.costs.change >= 0 ? 'ins-up' : 'ins-down'}>{data.costs.change >= 0 ? '▲' : '▼'} {Math.abs(Math.round(data.costs.change))}%</span> vs the same days of {data.costs.prev_label.split(' ')[0]}</>}
              </div>
              {data.costs.departments.length === 0
                ? <div className="text-muted" style={{ fontSize: 13 }}>No costs entered this month yet.</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {data.costs.departments.map((d, i) => (
                      <div key={d.department}>
                        <div className="ins-row-head" style={{ fontSize: 14 }}>
                          <span style={{ fontWeight: 600 }}>{d.label}</span>
                          <span style={{ whiteSpace: 'nowrap' }}>{idr(d.amount)} <span className="text-muted">· {Math.round(d.share)}%</span></span>
                        </div>
                        <div className="ins-bar"><div className={`ins-bar-fill${i === 0 ? ' strong' : ''}`} style={{ width: `${maxCost ? (d.amount / maxCost) * 100 : 0}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          </div>

          {data.next_nights && (
            <div className="card">
              <div className="ins-row-head" style={{ marginBottom: 2 }}>
                <div className="card-title" style={{ margin: 0 }}>Next 14 nights</div>
                <More to="/forecast" show={can('forecast')}>Forecast</More>
              </div>
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>Rooms booked so far · average {data.next_nights.occupancy}%</div>
              <div className="ov-nights">
                {data.next_nights.nights.map(x => (
                  <div key={x.date} className="ov-night"
                       title={`${weekday(x.date)} ${dayShort(x.date)}: ${x.sold} of ${x.sellable} rooms (${x.occupancy}%)${x.holiday ? ` · ${x.holiday}` : ''}`}
                       style={{ height: `${Math.max(2, x.occupancy)}%`, opacity: x.occupancy >= 80 ? 1 : x.occupancy >= 50 ? 0.65 : 0.35 }} />
                ))}
              </div>
              <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
                <span>Tonight</span>
                <span>{dayShort(data.next_nights.nights[data.next_nights.nights.length - 1].date)}</span>
              </div>
            </div>
          )}
        </div>

        {hasModule('insights') && <MarketSection isOwner={user?.role === 'owner'} />}
      </>)}
    </div>
  );
}
