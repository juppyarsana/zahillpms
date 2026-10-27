// Revenue (Insights → Revenue): what came in, where it came from and how the
// rooms sold — one month, compared with the month before (the same days while
// it runs) and the same days last year. The Reports page's own figures in an
// owner's layout (server/services/revenueInsights.js). Channels, room types and
// countries have their own pages (Bookings, Rooms, Guests); the full tables and
// the Excel / PDF are on Summary (/insights/summary). Owner, or the `reports` permission.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../services/api';
import { propertyToday } from '../lib/propertyTime';

const idr = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '− Rp ' : 'Rp ') + Math.abs(v).toLocaleString('id-ID'); };
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthLong = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const dateOf = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const dayShort = ymd => dateOf(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const SERIES = [
  { key: 'rooms', label: 'Rooms', color: 'var(--green-dark)' },
  { key: 'fnb', label: 'Food & beverage', color: '#C08A4B' },
  { key: 'other', label: 'Extras & activities', color: '#9CA3AF' },
];

// Revenue going up is good: up = green, down = amber.
function Up({ pct, pts }) {
  const v = pts ?? pct;
  if (v == null) return <span className="text-muted">—</span>;
  const up = v >= 0;
  const text = pts != null ? `${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })} pts` : `${Math.abs(Math.round(v))}%`;
  return <span className={up ? 'ins-down' : 'ins-up'}>{up ? '▲' : '▼'} {text}</span>;
}

export default function Revenue() {
  const current = propertyToday().slice(0, 7);
  const [params, setParams] = useSearchParams();
  const qMonth = params.get('month');
  const month = /^\d{4}-\d{2}$/.test(qMonth || '') && qMonth <= current ? qMonth : current;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/revenue', { params: { month } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) setError(err.response?.data?.error || 'Failed to load'); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [month]);

  const goMonth = ym => setParams(ym === current ? {} : { month: ym }, { replace: true });
  const prevLabel = data ? (data.partial ? `the same days of ${data.prev.label.split(' ')[0]}` : data.prev.label) : '';
  const ly = data?.compare_last_year;
  const lyLabel = data?.last_year?.label;
  const maxDay = data ? Math.max(1, ...data.daily.map(d => d.total)) : 1;
  const maxMix = data ? Math.max(1, ...data.mix.map(m => m.amount)) : 1;
  const qs = month === current ? '' : `?at=${month}`;   // the same month on Rooms / Guests / Bookings

  const card = (label, value, cmp, sub) => (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{cmp} vs {prevLabel}{sub ? <> · {sub}</> : null}</div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Revenue</div>
          <div className="page-subtitle">What came in, where it came from, and how the rooms sold.</div>
        </div>
      </div>

      <div className="page-toolbar">
        <div className="date-nav">
          <button type="button" onClick={() => goMonth(shiftMonth(month, -1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
          <span className="date-nav-label">{monthLong(month)}</span>
          <button type="button" onClick={() => goMonth(shiftMonth(month, 1))} disabled={month >= current} aria-label="Next month"><Icon name="chevronRight" /></button>
        </div>
        {month !== current && <button type="button" className="btn btn-secondary btn-sm" onClick={() => goMonth(current)}>This month</button>}
        {data && (
          <span className="text-muted" style={{ fontSize: 13 }}>
            {data.partial
              ? `${dayShort(data.from)} – ${dayShort(data.to)} so far (tonight included), compared with ${dayShort(data.prev.from)} – ${dayShort(data.prev.to)}`
              : `Compared with ${data.prev.label}${lyLabel ? ` and ${lyLabel}` : ''}`}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && !data ? <div className="text-muted">Loading…</div> : data && (<div style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="stat-grid stat-grid-money">
          {card('Total revenue', idr(data.now.revenue), <Up pct={data.compare_prev.revenue} />,
            ly ? <>last year <Up pct={ly.revenue} /></> : null)}
          {card('Occupancy', `${Math.round(data.now.occupancy)}%`, <Up pts={data.compare_prev.occupancy_pts} />,
            `${data.now.nights_sold} of ${data.now.available_nights} room-nights`)}
          {card('Average room rate (ADR)', idr(data.now.adr), <Up pct={data.compare_prev.adr} />,
            ly ? <>last year <Up pct={ly.adr} /></> : null)}
          {card('Revenue per available room', idr(data.now.revpar), <Up pct={data.compare_prev.revpar} />, 'RevPAR')}
        </div>
        <div className="text-muted" style={{ fontSize: 12, margin: '-10px 0 16px' }}>
          Net — before service charge & tax. {data.complimentary?.nights > 0 && `${data.complimentary.nights} complimentary nights (${idr(data.complimentary.value)}) not counted as revenue; ADR leaves them out.`}
        </div>

        <div className="card">
          <div className="ins-row-head" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>Every day of {monthLong(month).split(' ')[0]}</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }} className="text-muted">
              {SERIES.map(s => <span key={s.key}><span className="rev-key" style={{ background: s.color }} /> {s.label}</span>)}
            </div>
          </div>
          <div className="rev-days" style={{ gridTemplateColumns: `repeat(${data.daily.length}, minmax(0, 1fr))` }}>
            {data.daily.map(d => {
              return (
                <div key={d.date} className="rev-day"
                     title={`${dateOf(d.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${idr(d.total)} · ${d.nights} rooms sold\nRooms ${idr(d.rooms)} · F&B ${idr(d.fnb)} · Extras & activities ${idr(d.other)}`}>
                  {[...SERIES].reverse().map(s => d[s.key] > 0 && (
                    <div key={s.key} style={{ height: `${(d[s.key] / maxDay) * 100}%`, background: s.color }} />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
            <span>{dayShort(data.from)}</span><span>Hover a day for its figures</span><span>{dayShort(data.to)}</span>
          </div>
        </div>

        <div className="rev-cols">
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Where it came from</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {data.mix.map((m, i) => (
                <div key={m.key}>
                  <div className="ins-row-head" style={{ fontSize: 14 }}>
                    <span style={{ fontWeight: 600 }}>{m.label}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>{idr(m.amount)} <span className="text-muted">· {Math.round(m.share)}%</span></span>
                  </div>
                  <div className="ins-bar"><div className="ins-bar-fill strong" style={{ width: `${(m.amount / maxMix) * 100}%`, background: SERIES[i].color }} /></div>
                  {m.parts?.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {m.parts.map(pt => (
                        <div key={pt.label} className="ins-row-head text-muted" style={{ fontSize: 12 }}>
                          <span>{pt.label}</span><span style={{ whiteSpace: 'nowrap' }}>{idr(pt.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>More on these figures</div>
            <div className="rev-more">
              {[
                { to: `/insights/bookings${qs}`, title: 'Bookings', line: data.channels.length
                    ? `${data.channels[0].source} brought the most (${Math.round(data.channels[0].share)}%)${data.ota_share != null ? ` · ${Math.round(data.ota_share)}% through OTAs` : ''}`
                    : 'Channels, how far ahead guests book, cancellations' },
                { to: `/insights/rooms${qs}`, title: 'Rooms', line: data.room_types.length
                    ? `${[...data.room_types].sort((a, b) => b.revenue - a.revenue)[0].room_type} earned the most · occupancy ${Math.round(data.now.occupancy)}%`
                    : 'Room types, meal plans, length of stay' },
                { to: `/insights/guests${qs}`, title: 'Guests', line: data.nationalities.find(x => x.nationality)
                    ? `Most room-nights from ${data.nationalities.find(x => x.nationality).nationality} · ${data.arrivals.guests} guests arrived`
                    : 'Countries, returning guests, party size' },
              ].map(x => (
                <Link key={x.title} to={x.to} className="rev-more-item">
                  <b>{x.title} →</b><span className="text-muted">{x.line}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>)}
    </div>
  );
}
