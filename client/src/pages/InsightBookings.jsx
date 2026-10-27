// Insights → Bookings: how reservations come in — channels (stays of the
// period), reservations made and cancelled, how far ahead guests book,
// cancellations / no-shows of the period's arrivals, and pickup for the next
// 30 nights (server/services/insightPages.js buildBookings). Owner, or the
// `reports` permission.
import { useState } from 'react';
import InsightPeriodBar, { useInsightPeriod, useInsightFetch, idr, jt, Up, Bar } from '../components/InsightPeriod';
import StayList, { LEAD_RANGES } from '../components/StayList';

export default function InsightBookings() {
  const P = useInsightPeriod();
  const [drill, setDrill] = useState(null);   // { title, filter } → the reservations behind a figure
  const { data, loading, error } = useInsightFetch('/api/insight/bookings', P);
  const maxChan = data?.channels?.length ? Math.max(...data.channels.map(c => c.revenue)) : 1;
  const maxMade = data ? Math.max(1, ...data.made_series.points.map(p => p.made)) : 1;
  const pk = data?.pickup;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Bookings</div>
          <div className="page-subtitle">How reservations come in: channels, how far ahead, cancellations.</div>
        </div>
      </div>
      <InsightPeriodBar P={P} data={data} />
      {error && <div className="alert alert-error">{error}</div>}

      {loading && !data ? <div className="text-muted">Loading…</div> : data && (<div style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="stat-grid stat-grid-money">
          <div className="stat-card ins-tap-card" role="button" tabIndex={0} title="See the reservations made"
               onClick={() => setDrill({ title: 'Reservations made', filter: { basis: 'made' } })}>
            <div className="stat-label">Reservations made</div>
            <div className="stat-value">{data.made.bookings}</div>
            <div className="stat-sub">{data.made.before ? <><Up pct={data.made.change} /> before · </> : null}{data.made.rooms} rooms · {idr(data.made.value)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Booked ahead</div>
            <div className="stat-value">{data.lead.average.toLocaleString('id-ID', { maximumFractionDigits: 1 })} days</div>
            <div className="stat-sub">on average, for the {data.lead.rooms} rooms arriving in the period</div>
          </div>
          <div className="stat-card ins-tap-card" role="button" tabIndex={0} title="See the cancelled reservations"
               onClick={() => setDrill({ title: 'Cancelled — due in during the period', filter: { basis: 'arrivals', status: 'cancelled' } })}>
            <div className="stat-label">Cancelled</div>
            <div className="stat-value">{data.arrivals.cancel_rate != null ? `${Math.round(data.arrivals.cancel_rate)}%` : '—'}</div>
            <div className="stat-sub">{data.arrivals.cancelled} of {data.arrivals.rooms} {data.arrivals.rooms === 1 ? 'room' : 'rooms'} due in · {data.arrivals.no_shows} no-show{data.arrivals.no_shows === 1 ? '' : 's'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pickup, next 30 nights</div>
            <div className="stat-value">{pk ? `${pk.rooms >= 0 ? '+' : '−'}${Math.abs(pk.rooms)} rooms` : '—'}</div>
            <div className="stat-sub">{pk ? `since ${pk.from_date.slice(8)}/${pk.from_date.slice(5, 7)} · ${pk.rooms_now} room-nights on the books now` : 'Needs a week of daily snapshots'}</div>
          </div>
        </div>

        <div className="ins-cols">
          <div className="card">
            <div className="card-title" style={{ marginBottom: 4 }}>Channels</div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>Stays in the period — room + meal plan revenue, by where they were booked. Tap one to see the reservations.</div>
            {data.channels.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No stays in this period.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.channels.map(c => (
                  <button type="button" className="ins-tap" key={c.source} onClick={() => setDrill({ title: `${c.source} — stays`, filter: { basis: 'stays', source: c.source } })}>
                    <div className="ins-row-head" style={{ fontSize: 14 }}>
                      <span>{c.source}{c.ota && <span className="badge badge-blue" style={{ marginLeft: 6 }}>OTA</span>}</span>
                      <span style={{ whiteSpace: 'nowrap' }}><b>{idr(c.revenue)}</b> <span className="text-muted">· {Math.round(c.share)}%</span></span>
                    </div>
                    <Bar pct={(c.revenue / maxChan) * 100} strong={!c.ota} />
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {c.bookings} {c.bookings === 1 ? 'booking' : 'bookings'} · {c.nights} {c.nights === 1 ? 'night' : 'nights'} · ADR {idr(c.adr)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {data.ota_share != null && (
              <div className="text-muted" style={{ fontSize: 13, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                {Math.round(data.ota_share)}% of stay revenue came through an OTA (pays a commission).
              </div>
            )}
          </div>

          <div className="ins-side">
            <div className="card">
              <div className="card-title" style={{ marginBottom: 4 }}>How far ahead they book</div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>Rooms arriving in the period, by days between booking and arrival</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.lead.buckets.map((b, i) => (
                  <button type="button" className="ins-tap" key={b.label} disabled={!b.count}
                          onClick={() => setDrill({ title: `Booked ${b.label === 'Same day' ? 'the same day' : `${b.label} ahead`}`, filter: { basis: 'arrivals', lead_min: LEAD_RANGES[i][0], lead_max: LEAD_RANGES[i][1] } })}>
                    <div className="ins-row-head" style={{ fontSize: 14 }}>
                      <span>{b.label}</span><span style={{ whiteSpace: 'nowrap' }}>{b.count} <span className="text-muted">· {Math.round(b.share)}%</span></span>
                    </div>
                    <Bar pct={b.share} />
                  </button>
                ))}
              </div>
              {data.lead.by_channel.length > 1 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.lead.by_channel.slice(0, 6).map(c => (
                    <button type="button" key={c.source} className="ins-tap ins-row-head" style={{ fontSize: 13 }}
                            onClick={() => setDrill({ title: `${c.source} — arrivals`, filter: { basis: 'arrivals', source: c.source } })}>
                      <span>{c.source}</span><span className="text-muted" style={{ whiteSpace: 'nowrap' }}>{c.average.toLocaleString('id-ID', { maximumFractionDigits: 1 })} days · {c.rooms} {c.rooms === 1 ? 'room' : 'rooms'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rev-cols">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="ins-row-head" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              <div className="card-title" style={{ margin: 0 }}>Reservations made {data.made_series.by === 'day' ? 'day by day' : 'month by month'}</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDrill({ title: 'Reservations made', filter: { basis: 'made' } })}>See the list</button>
            </div>
            <div className="rev-days" style={{ gridTemplateColumns: `repeat(${data.made_series.points.length}, minmax(0, 1fr))`, height: 110 }}>
              {data.made_series.points.map(p => (
                <div key={p.key} className="rev-day" title={`${p.label || p.key}: ${p.made} made`}>
                  <div style={{ height: `${(p.made / maxMade) * 100}%`, background: 'var(--green-dark)' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
              {data.made_by_channel.slice(0, 6).map(c => (
                <button type="button" key={c.source} className="ins-chip" onClick={() => setDrill({ title: `${c.source} — reservations made`, filter: { basis: 'made', source: c.source } })}>
                  <b>{c.source}</b> <span className="text-muted">{c.bookings} · {jt(c.value)}</span>
                </button>
              ))}
              {data.cancelled.rooms > 0 && <span className="ins-up">{data.cancelled.bookings} cancelled in the period · {jt(data.cancelled.value)}</span>}
            </div>
          </div>
        </div>
      </div>)}
      {drill && <StayList P={P} what={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}
