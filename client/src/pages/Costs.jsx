// Costs by department (Insights → Costs): which part of the hotel spends the
// most and what changed. Expenses + supplier bills, each by the department it
// is tagged with — the same costs as Reports → Net income
// (server/services/costsService.js). Owner, or the `costs` permission.
// ?month=YYYY-MM&department=<key> open a month / department directly.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import CostEntries from '../components/CostEntries';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { propertyToday } from '../lib/propertyTime';

const idr = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '− Rp ' : 'Rp ') + Math.abs(v).toLocaleString('id-ID'); };
// Short amounts for the trend bars: "485 jt", "1,2 M".
const short = n => {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
  if (v >= 1e6) return Math.round(v / 1e6).toLocaleString('id-ID') + ' jt';
  if (v >= 1e3) return Math.round(v / 1e3).toLocaleString('id-ID') + ' rb';
  return Math.round(v).toLocaleString('id-ID');
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthLong = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const dayShort = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

// Costs going up is the thing to look at: up = amber, down = green.
function Change({ pct, amount, prevLabel }) {
  if (pct == null) return amount > 0 ? <span className="ins-up">new</span> : null;
  const up = pct >= 0;
  return (
    <span className={up ? 'ins-up' : 'ins-down'} title={prevLabel ? `vs ${prevLabel}` : undefined}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(pct))}%
    </span>
  );
}

