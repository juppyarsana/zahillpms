import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import OtaPricesModal from '../components/OtaPricesModal';
import OtaLadderModal from '../components/OtaLadderModal';
import OtaChangePriceModal from '../components/OtaChangePriceModal';
import OtaRulesModal from '../components/OtaRulesModal';

// OTA dashboard (Sales): the next 30 nights with the prices we send, the dates
// below their occupancy target with a suggested price, how each OTA is doing and
// what came in since yesterday. Logic in server/services/otaDashboard.js.
const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const juta = n => (Number(n) ? `Rp ${(Number(n) / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : 'Rp 0');
const cellPrice = n => (Number(n) / 1000000).toFixed(2).replace('.', ',');
const ago = d => {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
};
// The year shows when it isn't this year: "8 Sep 2027" must not read like a stay already over.
const shortDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...(d.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: 'numeric' }) });

const SLOW = '#B91C1C', HIGH = '#5C1A2E', ON_TRACK = '#CFE3D4', MANUAL = '#FCD34D';
const KIND = {
  new: { label: 'New', color: '#065F46' },
  changed: { label: 'Changed', color: '#92400E' },
  cancelled: { label: 'Cancelled', color: SLOW },
  attention: { label: 'Needs someone', color: SLOW },
};
const FILTERS = [['all', 'All', () => true], ['7', '0–7 days', d => d.days <= 7], ['14', '8–14 days', d => d.days > 7 && d.days <= 14], ['30', '15–30 days', d => d.days > 14]];

function Legend({ color, children }) {
  return <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: color }} />{children}</span>;
}

// Why a price is what it is, in plain words (hover, or tap on a phone).
function priceReasons(n, prev, c, steps) {
  const rows = [];
  let source;
  if (c.manual) {
    source = { label: 'Manual price', bg: MANUAL, fg: '#451A03' };
    if (c.base != null && c.base !== c.price) rows.push(['Without it', idr(c.base)]);
    rows.push(['Stays until', 'Someone removes it']);
  } else if (c.tier != null) {
    source = { label: 'Price ladder', bg: '#F3E3E6', fg: '#5C1A2E' };
    rows.push(['Rooms sold', n.ladder_sold]);
    rows.push(['Ladder tier', `Sold up to ${c.tier}`]);
    const next = (steps || []).find(s => s.up_to > c.tier);
    rows.push(next ? ['Next price', `${idr(next.price)} at ${c.tier} sold`] : ['Next price', 'Top of the ladder']);
  } else {
    source = { label: 'Normal price', bg: '#F1F2F4', fg: '#4B5058' };
    rows.push(['Comes from', 'Room rate + meal plan']);
  }
  if (prev && prev.c && prev.c.price !== c.price) {
    const diff = c.price - prev.c.price;
    const sold = prev.c.tier != null ? ` (${prev.n.ladder_sold} sold)` : '';
    rows.push([`vs ${prev.n.label}`, `${diff > 0 ? '+' : '−'}${idr(Math.abs(diff))}${sold}`]);
  }
  return { source, rows };
}

function PriceTip({ tip, data, plan }) {
  const n = data.nights[tip.i];
  const c = n.prices[plan]?.[tip.type];
  if (!c) return null;
  const prev = tip.i > 0 ? { n: data.nights[tip.i - 1], c: data.nights[tip.i - 1].prices[plan]?.[tip.type] } : null;
  const type = data.room_types.find(t => t.id === tip.type);
  const { source, rows } = priceReasons(n, prev, c, data.ladders?.[plan]?.[tip.type]);
  const width = Math.min(300, window.innerWidth - 16);
  const left = Math.max(8, Math.min(tip.x + 14, window.innerWidth - width - 8));
  const place = tip.y > window.innerHeight - 280 ? { bottom: window.innerHeight - tip.y + 14 } : { top: tip.y + 14 };
  return (
    <div role="tooltip" style={{ position: 'fixed', left, ...place, width, zIndex: 150, pointerEvents: 'none', background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: '12px 14px' }}>
      <div className="text-muted" style={{ fontSize: 12, fontWeight: 600 }}>{type?.name} · {n.label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '2px 0 8px' }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{idr(c.price)}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap', background: source.bg, color: source.fg }}>{source.label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 5, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 13 }}>
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>{k}</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function OccupancyBar({ d }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', flex: '1 1 80px', height: 8, background: '#EEE7DE', borderRadius: 99 }}>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--green-dark)', width: `${Math.min(100, d.pct)}%` }} />
        <div title="Occupancy target" style={{ position: 'absolute', top: -3, width: 2, height: 14, background: '#1A1A1A', left: `${d.target}%` }} />
      </div>
      <span style={{ fontWeight: 600, fontSize: 13, minWidth: 34, textAlign: 'right' }}>{d.pct}%</span>
    </div>
  );
}

function SlowActions({ d, onPick, onRemove }) {
  if (!d.manual) return <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(d.date)}>Change price</button>;
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick(d.date)} style={{ marginRight: 6 }}>Change</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRemove(d)}>Remove manual price</button>
    </>
  );
}

function SlowNotes({ d }) {
  return (
    <>
      {d.manual && <div style={{ fontSize: 12, fontWeight: 500, color: '#92400E' }}>{d.slow ? 'Manual price, ladder off' : 'On track, manual price still on'}</div>}
      {d.holiday && <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{d.holiday}</div>}
    </>
  );
}

const daysToGo = d => (d.days === 0 ? 'Tonight' : `${d.days} day${d.days === 1 ? '' : 's'}`);

function NightHead({ n, onPick }) {
  const bg = n.slow ? SLOW : n.pct >= 70 ? HIGH : ON_TRACK;
  const fg = n.slow || n.pct >= 70 ? '#fff' : '#14532D';
  const body = (
    <>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 500 }}>{n.dow}</span>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{n.day}</span>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 500 }}>{n.pct}%</span>
    </>
  );
  const style = { display: 'block', width: 46, boxSizing: 'border-box', padding: '5px 0', border: 0, borderRadius: 6, textAlign: 'center', background: bg, color: fg, fontFamily: 'inherit', lineHeight: 1.3, textTransform: 'none', letterSpacing: 'normal' };
  if (n.slow || n.manual) {
    return <button type="button" title={n.holiday || n.label} aria-label={`Change price for ${n.label}, ${n.pct} percent full`} onClick={() => onPick(n.date)} style={{ ...style, cursor: 'pointer' }}>{body}</button>;
  }
  return <div title={n.holiday || n.label} style={style}>{body}</div>;
}

export default function OtaDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState(null);
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState(null);
  const [window_, setWindow] = useState(null);   // 'prices' | 'ladder' | 'rules'
  const [tip, setTip] = useState(null);          // the price being hovered: { i, type, x, y }
  const [notice, setNotice] = useState('');

  const load = useCallback(() => api.get('/api/ota-dashboard')
    .then(r => { setData(r.data); setError(''); setPlan(p => (r.data.plans.some(x => x.id === p) ? p : r.data.plans[0]?.id || null)); })
    .catch(e => setError(e.response?.data?.error || 'Could not load the OTA dashboard')), []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // A touch screen has no hover: a tap opens the box, so it also has to close on
  // a tap elsewhere or a scroll, or it stays floating away from its price.
  useEffect(() => {
    if (!tip) return undefined;
    const close = () => setTip(null);
    const outside = e => { if (!e.target.closest?.('[data-price]')) close(); };
    window.addEventListener('scroll', close, true);
    document.addEventListener('click', outside);
    return () => { window.removeEventListener('scroll', close, true); document.removeEventListener('click', outside); };
  }, [tip]);

  const rows = useMemo(() => {
    const test = FILTERS.find(f => f[0] === filter)[2];
    return (data?.slow_dates || []).filter(test);
  }, [data, filter]);

  async function removeManual(d) {
    if (!window.confirm(`Remove the manual prices on ${d.label}? The date goes back to the ladder or normal price on all OTAs.`)) return;
    try {
      await api.delete(`/api/ota-dashboard/night/${d.date}`);
      setNotice(`Manual prices removed for ${d.label}.`);
      load();
    } catch (e) { setError(e.response?.data?.error || 'Could not remove'); }
  }

  if (error && !data) return <div className="page-wrap"><div className="alert alert-error">{error}</div></div>;
  if (!data) return <div className="page-wrap"><div className="text-muted">Loading…</div></div>;
  if (!data.linked) {
    return (
      <div className="page-wrap">
        <div className="page-header"><div><h1 className="page-title">OTA dashboard</h1></div></div>
        <div className="card" style={{ padding: 20 }}>No room types are linked to the channel manager yet. Link them in <Link to="/settings/channel-manager">Settings → Channel Manager</Link>.</div>
      </div>
    );
  }

  const { targets } = data.rules;
  const channel = data.channel;
  const channelOk = channel && channel.ok && channel.last_ok_at;

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <h1 className="page-title">OTA dashboard</h1>
          <div className="page-subtitle">Dates that need a price decision, and what changed on the OTAs.</div>
        </div>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => setWindow('prices')}><Icon name="globe" />OTA prices</button>
          <button type="button" className="btn btn-secondary" onClick={() => setWindow('ladder')}><Icon name="globe" />OTA price ladder</button>
          <button type="button" className="btn btn-secondary" onClick={() => setWindow('rules')}>Pricing rules</button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div>}
      {notice && <div className="alert alert-success" role="status" style={{ marginBottom: 14 }}>{notice}</div>}

      <div className="stat-grid stat-grid-money" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-label">Slow dates, next 30 days</div>
          <div className="stat-value" style={{ color: data.slow_total ? SLOW : undefined }}>{data.slow_total}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>{data.slow_soon} within 7 days</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Booked since yesterday</div>
          <div className="stat-value">{data.since.booked.rooms} room{data.since.booked.rooms === 1 ? '' : 's'}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>{juta(data.since.booked.amount)} · {data.since.booked.reservations} reservation{data.since.booked.reservations === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cancelled since yesterday</div>
          <div className="stat-value">{data.since.cancelled.rooms} room{data.since.cancelled.rooms === 1 ? '' : 's'}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>{juta(data.since.cancelled.amount)} · {data.since.cancelled.reservations} reservation{data.since.cancelled.reservations === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Channel manager</div>
          <div className="stat-value" style={{ color: channelOk ? '#065F46' : SLOW }}>{channelOk ? 'Working' : 'Not sending'}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>{channel?.last_ok_at ? `Last sent ${ago(channel.last_ok_at)}` : 'Nothing sent yet'}</div>
        </div>
      </div>

      <section className="card" aria-labelledby="ota-cal" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 id="ota-cal" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Next 30 nights</h2>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>Occupancy, and the price we send per room per night, in Rp million.</div>
          </div>
          <div className="seg" role="group" aria-label="Meal plan">
            {data.plans.map(p => <button key={p.id} type="button" className={p.id === plan ? 'active' : ''} onClick={() => setPlan(p.id)}>{p.name}</button>)}
          </div>
        </div>
        <div className="table-wrap">
          <table style={{ borderCollapse: 'separate', borderSpacing: '2px 0' }}>
            <thead>
              <tr>
                <th className="ota-name-col" style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff' }} />
                {data.nights.map(n => <th key={n.date} style={{ padding: '0 0 6px' }}><NightHead n={n} onPick={setPicked} /></th>)}
              </tr>
            </thead>
            <tbody>
              {data.room_types.map(t => (
                <tr key={t.id}>
                  <th scope="row" className="ota-name-col" style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', color: 'var(--text)', fontSize: 13, fontWeight: 600, textAlign: 'left', textTransform: 'none', letterSpacing: 'normal', padding: '9px 10px 9px 0' }}>{t.name}</th>
                  {data.nights.map((n, i) => {
                    const c = n.prices[plan]?.[t.id];
                    return (
                      <td key={n.date} data-price
                        onPointerEnter={c ? e => { if (e.pointerType === 'mouse') setTip({ i, type: t.id, x: e.clientX, y: e.clientY }); } : undefined}
                        onPointerLeave={e => { if (e.pointerType === 'mouse') setTip(null); }}
                        onClick={c ? e => setTip(s => (s && s.i === i && s.type === t.id ? null : { i, type: t.id, x: e.clientX, y: e.clientY })) : undefined}
                        style={{ textAlign: 'center', fontSize: 13, padding: '9px 0', cursor: c ? 'help' : undefined,
                        background: c?.manual ? MANUAL : n.slow ? '#FEF6F6' : 'transparent', color: c?.manual ? '#451A03' : 'inherit', fontWeight: c?.manual ? 700 : 400 }}>
                        {c ? cellPrice(c.price) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-muted" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 12, fontSize: 13 }}>
          <Legend color={SLOW}>Slow: tap the date to change its price</Legend>
          <Legend color={ON_TRACK}>On track</Legend>
          <Legend color={HIGH}>70% or more</Legend>
          <Legend color={MANUAL}>Manual price</Legend>
          <span>Service and tax included. An OTA's own discounts aren't included. Hover over or tap a price to see why.</span>
        </div>
        {tip && <PriceTip tip={tip} data={data} plan={plan} />}
      </section>

      <section className="card" aria-labelledby="ota-slow" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ flex: '1 1 320px' }}>
            <h2 id="ota-slow" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Slow dates</h2>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
              A date is slow when it is below its occupancy target: {targets.near}% within 7 days, {targets.mid}% at 8–14 days, {targets.far}% at 15–30 days.{' '}
              <button type="button" onClick={() => setWindow('rules')} style={{ padding: 0, background: 'none', border: 0, color: 'var(--green-dark)', fontSize: 13, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}>Pricing rules</button>
            </div>
          </div>
          <div className="seg" role="group" aria-label="How soon">
            {FILTERS.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
        </div>
        {!rows.length && <div className="text-muted" style={{ padding: '14px 0' }}>No slow dates here.</div>}
        {rows.length > 0 && (
          <div className="table-wrap ota-slow-table">
            <table className="table">
              <thead><tr><th>Date</th><th>Days to go</th><th style={{ minWidth: 190 }}>Occupancy</th><th style={{ textAlign: 'right' }}>Rooms left</th><th style={{ textAlign: 'right' }}>Booked, last 7 days</th><th style={{ textAlign: 'right' }}>Lowest OTA price</th><th style={{ textAlign: 'right' }}>Suggested</th><th /></tr></thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.date} style={d.manual ? { background: '#FFFBEB' } : undefined}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {d.label}
                      <SlowNotes d={d} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{daysToGo(d)}</td>
                    <td><OccupancyBar d={d} /></td>
                    <td style={{ textAlign: 'right' }}>{d.free}</td>
                    <td style={{ textAlign: 'right' }}>{d.picked_up ? `+${d.picked_up}` : '0'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{d.lowest_price != null ? idr(d.lowest_price) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#92400E' }}>{d.cut && !d.manual ? `−${d.cut}%` : ''}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <SlowActions d={d} onPick={setPicked} onRemove={removeManual} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="ota-slow-list">
            {rows.map(d => (
              <div key={d.date} style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 600 }}>
                  <span>{d.label}</span>
                  <span className="text-muted" style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{daysToGo(d)}</span>
                </div>
                <SlowNotes d={d} />
                <div style={{ margin: '8px 0 6px' }}><OccupancyBar d={d} /></div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  {d.free} room{d.free === 1 ? '' : 's'} left · {d.picked_up ? `+${d.picked_up}` : '0'} booked in 7 days{d.lowest_price != null ? ` · from ${idr(d.lowest_price)}` : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>{d.cut && !d.manual ? `Suggested −${d.cut}%` : ''}</span>
                  <span style={{ whiteSpace: 'nowrap' }}><SlowActions d={d} onPick={setPicked} onRemove={removeManual} /></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <section className="card" aria-labelledby="ota-perf" style={{ minWidth: 0, padding: 18 }}>
          <h2 id="ota-perf" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>How each OTA is doing</h2>
          <div className="text-muted" style={{ fontSize: 13, margin: '2px 0 10px' }}>Reservations made in the last 30 days, compared with the 30 days before.</div>
          {!data.otas.length && <div className="text-muted">No OTA reservations in the last 60 days.</div>}
          {data.otas.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>OTA</th><th style={{ textAlign: 'right' }}>Reservations</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Room-nights</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Avg. rate</th><th style={{ textAlign: 'right' }}>Booked ahead</th><th style={{ textAlign: 'right' }}>Cancelled</th><th style={{ textAlign: 'right' }}>Commission</th></tr></thead>
                <tbody>
                  {data.otas.map(o => (
                    <tr key={o.name}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{o.name}</td>
                      <td style={{ textAlign: 'right' }}>{o.reservations}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: o.change > 0 ? '#065F46' : o.change < 0 ? SLOW : 'var(--text-muted)' }}>{o.change > 0 ? `+${o.change}` : o.change < 0 ? `−${-o.change}` : '0'}</td>
                      <td style={{ textAlign: 'right' }}>{o.nights}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{juta(o.revenue)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{o.average ? juta(o.average) : '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{o.lead_days != null ? `${o.lead_days} days` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{o.cancelled_pct}%</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{o.commission_pct != null ? `${String(o.commission_pct).replace('.', ',')}% from OTA` : 'Not sent'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="ota-since" style={{ minWidth: 0, padding: 18 }}>
          <h2 id="ota-since" style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700 }}>Since yesterday</h2>
          {!data.since.items.length && <div className="text-muted">Nothing new from the OTAs.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', columnGap: 24 }}>
            {data.since.items.map(e => (
              <div key={e.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, fontWeight: 600 }}>
                  <span>{e.ota}</span><span style={{ color: KIND[e.kind].color }}>{KIND[e.kind].label}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {e.rooms} room{e.rooms === 1 ? '' : 's'}{e.arrival ? ` · ${shortDate(e.arrival)}${e.departure ? ` – ${shortDate(e.departure)}` : ''}` : ''}{e.amount ? ` · ${juta(e.amount)}` : ''}
                </div>
              </div>
            ))}
          </div>
          {data.since.resent > 0 && <div className="text-muted" style={{ fontSize: 13, marginTop: 10 }}>Not counted: {data.since.resent} older booking{data.since.resent === 1 ? '' : 's'} the OTAs sent again.</div>}
        </section>
      </div>

      {picked && (
        <OtaChangePriceModal date={picked} onClose={() => setPicked(null)}
          onSaved={label => { setPicked(null); setNotice(`Saved for ${label}. It reaches the OTAs within about 20 seconds. The change is logged.`); load(); }} />
      )}
      {window_ === 'prices' && <OtaPricesModal onClose={() => { setWindow(null); load(); }} />}
      {window_ === 'ladder' && <OtaLadderModal onClose={() => { setWindow(null); load(); }} />}
      {window_ === 'rules' && (
        <OtaRulesModal rules={data.rules} roomTypes={data.room_types} changes={data.changes} canEdit={user?.role === 'owner'}
          onClose={() => setWindow(null)} onSaved={() => { setWindow(null); setNotice('Pricing rules saved.'); load(); }} />
      )}
    </div>
  );
}
