// Forecast: the days ahead, one row per day — arrivals, departures, staying
// over, rooms sold and free, guests in house and the meal counts — for
// planning staff and breakfast. "On the books": what is reserved now, nothing
// projected. Counted like Guest Lists and Reports (server/services/forecast.js).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyToday, addDaysYmd } from '../lib/propertyTime';

const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const RANGES = [7, 14, 30];
function parts(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return {
    day: t.toLocaleDateString('en-GB', { weekday: 'short' }),
    date: t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    weekend: t.getDay() === 0 || t.getDay() === 6,
  };
}
const fmtRange = (a, b) => `${parts(a).date} – ${parts(b).date}`;
const TH = { textAlign: 'right', padding: '6px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const TD = { padding: '7px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' };
const L = { textAlign: 'left' };
const dim = n => (n ? n : <span style={{ color: 'var(--text-muted)' }}>–</span>);

// Quiet nights pale, full nights strong — the eye finds both ends.
function occStyle(pct) {
  if (pct >= 90) return { background: 'var(--danger-bg)', color: 'var(--danger-text)' };
  if (pct >= 70) return { background: '#FEF9C3', color: '#854D0E' };
  if (pct >= 30) return { background: 'var(--success-bg)', color: 'var(--success-text)' };
  return { background: '#F3F4F6', color: '#374151' };
}

export default function Forecast() {
  const { can } = useAuth();
  const nav = useNavigate();
  const today = propertyToday();
  const [params] = useSearchParams();
  const [from, setFrom] = useState(/^\d{4}-\d{2}-\d{2}$/.test(params.get('from') || '') ? params.get('from') : today);
  const [days, setDays] = useState(14);
  const [byType, setByType] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showMoney, setShowMoney] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/forecast', { params: { from, days } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) setError(err.response?.data?.error || 'Failed to load'); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [from, days]);

  const openDay = can('guest_lists') ? date => nav(`/guest-lists?date=${date}`) : null;
  const t = data?.totals;
  const hasMoney = data?.with_money;
  const money = hasMoney && showMoney;

  // Prints what is on the screen: the same days, with or without the room
  // types and the revenue columns.
  async function downloadPdf() {
    setDownloading(true);
    try {
      const r = await api.get('/api/forecast/pdf', {
        params: { from, days, ...(byType ? { by_type: 1 } : {}), ...(money ? {} : { money: 0 }) }, responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `forecast-${data.from}_to_${data.to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Could not make the PDF');
    } finally {
      setDownloading(false);
    }
  }
  const outNow = data?.rows?.[0]?.out_of_order || 0;
  const peakBreakfast = data ? data.rows.reduce((a, r) => (r.breakfast > a.breakfast ? r : a), data.rows[0]) : null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Forecast</div>
          <div className="page-subtitle">
            {data ? fmtRange(data.from, data.to) : ' '} — reservations on the books now, day by day. Nothing is projected.
          </div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={() => setFrom(d => addDaysYmd(d, -days))} aria-label="Earlier">←</button>
          <input className="form-input" type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} style={{ width: 170 }} aria-label="First day" />
          <button className="btn btn-secondary" onClick={() => setFrom(d => addDaysYmd(d, days))} aria-label="Later">→</button>
          {from !== today && <button className="btn btn-secondary" onClick={() => setFrom(today)}>Today</button>}
          <button className="btn btn-secondary" onClick={downloadPdf} disabled={loading || !data || downloading}>
            {downloading ? 'Generating…' : '⬇ Download PDF'}
          </button>
        </div>
      </div>

      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {RANGES.map(n => (
          <button key={n} className={`btn btn-sm ${days === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(n)}>{n} days</button>
        ))}
        {data?.room_types?.length > 1 && (
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={byType} onChange={e => setByType(e.target.checked)} /> Rooms sold by room type
          </label>
        )}
        {hasMoney && (
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={showMoney} onChange={e => setShowMoney(e.target.checked)} /> Revenue
          </label>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && !data ? <div className="text-muted">Loading…</div> : data && (<>
        <div className="stat-grid" style={{ marginBottom: 14 }}>
          <div className="stat-card">
            <div className="stat-label">Occupancy</div>
            <div className="stat-value">{t.occupancy}%</div>
            <div className="stat-sub">{t.sold} room-nights sold · {t.free} free</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Arrivals</div>
            <div className="stat-value">{t.arrivals}</div>
            <div className="stat-sub">rooms · {t.arrival_guests} guests</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Departures</div>
            <div className="stat-value">{t.departures}</div>
            <div className="stat-sub">rooms · {t.departure_guests} guests</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Busiest night</div>
            <div className="stat-value">{data.busiest.sold ? parts(data.busiest.date).date : '—'}</div>
            <div className="stat-sub">{data.busiest.sold ? `${parts(data.busiest.date).day} · ${data.busiest.sold} rooms · ${data.busiest.occupancy}%` : 'nothing booked'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Most breakfasts</div>
            <div className="stat-value">{peakBreakfast.breakfast || '—'}</div>
            <div className="stat-sub">{peakBreakfast.breakfast ? `${parts(peakBreakfast.date).day} ${parts(peakBreakfast.date).date} · ${t.breakfast} in the period` : 'none booked'}</div>
          </div>
          {money && (
            <div className="stat-card">
              <div className="stat-label">Revenue on the books</div>
              <div className="stat-value" style={{ fontSize: 17, lineHeight: 1.9, whiteSpace: 'nowrap' }}>{idr(t.revenue)}</div>
              <div className="stat-sub">room + meal plan, net · ADR {idr(t.adr)}</div>
            </div>
          )}
        </div>

        <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="table-wrap">
            <table style={{ width: '100%', minWidth: money ? 980 : 760, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, ...L }}>Day</th>
                  <th style={TH} title="Rooms checking in · guests">Arriving</th>
                  <th style={TH} title="Rooms checking out · guests">Departing</th>
                  <th style={TH} title="Rooms staying on from the night before">Staying</th>
                  <th style={TH} title="Rooms occupied that night">Sold</th>
                  {byType && data.room_types.map(rt => <th key={rt} style={TH}>{rt}</th>)}
                  <th style={TH} title="Rooms still free that night (out of order left out)">Free</th>
                  <th style={TH}>Occupancy</th>
                  <th style={TH} title="Guests sleeping here that night">Guests</th>
                  <th style={TH} title="Breakfasts that morning: last night's guests with breakfast, extra beds included">Breakfast</th>
                  {data.has_lunch && <th style={TH}>Lunch</th>}
                  {data.has_dinner && <th style={TH} title="Dinners that night, from the meal plan">Dinner</th>}
                  <th style={TH} title="Rooms booked for that night with nothing paid yet">Not paid</th>
                  {money && <th style={TH} title="Room + meal plan, net, on that night">Revenue</th>}
                  {money && <th style={TH} title="Room revenue ÷ paid rooms">ADR</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => {
                  const p = parts(r.date);
                  return (
                    <tr key={r.date} onClick={openDay ? () => openDay(r.date) : undefined}
                        style={{ cursor: openDay ? 'pointer' : 'default', background: p.weekend ? 'rgba(0,0,0,0.025)' : undefined }}>
                      <td style={{ ...TD, ...L }}>
                        <b>{p.day}</b> {p.date}
                        {r.date === data.today && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Today</span>}
                        {r.holiday && <div style={{ fontSize: 11, color: 'var(--danger-text)', whiteSpace: 'normal', maxWidth: 190 }}>{r.holiday}</div>}
                      </td>
                      <td style={TD}>{r.arrivals ? <><b>{r.arrivals}</b> <span className="text-muted">· {r.arrival_guests}</span></> : dim(0)}</td>
                      <td style={TD}>{r.departures ? <><b>{r.departures}</b> <span className="text-muted">· {r.departure_guests}</span></> : dim(0)}</td>
                      <td style={TD}>{dim(r.stayovers)}</td>
                      <td style={TD}><b>{r.sold}</b>{r.groups > 0 && <span className="text-muted" title="Group bookings in house"> 👥</span>}</td>
                      {byType && data.room_types.map(rt => <td key={rt} style={TD}>{dim(r.by_type[rt])}</td>)}
                      <td style={TD}>{r.free}</td>
                      <td style={TD}><span className="badge" style={{ ...occStyle(r.occupancy), minWidth: 44, display: 'inline-block', textAlign: 'center' }}>{r.occupancy}%</span></td>
                      <td style={TD}>{dim(r.guests)}{r.extra_beds > 0 && <span className="text-muted" title="Extra beds that night"> +{r.extra_beds} bed</span>}</td>
                      <td style={TD}><b>{dim(r.breakfast)}</b></td>
                      {data.has_lunch && <td style={TD}>{dim(r.lunch)}</td>}
                      {data.has_dinner && <td style={TD}>{dim(r.dinner)}</td>}
                      <td style={TD}>{dim(r.unpaid)}</td>
                      {money && <td style={TD}>{r.revenue ? idr(r.revenue) : dim(0)}</td>}
                      {money && <td style={TD}>{r.adr ? idr(r.adr) : dim(0)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ ...TD, ...L, borderBottom: 'none' }}>{data.days} days</td>
                  <td style={{ ...TD, borderBottom: 'none' }}>{t.arrivals} <span className="text-muted" style={{ fontWeight: 400 }}>· {t.arrival_guests}</span></td>
                  <td style={{ ...TD, borderBottom: 'none' }}>{t.departures} <span className="text-muted" style={{ fontWeight: 400 }}>· {t.departure_guests}</span></td>
                  <td style={{ ...TD, borderBottom: 'none' }} />
                  <td style={{ ...TD, borderBottom: 'none' }}>{t.sold}</td>
                  {byType && data.room_types.map(rt => <td key={rt} style={{ ...TD, borderBottom: 'none' }}>{data.rows.reduce((s, r) => s + r.by_type[rt], 0)}</td>)}
                  <td style={{ ...TD, borderBottom: 'none' }}>{t.free}</td>
                  <td style={{ ...TD, borderBottom: 'none' }}>{t.occupancy}%</td>
                  <td style={{ ...TD, borderBottom: 'none' }}>{t.guests}</td>
                  <td style={{ ...TD, borderBottom: 'none' }}>{t.breakfast}</td>
                  {data.has_lunch && <td style={{ ...TD, borderBottom: 'none' }}>{t.lunch}</td>}
                  {data.has_dinner && <td style={{ ...TD, borderBottom: 'none' }}>{t.dinner}</td>}
                  <td style={{ ...TD, borderBottom: 'none' }} />
                  {money && <td style={{ ...TD, borderBottom: 'none' }}>{idr(t.revenue)}</td>}
                  {money && <td style={{ ...TD, borderBottom: 'none' }}>{idr(t.adr)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
            Arriving and Departing show rooms · guests. Breakfast is for that morning (the guests of the night before), the other columns for that night.
            {' '}Every booking counts except cancelled and no-show, by its booked dates{openDay ? ' — click a day for its guest list' : ''}.
            {' '}{data.total_rooms} rooms{outNow > 0 ? `, ${outNow} out of order now` : ''}; a room out of order counts as not for sale until its expected-back date.
            {money && ' Revenue is net (before service & tax), room + meal plan only.'}
          </div>
        </div>
      </>)}
    </div>
  );
}
