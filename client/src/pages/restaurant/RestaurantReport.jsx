// Restaurant → Report: restaurant revenue over a period for the accountant
// (GET /api/restaurant/report, server/services/restaurantReport.js), with the
// checks that say whether the figures can be trusted. Download Excel
// (/report/xlsx) has the same figures + every day, bill and item.
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { propertyToday } from '../../lib/propertyTime';

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDate = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmtShort = s => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtWhen = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '');
const monthStartOf = d => `${d.slice(0, 7)}-01`;
const right = { textAlign: 'right', whiteSpace: 'nowrap' };

function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function CheckLine({ ok, label, children }) {
  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 600, color: ok ? 'var(--success-text, #2f6b3a)' : 'var(--danger-text)' }}>{ok ? '✓' : '⚠'} {label}</div>
      {!ok && <div style={{ fontSize: 13, marginTop: 4, paddingLeft: 20, display: 'grid', gap: 2 }}>{children}</div>}
    </div>
  );
}

export default function RestaurantReport({ onOpenSession, onTab }) {
  const today = propertyToday();
  const lastMonthEnd = shiftDate(monthStartOf(today), -1);
  const presets = [
    ['this', 'This month', monthStartOf(today), today],
    ['last', 'Last month', monthStartOf(lastMonthEnd), lastMonthEnd],
    ['7', 'Last 7 days', shiftDate(today, -6), today],
  ];
  const [params, setParams] = useSearchParams();
  const from = params.get('from') || presets[0][2];
  const to = params.get('to') || presets[0][3];
  const setRange = (f, t) => setParams(p => { const n = new URLSearchParams(p); n.set('from', f); n.set('to', t); return n; });

  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true); setError('');
    api.get('/api/restaurant/report', { params: { from, to } })
      .then(res => setR(res.data)).catch(e => setError(e.response?.data?.error || 'Could not load'))
      .finally(() => setLoading(false));
  }, [from, to]);

  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState('');
  const [showSessions, setShowSessions] = useState(false);

  async function download() {
    setDownloading(true); setDlError('');
    try {
      const res = await api.get('/api/restaurant/report/xlsx', { params: { from, to }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `restaurant-report-${from}_to_${to}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      let msg = 'Could not download';
      try { msg = JSON.parse(await e.response.data.text()).error || msg; } catch { /* not JSON */ }
      setDlError(msg);
    } finally { setDownloading(false); }
  }

  const active = presets.find(p => p[2] === from && p[3] === to)?.[0];
  const k = r?.checks;
  const problems = k ? k.missing.length + k.bad_sessions.length + k.charge_problems.length : 0;

  return (
    <>
      <div className="page-toolbar">
        <div className="seg">
          {presets.map(([id, label, f, t]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setRange(f, t)}>{label}</button>)}
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="form-input" type="date" value={from} max={to} onChange={e => e.target.value && setRange(e.target.value, to)} style={{ width: 150 }} />
          <span className="text-muted" style={{ fontSize: 13 }}>to</span>
          <input className="form-input" type="date" value={to} min={from} onChange={e => e.target.value && setRange(from, e.target.value)} style={{ width: 150 }} />
        </div>
        <div className="page-toolbar-end">
          <button className="btn btn-primary" onClick={download} disabled={downloading || !r}>{downloading ? 'Preparing…' : '⬇ Download Excel'}</button>
        </div>
      </div>
      {dlError && <div className="alert alert-error">{dlError}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !r && <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
      {r && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <div className={`alert ${problems ? 'alert-warn' : 'alert-success'} mb-3`}>
            <div>
              {problems
                ? <><b>{plural(problems, 'thing')} to check</b> before the figures are final — see Checks below.</>
                : <>Everything checks out: {k.sessions_sent} of {k.sessions_expected} sessions sent, every total adds up, every room charge is on its bill.</>}
              {' '}The Excel has every day, bill and item.
            </div>
          </div>

          <div className="stat-grid stat-grid-money">
            <Stat label="Restaurant revenue (net)" value={fmtIDR(r.revenue.total.net)} sub="What Reports and the journal count" />
            <Stat label="Guests paid (incl. service & tax)" value={fmtIDR(r.revenue.total.total)} sub={`Service + tax ${fmtIDR(r.revenue.total.service_tax)}`} />
            <Stat label="Bills" value={r.revenue.total.bills.toLocaleString('id-ID')} sub={r.revenue.average_bill ? `Average ${fmtIDR(r.revenue.average_bill)}` : ''} />
            <Stat label="Complimentary (not revenue)" value={fmtIDR(r.not_revenue.complimentary.value)} sub={plural(r.not_revenue.complimentary.bills, 'bill')} />
          </div>

          <div className="card mb-3">
            <div className="card-title">Revenue</div>
            <div className="table-wrap"><table>
              <thead><tr><th>Where the bill went</th><th style={right}>Bills</th><th style={right}>Net</th><th style={right}>Service + tax</th><th style={right}>Total</th></tr></thead>
              <tbody>
                {[['Paid at the restaurant', r.revenue.outlet], ['Charged to rooms', r.revenue.rooms], ['Charged to events', r.revenue.events]].map(([label, x]) => (
                  <tr key={label}><td>{label}</td><td style={right}>{x.bills}</td><td style={right}>{fmtIDR(x.net)}</td><td style={right}>{fmtIDR(x.service_tax)}</td><td style={right}>{fmtIDR(x.total)}</td></tr>
                ))}
                <tr style={{ fontWeight: 700, background: 'var(--bg-subtle)' }}>
                  <td>Total</td><td style={right}>{r.revenue.total.bills}</td><td style={right}>{fmtIDR(r.revenue.total.net)}</td>
                  <td style={right}>{fmtIDR(r.revenue.total.service_tax)}</td><td style={right}>{fmtIDR(r.revenue.total.total)}</td>
                </tr>
              </tbody>
            </table></div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
              Paid at the restaurant counts on the session's day. Room and event charges count on the day the hotel got them, only while still on the bill.
            </div>
          </div>

          <div className="mb-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
            <div className="card">
              <div className="card-title">Paid by</div>
              <table><tbody>
                {!r.methods.length && <tr><td className="text-muted">No sessions sent in this period.</td></tr>}
                {r.methods.map(m => (
                  <tr key={m.method}><td>{m.method}</td><td style={right} className="text-muted">{plural(m.bills, 'bill')}</td>
                    <td style={right}>{fmtIDR(m.total)}</td><td style={{ ...right, width: 44 }} className="text-muted">{Math.round(m.share * 100)}%</td></tr>
                ))}
              </tbody></table>
            </div>
            <div className="card">
              <div className="card-title">By session</div>
              <div className="table-wrap"><table>
                <thead><tr><th></th><th style={right}>Bills</th><th style={right}>Takings</th><th style={right}>Average</th></tr></thead>
                <tbody>
                  {r.sessions.map(x => (
                    <tr key={x.key}><td>{x.label}</td><td style={right}>{x.bills}</td><td style={right}>{fmtIDR(x.total)}</td><td style={right}>{x.average_bill ? fmtIDR(x.average_bill) : '—'}</td></tr>
                  ))}
                </tbody>
              </table></div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Package breakfast: {r.breakfast.came} of {r.breakfast.expected} guests came.</div>
            </div>
            <div className="card">
              <div className="card-title">Not revenue</div>
              <table><tbody>
                <tr><td>Discounts given</td><td style={right}>{fmtIDR(r.not_revenue.discounts)}</td></tr>
                <tr><td>Complimentary (menu value)</td><td style={right}>{fmtIDR(r.not_revenue.complimentary.value)}</td></tr>
                {r.not_revenue.complimentary.by_department.map(d => (
                  <tr key={d.department}><td className="text-muted" style={{ paddingLeft: 20 }}>{d.department} · {plural(d.bills, 'bill')}</td><td style={right} className="text-muted">{fmtIDR(d.value)}</td></tr>
                ))}
                <tr><td>Open bills not paid when a session was sent</td><td style={right}>{fmtIDR(r.not_revenue.open_bills)}</td></tr>
              </tbody></table>
            </div>
            <div className="card">
              <div className="card-title">Top items</div>
              <table><tbody>
                {!r.top_items.length && <tr><td className="text-muted">No items.</td></tr>}
                {r.top_items.map(t => (
                  <tr key={t.name}><td>{t.name}</td><td style={right} className="text-muted">{t.qty}×</td><td style={right}>{fmtIDR(t.amount)}</td></tr>
                ))}
              </tbody></table>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Every item is in the Excel (Menu mix, Items sold).</div>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-title">Checks</div>
            <CheckLine ok={!k.missing.length} label={`Sessions sent: ${k.sessions_sent} of ${k.sessions_expected}`}>
              {k.missing.map(m => <div key={m.date + m.session}>{fmtShort(m.date)} · {m.label} — not sent (or the restaurant was closed)</div>)}
            </CheckLine>
            <CheckLine ok={!k.bad_sessions.length} label={k.bad_sessions.length ? `${plural(k.bad_sessions.length, 'session')} whose totals don't add up` : 'Every session adds up'}>
              {k.bad_sessions.map(b => (
                <div key={b.id}>
                  <a href="#" onClick={e => { e.preventDefault(); onOpenSession(b.id); }}>{fmtShort(b.date)} · {b.label}</a>
                  {' '}— payment methods {fmtIDR(b.methods_total)}, restaurant + rooms + events {fmtIDR(b.parts_total)}
                </div>
              ))}
            </CheckLine>
            <CheckLine ok={!k.charge_problems.length} label={k.charge_problems.length ? `${plural(k.charge_problems.length, 'room / event charge')} to look at` : 'Every room and event charge is on its bill'}>
              {k.charge_problems.map((c, i) => (
                <div key={c.pos_bill + i}>
                  {fmtShort(c.date)} · {c.kind === 'room' ? `Room ${c.room || '—'}` : c.room}{c.guest ? ` · ${c.guest}` : ''} · {c.problem}
                  {c.pos_total != null && <> · POS {fmtIDR(c.pos_total)}</>}{c.pms_total != null && <> · PMS {fmtIDR(c.pms_total)}</>}
                </div>
              ))}
              <div><button className="btn btn-sm btn-secondary" style={{ marginTop: 6 }} onClick={() => onTab('room-charges')}>Open Room charges →</button></div>
            </CheckLine>
            {k.resent > 0 && <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>{plural(k.resent, 'session')} sent more than once — the last send counts.</div>}
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="flex-between" style={{ padding: '14px 16px' }}>
              <div className="card-title" style={{ margin: 0 }}>Day by day</div>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowSessions(x => !x)}>{showSessions ? 'Hide sessions' : 'Show sessions'}</button>
            </div>
            <div className="table-wrap"><table style={{ minWidth: 760 }}>
              <thead><tr><th>Day</th><th style={right}>Bills</th><th style={right}>Paid at restaurant</th><th style={right}>Charged to rooms</th><th style={right}>Charged to events</th><th style={right}>Total</th><th style={right}>Complimentary</th><th>Sent</th></tr></thead>
              <tbody>
                {r.days.map(d => (
                  <Fragment key={d.date}>
                    <tr style={showSessions ? { fontWeight: 600, background: 'var(--bg-subtle)' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(d.date)}</td>
                      <td style={right}>{d.bills}</td><td style={right}>{fmtIDR(d.outlet_total)}</td><td style={right}>{fmtIDR(d.room_total)}</td>
                      <td style={right}>{d.event_total ? fmtIDR(d.event_total) : '—'}</td><td style={right}><b>{fmtIDR(d.total)}</b></td>
                      <td style={right} className="text-muted">{d.comp_value ? fmtIDR(d.comp_value) : '—'}</td>
                      <td style={{ fontSize: 12 }}>{d.missing.length ? <span style={{ color: 'var(--danger-text)' }}>{d.missing.join(', ')} not sent</span> : '✓'}</td>
                    </tr>
                    {showSessions && d.sessions.map(x => (
                      <tr key={x.id} onClick={() => onOpenSession(x.id)} style={{ cursor: 'pointer', fontSize: 13 }}>
                        <td style={{ paddingLeft: 24 }}>{x.label}{!x.check.ok && <span className="badge badge-red" style={{ marginLeft: 6 }}>doesn't add up</span>}</td>
                        <td style={right}>{x.bills}</td><td style={right}>{fmtIDR(x.outlet_total)}</td><td style={right}>{fmtIDR(x.room_total)}</td>
                        <td style={right}>{x.event_total ? fmtIDR(x.event_total) : '—'}</td><td style={right}>{fmtIDR(x.total)}</td>
                        <td style={right} className="text-muted">{x.comp_value ? fmtIDR(x.comp_value) : '—'}</td>
                        <td style={{ fontSize: 12 }} className="text-muted">{x.sent_by} · {fmtWhen(x.sent_at)}{x.send_count > 1 ? ` (${x.send_count}×)` : ''}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table></div>
            <div className="text-muted" style={{ fontSize: 12, padding: '8px 16px 14px' }}>
              Amounts as the guest paid (incl. service & tax), as the POS sent them. Click a session to open it.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
