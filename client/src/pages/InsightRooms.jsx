// Insights → Rooms: how full the hotel was, which room types and meal plans
// sell, how long guests stay (server/services/insightPages.js buildRooms —
// the Reports page's room figures). Owner, or the `reports` permission.
import InsightPeriodBar, { useInsightPeriod, useInsightFetch, idr, jt, Up, Bar } from '../components/InsightPeriod';

export default function InsightRooms() {
  const P = useInsightPeriod();
  const { data, loading, error } = useInsightFetch('/api/insight/rooms', P);
  const n = data?.now;
  const card = (label, value, cmpPrev, cmpLy, sub) => (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{cmpPrev} before{cmpLy ? <> · {cmpLy} last year</> : null}{sub ? <> · {sub}</> : null}</div>
    </div>
  );
  const maxOcc = 100;   // bars against a full hotel
  const nice = p => (p.label ? p.label : new Date(`${p.key}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Rooms</div>
          <div className="page-subtitle">How full we were, which rooms and meal plans sell, and how long guests stay.</div>
        </div>
      </div>
      <InsightPeriodBar P={P} data={data} />
      {error && <div className="alert alert-error">{error}</div>}

      {loading && !data ? <div className="text-muted">Loading…</div> : data && (<div style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="stat-grid stat-grid-money">
          {card('Occupancy', `${Math.round(n.occupancy)}%`, <Up pts={data.compare_prev.occupancy_pts} />,
            data.compare_last_year && <Up pts={data.compare_last_year.occupancy_pts} />, `${n.nights_sold} of ${n.available_nights} room-nights`)}
          {card('Average room rate (ADR)', idr(n.adr), <Up pct={data.compare_prev.adr} />, data.compare_last_year && <Up pct={data.compare_last_year.adr} />)}
          {card('Revenue per available room', idr(n.revpar), <Up pct={data.compare_prev.revpar} />, data.compare_last_year && <Up pct={data.compare_last_year.revpar} />, 'RevPAR')}
          <div className="stat-card">
            <div className="stat-label">Average stay</div>
            <div className="stat-value">{data.length_of_stay.average.toLocaleString('id-ID', { maximumFractionDigits: 1 })} nights</div>
            <div className="stat-sub">{data.length_of_stay.stays} stays arrived · {data.guest_nights} guest-nights</div>
          </div>
        </div>
        <div className="text-muted" style={{ fontSize: 12, margin: '-10px 0 16px' }}>
          Room revenue net, before service charge & tax. Rooms for sale: {data.sellable_rooms} (rooms not out of order today).
          {data.complimentary.nights > 0 && ` ${data.complimentary.nights} complimentary nights — counted for occupancy, not for ADR.`}
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>Occupancy {data.series.by === 'day' ? 'night by night' : 'month by month'}</div>
          <div className="rev-days" style={{ gridTemplateColumns: `repeat(${data.series.points.length}, minmax(0, 1fr))` }}>
            {data.series.points.map(p => (
              <div key={p.key} className="rev-day" title={`${nice(p)}: ${Math.round(p.occupancy)}% · ${p.sold} of ${p.available} room-nights${p.adr ? ` · ADR ${idr(p.adr)}` : ''}`}>
                <div style={{ height: `${(p.occupancy / maxOcc) * 100}%`, background: 'var(--green-dark)', opacity: p.occupancy >= 80 ? 1 : p.occupancy >= 50 ? 0.7 : 0.45 }} />
              </div>
            ))}
          </div>
          <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
            <span>{data.series.points[0] && nice(data.series.points[0])}</span>
            <span>Hover for the figures · bar height = % of rooms sold</span>
            <span>{data.series.points.length > 0 && nice(data.series.points.at(-1))}</span>
          </div>
        </div>

        <div className="rev-cols">
          <div className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>Room types</div>
            <div className="table-wrap">
              <table className="rev-types">
                <thead><tr><th>Type</th><th className="num">Occ.</th><th className="num">ADR</th><th className="num">RevPAR</th><th className="num">Revenue</th></tr></thead>
                <tbody>
                  {data.room_types.map(t => (
                    <tr key={t.room_type}>
                      <td><b>{t.room_type}</b><div className="text-muted" style={{ fontSize: 12 }}>{t.nights} nights · {t.rooms} {t.rooms === 1 ? 'room' : 'rooms'}</div></td>
                      <td className="num">{Math.round(t.occupancy)}%</td>
                      <td className="num">{t.adr ? jt(t.adr) : '—'}</td>
                      <td className="num">{t.revpar ? jt(t.revpar) : '—'}</td>
                      <td className="num">{jt(t.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>Meal plans</div>
            {data.rate_plans.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No nights sold.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.rate_plans.map((p, i) => (
                  <div key={p.rate_plan + i}>
                    <div className="ins-row-head" style={{ fontSize: 14 }}>
                      <span style={{ fontWeight: 600 }}>{p.rate_plan}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{p.nights} nights <span className="text-muted">· {Math.round(p.share)}%</span></span>
                    </div>
                    <Bar pct={p.share} strong={i === 0} />
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      ADR {idr(p.adr)}{p.meal_revenue > 0 && ` · meals ${idr(p.meal_revenue)}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom: 4 }}>How long guests stay</div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>Stays that arrived in the period</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.length_of_stay.buckets.map(b => (
                <div key={b.label}>
                  <div className="ins-row-head" style={{ fontSize: 14 }}>
                    <span>{b.label}</span><span style={{ whiteSpace: 'nowrap' }}>{b.count} <span className="text-muted">· {Math.round(b.share)}%</span></span>
                  </div>
                  <Bar pct={b.share} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>)}
    </div>
  );
}