const Bar = ({ pct, strong }) => (
  <div className="ins-bar"><div className={`ins-bar-fill${strong ? ' strong' : ''}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
);

export default function Costs() {
  const { can, hasModule } = useAuth();
  const current = propertyToday().slice(0, 7);
  const [params, setParams] = useSearchParams();
  const qMonth = params.get('month');
  const month = /^\d{4}-\d{2}$/.test(qMonth || '') && qMonth <= current ? qMonth : current;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [win, setWin] = useState(null);
  const [downloading, setDownloading] = useState(false);
  async function downloadXlsx() {
    setDownloading(true);
    try {
      const r = await api.get('/api/costs/xlsx', { params: { month }, responseType: 'blob' });
      const url = window.URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `costs-by-department-${month}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Could not make the Excel file');
    } finally {
      setDownloading(false);
    }
  }   // the entries window: { category?, entry? }

  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/costs', { params: { month } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) setError(err.response?.data?.error || 'Failed to load'); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [month]);

  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const goMonth = ym => { setWin(null); setParam('month', ym === current ? '' : ym); };

  const depts = data?.departments || [];
  const sel = depts.find(d => d.department === params.get('department')) || depts[0] || null;
  const pickDept = key => { setWin(null); setParam('department', key); };
  const selEntries = useMemo(() => (data && sel ? data.entries.filter(e => e.department === sel.department) : []), [data, sel]);

  const prevLabel = data ? (data.partial ? `the same days of ${data.prev.label.split(' ')[0]}` : data.prev.label) : '';
  const nothing = data && data.total === 0 && data.before === 0;
  const maxDept = depts.length ? Math.max(...depts.map(d => d.amount)) : 0;
  const maxTrend = data ? Math.max(1, ...data.trend.map(t => t.total)) : 1;

  // Where costs are entered, for the empty state and the note.
  const entryLinks = [
    can('expenses') && hasModule('back_office') && { to: '/expenses', label: 'Expenses' },
    can('payables') && hasModule('accounting') && { to: '/payables', label: 'Payables' },
    (can('purchasing') || can('direct_purchase')) && hasModule('back_office') && { to: '/purchasing', label: 'Purchasing' },
  ].filter(Boolean);

  // One sentence worth reading under the selected department.
  let insight = '';
  if (data && sel) {
    const topUp = [...sel.categories].sort((a, b) => b.change_amount - a.change_amount)[0];
    if (sel.change_amount > 0 && sel.before > 0 && topUp && topUp.change_amount > 0) {
      insight = `Up ${idr(sel.change_amount)} on ${prevLabel}, mostly ${topUp.label} (${idr(topUp.amount)}, was ${idr(topUp.before)}). Worth checking whether it was a one-off.`;
    } else if (sel.department === 'fnb' && data.food_ratio != null) {
      insight = `Food & drinks bought are ${Math.round(data.food_ratio)}% of food & beverage revenue this month. Bought, not used — stock left over isn't taken off, so look at it over a few months.`;
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Costs by department</div>
          <div className="page-subtitle">Which part of the hotel spends the most, and what changed.</div>
        </div>
        <div>
          <button type="button" className="btn btn-secondary" onClick={downloadXlsx} disabled={!data || downloading}>
            <Icon name="download" />{downloading ? 'Preparing…' : 'Download Excel'}
          </button>
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
              ? `${dayShort(data.from)} – ${dayShort(data.to)} so far, compared with ${dayShort(data.prev.from)} – ${dayShort(data.prev.to)}`
              : `Compared with ${data.prev.label}`}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && !data ? <div className="text-muted">Loading…</div> : data && (nothing ? (
        <div className="card" style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No costs entered for {monthLong(month)}</div>
          <p className="text-muted" style={{ fontSize: 14, margin: '0 0 10px' }}>
            This page counts what is entered in Expenses (paid on the spot) and Payables (supplier bills), each with the department it is for.
            Stock bought without a purchase order counts too.
          </p>
          {entryLinks.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {entryLinks.map(l => <Link key={l.to} to={l.to} className="btn btn-secondary btn-sm">{l.label} →</Link>)}
            </div>
          )}
          {month === current && <p className="text-muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Try last month with ‹.</p>}
        </div>
      ) : (<div style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="stat-grid stat-grid-money">
          <div className="stat-card">
            <div className="stat-label">Total costs</div>
            <div className="stat-value">{idr(data.total)}</div>
            <div className="stat-sub">
              {data.change != null
                ? <><Change pct={data.change} /> vs {prevLabel} ({idr(data.before)})</>
                : `Nothing entered for ${prevLabel}`}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Biggest department</div>
            <div className="stat-value" style={{ whiteSpace: 'normal', fontSize: 18 }}>{data.biggest?.label || '—'}</div>
            <div className="stat-sub">{data.biggest ? `${idr(data.biggest.amount)} · ${Math.round(data.biggest.share)}% of all costs` : ''}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Biggest jump</div>
            <div className="stat-value" style={{ whiteSpace: 'normal', fontSize: 18 }}>{data.jump?.label || 'None'}</div>
            <div className="stat-sub">{data.jump ? `▲ ${idr(data.jump.change_amount)} more than ${prevLabel}` : `No department spent more than ${prevLabel}`}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Cost per occupied room</div>
            <div className="stat-value">{data.cost_per_room != null ? idr(data.cost_per_room) : '—'}</div>
            <div className="stat-sub">
              {data.rooms_sold} room-nights sold{data.cost_ratio != null ? ` · costs are ${Math.round(data.cost_ratio)}% of revenue` : ''}
            </div>
          </div>
        </div>

        <div className="alert alert-info" style={{ fontSize: 13 }}>
          <div>Counted: Expenses and supplier bills, by the department each is for. <b>Salaries, agent commission and the accountant's journal entries aren't included yet</b> — they come once the chart of accounts carries departments.</div>
        </div>

        <div className="ins-cols">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>Departments, biggest first</div>
              <span className="text-muted" style={{ fontSize: 12 }}>Tap one to see what it spent on</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {depts.map((d, i) => (
                <button key={d.department} type="button" onClick={() => pickDept(d.department)}
                        className={`ins-row${sel?.department === d.department ? ' active' : ''}`}>
                  <div className="ins-row-head">
                    <span className="ins-row-name">{d.label}</span>
                    <span className="ins-row-figs">
                      <span className="ins-amt">{idr(d.amount)}</span>
                      <span className="text-muted ins-share">{Math.round(d.share)}%</span>
                      <span className="ins-chg"><Change pct={d.change} amount={d.amount} prevLabel={prevLabel} /></span>
                    </span>
                  </div>
                  <Bar pct={maxDept ? (d.amount / maxDept) * 100 : 0} strong={i === 0 || sel?.department === d.department} />
                </button>
              ))}
            </div>
          </div>

          <div className="ins-side">
            {sel && (
              <div className="card">
                <div className="stat-label">What it spent on</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{sel.label}</div>
                <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  {idr(sel.amount)} {data.partial ? 'so far' : 'this month'} · {idr(sel.before)} in {prevLabel} · {sel.entries} {sel.entries === 1 ? 'entry' : 'entries'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {sel.categories.map(c => (
                    <button key={c.category} type="button" className="ins-cat" disabled={!c.entries}
                            onClick={() => setWin({ category: c.category })} title={c.entries ? `See the ${c.entries} ${c.label} entries` : undefined}>
                      <div className="ins-row-head" style={{ fontSize: 14 }}>
                        <span>{c.label}{c.entries > 0 && <span className="text-muted" style={{ fontSize: 12 }}> · {c.entries}</span>}</span>
                        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{idr(c.amount)}</span>
                      </div>
                      <Bar pct={sel.categories[0].amount ? (c.amount / sel.categories[0].amount) * 100 : 0} />
                      {c.before > 0 && <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>was {idr(c.before)}</div>}
                    </button>
                  ))}
                </div>
                {insight && <div className="ins-note">{insight}</div>}

                {selEntries.length > 0 && (<>
                  <div className="stat-label" style={{ marginTop: 16 }}>Biggest entries</div>
                  <div className="cost-list">
                    {selEntries.slice(0, 5).map(e => (
                      <button key={e.kind + e.id} type="button" className="cost-item" onClick={() => setWin({ entry: e })}>
                        <span className="cost-item-day">{dayShort(e.day)}</span>
                        <span className="cost-item-main">
                          <span className="cost-item-what">{e.text || e.category_label}</span>
                          <span className="text-muted cost-item-sub">{[e.kind === 'bill' ? e.bill_no : 'Expense', e.supplier].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="cost-item-amt">{idr(e.amount)}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setWin({})}>
                    See all {selEntries.length} {selEntries.length === 1 ? 'entry' : 'entries'} →
                  </button>
                </>)}
              </div>
            )}

            {data.earners.length > 0 && (
              <div className="card">
                <div className="card-title" style={{ marginBottom: 4 }}>Department profit</div>
                <p className="text-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
                  What each earning department keeps after its own costs (revenue net, before service & tax).
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {data.earners.map(e => (
                    <div key={e.key}>
                      <div className="ins-row-head" style={{ fontSize: 14 }}>
                        <span style={{ fontWeight: 600 }}>{e.label}</span>
                        <span style={{ whiteSpace: 'nowrap' }}>
                          <span style={e.profit < 0 ? { color: 'var(--danger-text)', fontWeight: 600 } : undefined}>{idr(e.profit)}</span>{e.margin != null && <span className="text-muted"> · {Math.round(e.margin)}%</span>}
                        </span>
                      </div>
                      <Bar pct={e.per_100 ?? 0} />
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>
                        {idr(e.revenue)} revenue − {idr(e.costs)} costs
                        {e.per_100 != null && ` · spends Rp ${Math.round(e.per_100)} per Rp 100 earned`}
                        {e.key === 'rooms' && e.per_room != null && e.rooms_sold > 0 && ` · ${idr(e.per_room)} per occupied room`}
                        {e.key === 'activities' && e.vendor_share > 0 && ` · incl. ${idr(e.vendor_share)} owed to vendors`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-title" style={{ marginBottom: 10 }}>Total costs, last 6 months</div>
              <div className="ins-trend">
                {data.trend.map(t => (
                  <div key={t.month} className="ins-trend-col" title={`${monthLong(t.month)}${t.partial ? ' (so far)' : ''}: ${idr(t.total)}`}>
                    <span className="ins-trend-val">{t.total ? short(t.total) : '–'}</span>
                    <div className={`ins-trend-bar${t.month === month ? ' strong' : ''}`} style={{ height: `${Math.max(2, (t.total / maxTrend) * 90)}px` }} />
                    <button type="button" className="ins-trend-lbl" onClick={() => goMonth(t.month)}>{t.label}{t.partial ? '*' : ''}</button>
                  </div>
                ))}
              </div>
              {data.trend.some(t => t.partial) && <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>* so far this month</div>}
            </div>
          </div>
        </div>
      </div>))}

      {win && sel && (
        <CostEntries dept={sel} entries={selEntries} month={month} monthLabel={`${monthLong(month)}${data.partial ? ' so far' : ''}`}
                     initialCategory={win.category || ''} initialEntry={win.entry || null} onClose={() => setWin(null)} />
      )}
    </div>
  );
}
