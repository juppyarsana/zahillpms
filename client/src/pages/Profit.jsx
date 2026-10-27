// Profit (Insights → Profit): the Accounting P&L told in four steps —
// revenue → department profit → gross operating profit → net profit — with
// what each department keeps, what moved on last month and what the books are
// still missing (server/services/profitInsights.js). The full statement stays
// in Accounting → Profit & Loss. Owner, or the `profit` permission.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyToday } from '../lib/propertyTime';

const idr = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '− Rp ' : 'Rp ') + Math.abs(v).toLocaleString('id-ID'); };
const jt = n => { const v = Number(n) || 0; return (v < 0 ? '−' : '') + (Math.round(Math.abs(v) / 100000) / 10).toLocaleString('id-ID') + ' jt'; };
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthLong = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const dayShort = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const pct = v => (v == null ? '—' : `${Math.round(v)}%`);
const neg = v => (v < 0 ? { color: 'var(--danger-text)' } : undefined);

// One step of the four: a total with its bar, or a "minus" line under it that
// opens to its parts.
function Total({ label, amount, of, strong }) {
  const w = of > 0 ? Math.max(0, Math.min(100, (amount / of) * 100)) : 0;
  return (
    <div>
      <div className="ins-row-head" style={{ fontSize: 15, fontWeight: 700 }}>
        <span>{label}</span><span style={{ whiteSpace: 'nowrap', ...neg(amount) }}>{idr(amount)}</span>
      </div>
      <div className="prof-bar"><div className={`prof-bar-fill${strong ? ' strong' : ''}${amount < 0 ? ' neg' : ''}`} style={{ width: `${amount < 0 ? 100 : w}%` }} /></div>
    </div>
  );
}
function Minus({ label, amount, parts }) {
  const [open, setOpen] = useState(false);
  const has = parts.some(p => Math.abs(p.amount) >= 0.5);
  return (
    <div className="prof-minus">
      <button type="button" className="prof-minus-head" onClick={() => setOpen(o => !o)} disabled={!has} aria-expanded={open}>
        <span>− {label}{has && <span className="text-muted" style={{ fontSize: 12 }}> {open ? '▴' : '▾'}</span>}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{idr(amount)}</span>
      </button>
      {!open && has && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
          {parts.filter(p => Math.abs(p.amount) >= 0.5).map(p => `${p.label} ${jt(p.amount)}`).join(' · ')}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {parts.filter(p => Math.abs(p.amount) >= 0.5).map(p => (
            <div key={p.label}>
              <div className="ins-row-head" style={{ fontSize: 13 }}><span>{p.label}</span><span style={{ whiteSpace: 'nowrap' }}>{idr(p.amount)}</span></div>
              {(p.accounts || []).map(a => (
                <div key={a.code + a.name} className="ins-row-head text-muted" style={{ fontSize: 12, paddingLeft: 12 }}>
                  <span>{a.code} {a.name}</span><span style={{ whiteSpace: 'nowrap' }}>{idr(a.amount)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Profit() {
  const { can, hasModule } = useAuth();
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
    api.get('/api/profit', { params: { month } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) setError(err.response?.data?.error || 'Failed to load'); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [month]);

  const goMonth = ym => setParams(ym === current ? {} : { month: ym }, { replace: true });
  const prevLabel = data ? (data.partial ? `the same days of ${data.prev.label.split(' ')[0]}` : data.prev.label) : '';
  const n = data?.now, b = data?.before, m = data?.margins;
  const change = (now, was) => (b && Math.abs(was) >= 0.5 ? Math.round(((now - was) / Math.abs(was)) * 100) : null);
  const vs = (now, was) => {
    const c = change(now, was);
    if (c == null) return null;
    return <><span className={c >= 0 ? 'ins-down' : 'ins-up'}>{c >= 0 ? '▲' : '▼'} {Math.abs(c)}%</span> vs {prevLabel}</>;
  };
  const revenueGap = data ? data.reports_revenue - n.revenue : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Profit</div>
          <div className="page-subtitle">From what came in to what is left — in four steps.</div>
        </div>
        {can('accounting') && hasModule('accounting') && (
          <div><Link to="/accounting?tab=pl" className="btn btn-secondary">Full Profit &amp; Loss →</Link></div>
        )}
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
            {data.partial ? `${dayShort(data.from)} – ${dayShort(data.to)} so far, compared with ${dayShort(data.prev.from)} – ${dayShort(data.prev.to)}` : `Compared with ${data.prev.label}`}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && !data ? <div className="text-muted">Loading…</div> : data && (<div style={{ opacity: loading ? 0.6 : 1 }}>
        {data.missing.length > 0 && (
          <div className="alert alert-warn">
            <div>
              <b>Not complete yet — the profit below is higher than it really is.</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {data.missing.map(x => <li key={x.key}>{x.text}</li>)}
              </ul>
            </div>
          </div>
        )}

        <div className="stat-grid stat-grid-money">
          <div className="stat-card">
            <div className="stat-label">Revenue</div>
            <div className="stat-value">{idr(n.revenue)}</div>
            <div className="stat-sub">{vs(n.revenue, b?.revenue) || 'posted to the bills'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Department profit</div>
            <div className="stat-value" style={neg(n.dept_profit)}>{idr(n.dept_profit)}</div>
            <div className="stat-sub">{pct(m.dept_profit)} of revenue · after each department's own costs</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Gross operating profit</div>
            <div className="stat-value" style={neg(n.gop)}>{idr(n.gop)}</div>
            <div className="stat-sub">{pct(m.gop)} of revenue (GOP){m.gop_before != null && ` · was ${pct(m.gop_before)}`}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Net profit</div>
            <div className="stat-value" style={neg(n.net)}>{idr(n.net)}</div>
            <div className="stat-sub">{n.net < 0 ? 'a loss' : pct(m.net) + ' of revenue'}{b ? <> · {prevLabel}: {idr(b.net)}</> : null}</div>
          </div>
        </div>

        {data.movers.length > 0 && data.movers[0].change > 0 && (
          <div className="ins-note" style={{ marginTop: 0, marginBottom: 18, fontSize: 14 }}>
            <b>What changed most:</b> {data.movers.filter(x => x.change > 0).map(x => `${x.label} up ${idr(x.change)} (${idr(x.before)} → ${idr(x.amount)})`).join('; ')}.
            {can('costs') && <> <Link to={`/costs?month=${month}`} style={{ fontWeight: 600 }}>See it in Costs →</Link></>}
          </div>
        )}

        <div className="ins-cols">
          <div className="card">
            <div className="card-title" style={{ marginBottom: 14 }}>From revenue to profit</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Total label="Revenue" amount={n.revenue} of={n.revenue} strong />
              <Minus label="Department costs" amount={n.dept_costs}
                     parts={n.departments.map(d => ({ label: d.label, amount: d.costs, accounts: d.accounts }))} />
              <Total label="Department profit" amount={n.dept_profit} of={n.revenue} />
              <Minus label="Running the hotel" amount={n.running_total} parts={n.running} />
              <Total label="Gross operating profit" amount={n.gop} of={n.revenue} />
              <Minus label="Fixed charges" amount={n.fixed.amount} parts={[n.fixed]} />
              <Total label="Net profit (before income tax)" amount={n.net} of={n.revenue} strong />
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: '14px 0 0', lineHeight: 1.5 }}>
              The accountant's books: revenue as it is posted to the guests' bills, costs from Expenses, supplier bills, agent commission and the accountant's journal entries.
              {Math.abs(revenueGap) >= 1 && ` The Revenue page shows ${idr(data.reports_revenue)} for these days — it counts nights sold, including nights not posted to a bill yet (guests not checked in).`}
            </p>
          </div>

          <div className="ins-side">
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>What each department keeps</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {n.departments.filter(d => Math.abs(d.revenue) >= 0.5 || Math.abs(d.costs) >= 0.5).map(d => (
                  <div key={d.key}>
                    <div className="ins-row-head" style={{ fontSize: 14 }}>
                      <span style={{ fontWeight: 600 }}>{d.label}</span>
                      <span style={{ whiteSpace: 'nowrap' }}><b style={neg(d.profit)}>{idr(d.profit)}</b> <span className="text-muted">· {pct(d.margin)}</span></span>
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>Revenue {jt(d.revenue)} − costs {jt(d.costs)}</div>
                    <div className="prof-bar" style={{ height: 8 }}><div className={`prof-bar-fill${d.profit < 0 ? ' neg' : ''}`} style={{ width: `${d.margin == null ? 0 : Math.max(0, Math.min(100, d.profit < 0 ? 100 : d.margin))}%` }} /></div>
                  </div>
                ))}
                {Math.abs(n.misc_income) >= 0.5 && (
                  <div className="ins-row-head" style={{ fontSize: 14 }}><span style={{ fontWeight: 600 }}>Miscellaneous income</span><b>{idr(n.misc_income)}</b></div>
                )}
                {data.goppar != null && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div className="ins-row-head" style={{ fontSize: 14 }}><span style={{ fontWeight: 600 }}>GOP per available room</span><b style={neg(data.goppar)}>{idr(data.goppar)}</b></div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>GOP ÷ {data.available_nights} room-nights for sale — compare month to month (GOPPAR)</div>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>What is on it</div>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="ins-row-head"><span>Accountant's journal entries (payroll, rent, depreciation…)</span>
                  <span style={{ whiteSpace: 'nowrap' }}>{data.journal.entries ? `${data.journal.entries} · ${idr(data.journal.amount)}` : <span className="ins-up">none yet</span>}</span></div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  First day of the books: {data.books_start ? dayShort(data.books_start) + ' ' + data.books_start.slice(0, 4) : 'not set'}
                  {data.closed_through && ` · days closed through ${dayShort(data.closed_through)}`}
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Salaries show as one line until the accounts carry departments (the standard chart of accounts the accountant is reviewing).
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>)}
    </div>
  );
}
