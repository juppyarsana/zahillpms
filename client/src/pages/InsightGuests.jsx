// Insights → Guests: who arrived in the period — countries (by the main
// guest's nationality), returning guests, party size, children
// (server/services/insightPages.js buildGuests). Owner, or the `reports`
// permission. Tip shown on the page: the Year view answers "our top countries".
import { useState } from 'react';
import InsightPeriodBar, { useInsightPeriod, useInsightFetch, idr, Up, Bar } from '../components/InsightPeriod';
import StayList, { PARTY_RANGES } from '../components/StayList';

const pct = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);

export default function InsightGuests() {
  const P = useInsightPeriod();
  const { data, loading, error } = useInsightFetch('/api/insight/guests', P);
  const [all, setAll] = useState(false);
  const [drill, setDrill] = useState(null);   // { title, filter } → the reservations behind a figure
  const t = data?.totals;
  const countries = data?.countries || [];
  const shown = all ? countries : countries.slice(0, 10);
  const maxGuests = countries.length ? Math.max(...countries.map(c => c.guests)) : 1;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Guests</div>
          <div className="page-subtitle">Who our guests are, where they come from, and whether they come back.</div>
        </div>
      </div>
      <InsightPeriodBar P={P} data={data} />
      {error && <div className="alert alert-error">{error}</div>}

      {loading && !data ? <div className="text-muted">Loading…</div> : data && (<div style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="stat-grid stat-grid-money">
          <div className="stat-card">
            <div className="stat-label">Guests arrived</div>
            <div className="stat-value">{t.guests}</div>
            <div className="stat-sub">{data.before.guests ? <><Up pct={pct(t.guests, data.before.guests)} /> before</> : 'none the period before'}{data.last_year && <> · <Up pct={pct(t.guests, data.last_year.guests)} /> last year</>}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Top country</div>
            <div className="stat-value" style={{ fontSize: 20, whiteSpace: 'normal' }}>{countries.find(c => c.nationality)?.nationality || '—'}</div>
            <div className="stat-sub">{countries.find(c => c.nationality) ? `${Math.round(countries.find(c => c.nationality).share)}% of guests · ${countries.filter(c => c.nationality).length} ${countries.filter(c => c.nationality).length === 1 ? 'country' : 'countries'}` : 'No nationality recorded'}</div>
          </div>
          <div className="stat-card ins-tap-card" role="button" tabIndex={0} title="See the returning guests"
               onClick={() => setDrill({ title: 'Returning guests', filter: { basis: 'arrivals', returning: '1' } })}>
            <div className="stat-label">Returning guests</div>
            <div className="stat-value">{Math.round(data.returning.share)}%</div>
            <div className="stat-sub">{data.returning.stays} of {t.stays} stays had stayed before</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Party size</div>
            <div className="stat-value">{data.party.average.toLocaleString('id-ID', { maximumFractionDigits: 1 })}</div>
            <div className="stat-sub">guests per room · {t.children} {t.children === 1 ? 'child' : 'children'} in {data.party.with_children} rooms</div>
          </div>
        </div>

        <div className="ins-cols">
          <div className="card">
            <div className="ins-row-head" style={{ marginBottom: 4 }}>
              <div className="card-title" style={{ margin: 0 }}>Where they come from</div>
              {P.period !== 'year' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => P.setPeriod('year')}>See the whole year</button>}
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Guests who arrived, by the nationality of the guest each room is booked under. Tap a country to see the reservations.
              {data.not_recorded > 0 && ` ${data.not_recorded} ${data.not_recorded === 1 ? 'stay has' : 'stays have'} no nationality recorded.`}
            </div>
            {countries.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No arrivals in this period.</div> : (<>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {shown.map((c, i) => (
                  <button type="button" className="ins-tap" key={c.nationality || 'none'}
                          onClick={() => setDrill({ title: `Guests from ${c.nationality || 'no nationality recorded'}`, filter: { basis: 'arrivals', nationality: c.nationality || '' } })}>
                    <div className="ins-row-head" style={{ fontSize: 14 }}>
                      <span style={{ fontWeight: c.nationality ? 600 : 400 }} className={c.nationality ? undefined : 'text-muted'}>
                        {i + 1}. {c.nationality || 'Not recorded'}
                      </span>
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {c.guests} {c.guests === 1 ? 'guest' : 'guests'} <span className="text-muted">· {Math.round(c.share)}%</span>
                      </span>
                    </div>
                    <Bar pct={(c.guests / maxGuests) * 100} strong={i === 0 && !!c.nationality} />
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {c.stays} {c.stays === 1 ? 'stay' : 'stays'} · {c.room_nights} room-nights · {idr(c.value)}
                      {c.returning > 0 && ` · ${c.returning} returning`}
                      {c.ly_guests != null && <> · last year {c.ly_guests}</>}
                    </div>
                  </button>
                ))}
              </div>
              {countries.length > 10 && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => setAll(v => !v)}>
                  {all ? 'Show top 10' : `Show all ${countries.length}`}
                </button>
              )}
            </>)}
          </div>

          <div className="ins-side">
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>Party size</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.party.buckets.map((b, i) => (
                  <button type="button" className="ins-tap" key={b.label} disabled={!b.count}
                          onClick={() => setDrill({ title: `Rooms with ${b.label}`, filter: { basis: 'arrivals', guests_min: PARTY_RANGES[i][0], guests_max: PARTY_RANGES[i][1] } })}>
                    <div className="ins-row-head" style={{ fontSize: 14 }}>
                      <span>{b.label}</span><span style={{ whiteSpace: 'nowrap' }}>{b.count} {b.count === 1 ? 'room' : 'rooms'} <span className="text-muted">· {Math.round(b.share)}%</span></span>
                    </div>
                    <Bar pct={b.share} />
                  </button>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>In the period</div>
              <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="ins-row-head"><span>Stays (rooms) arrived</span><b>{t.stays}</b></div>
                <div className="ins-row-head"><span>Room-nights</span><b>{t.room_nights}</b></div>
                <div className="ins-row-head"><span>Average stay</span><b>{data.length_of_stay.average.toLocaleString('id-ID', { maximumFractionDigits: 1 })} {data.length_of_stay.average === 1 ? 'night' : 'nights'}</b></div>
                <div className="ins-row-head"><span>Value of these stays</span><b>{idr(t.value)}</b></div>
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Room + meal plan, net, for the whole stay.</div>
            </div>
          </div>
        </div>
      </div>)}
      {drill && <StayList P={P} what={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}
