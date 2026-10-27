// Overview: the owner's / manager's home — what needs them first, then
// tonight, revenue, money in, what is still owed, the biggest costs and the
// next 14 nights. Each figure is the one its own page shows (server/services/
// overviewService.js); a part whose module is off is left out. Owner, or the
// `overview` permission. Front desk keep landing on their own pages.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyClock } from '../lib/propertyTime';

const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const jt = n => (Math.round((Number(n) || 0) / 100000) / 10).toLocaleString('id-ID') + ' jt';
const dayShort = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const weekday = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' }); };

// Who may open where each "needs you" item points.
const NEED_KEY = {
  complimentary: 'reservations', po: ['purchasing', 'approve_po'], ota: 'reservations', overdue_stay: 'reservations',
  never_arrived: 'guest_lists', agent_overdue: 'receivables', bills_overdue: 'payables', cost_jump: 'costs',
};

function greeting(hour) {
  if (hour < 11) return 'Good morning';
  if (hour < 15) return 'Good afternoon';
  return 'Good evening';
}

const More = ({ to, children, show }) => (show ? <Link to={to} style={{ fontSize: 13, fontWeight: 600 }}>{children} →</Link> : null);

export default function Overview() {
  const { user, can } = useAuth();
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

        <div className="stat-grid stat-grid-money" style={{ marginTop: 18 }}>
          {data.tonight && (
            <div className="stat-card">
              <div className="stat-label">Tonight</div>
              <div className="stat-value">{data.tonight.rooms} of {data.tonight.sellable} rooms</div>
              <div className="stat-sub">{data.tonight.pct}% · {data.tonight.arriving_today} arriving · {data.tonight.departing_today} leaving today</div>
            </div>
          )}
          {data.revenue && (
            <div className="stat-card">
              <div className="stat-label">Revenue this month</div>
              <div className="stat-value">{idr(data.revenue.total)}</div>
              <div className="stat-sub">
                {data.revenue.change != null
                  ? <span className={data.revenue.change >= 0 ? 'ins-down' : 'ins-up'}>{data.revenue.change >= 0 ? '▲' : '▼'} {Math.abs(Math.round(data.revenue.change))}%</span>
                  : '—'} vs {dayShort(data.revenue.prev_from)} – {dayShort(data.revenue.prev_to)}
              </div>
            </div>
          )}
          {data.money_in && (
            <div className="stat-card">
              <div className="stat-label">Money in yesterday</div>
              <div className="stat-value">{idr(data.money_in.total)}</div>
              <div className="stat-sub">
                {data.money_in.by_method.length
                  ? data.money_in.by_method.slice(0, 3).map(m => `${m.method} ${jt(m.amount)}`).join(' · ')
                  : 'Nothing received'}
              </div>
            </div>
          )}
          {data.owed && (
            <div className="stat-card">
              <div className="stat-label">Still owed to the hotel</div>
              <div className="stat-value">{idr(data.owed.total)}</div>
              <div className="stat-sub">Guests {jt(data.owed.guests)} · Agents & OTAs {jt(data.owed.agents)}</div>
            </div>
          )}
        </div>

        <div className="ins-cols">
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
      </>)}
    </div>
  );
}
