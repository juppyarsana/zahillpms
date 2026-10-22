// Accounting, step 1 (migration 101): the daily journal built from what the
// PMS records (folio charges, payments, POS sessions, expenses), and the chart
// of accounts + which account each kind of amount goes to.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { propertyToday } from '../lib/propertyTime';
import { useAuth } from '../context/AuthContext';
import { EntriesTab, BalanceSheetTab, TrialBalanceTab } from './accounting/LedgerTabs';

const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const amt = n => (n ? Math.round(Number(n)).toLocaleString('id-ID') : '');
function shiftDate(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function fmtLong(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const TH = { textAlign: 'left', padding: '6px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const TD = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const R = { textAlign: 'right', whiteSpace: 'nowrap' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' };

const TABS = [
  { key: 'journal', label: 'Daily journal' },
  { key: 'entries', label: 'Journal entries' },
  { key: 'pl', label: 'Profit & Loss' },
  { key: 'bs', label: 'Balance sheet' },
  { key: 'tb', label: 'Trial balance' },
  { key: 'accounts', label: 'Accounts' },
];

export default function Accounting() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'journal');
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Accounting</div>
          <div className="page-subtitle">The books: the daily journal from what the PMS records, your own entries, the Profit &amp; Loss and the balance sheet</div>
        </div>
      </div>
      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.key} className={`tab-bar-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'journal' ? <JournalTab /> : tab === 'entries' ? <EntriesTab /> : tab === 'pl' ? <PlTab />
        : tab === 'bs' ? <BalanceSheetTab /> : tab === 'tb' ? <TrialBalanceTab /> : <AccountsTab />}
    </div>
  );
}

// Profit & Loss (migration 110): the journal added up per account, laid out
// by department → GOP → net profit. Month, month before, year to date.
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const pctText = v => (v == null ? '' : `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
const money = n => {
  const v = Math.round(Number(n) || 0);
  return v === 0 ? '–' : v.toLocaleString('id-ID');
};
const PL_COLS = ['period', 'previous', 'ytd'];

function PlTab() {
  const thisMonth = propertyToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});        // line key → accounts shown
  const [allOpen, setAllOpen] = useState(false);
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/accounting/pl', { params: { month } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) { setData(null); setError(err.response?.data?.error || 'Failed to load'); } })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [month]);

  async function download(kind) {
    setDownloading(kind);
    try {
      const type = kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const r = await api.get(`/api/accounting/pl/${kind}`, { params: { month }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `profit-and-loss-${month}.${kind}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert(`Failed to make the ${kind === 'pdf' ? 'PDF' : 'Excel file'}`);
    } finally {
      setDownloading('');
    }
  }

  const cols = data?.columns;
  const isOpen = key => allOpen || !!open[key];
  const negative = v => Math.round(Number(v) || 0) < 0;

  return (
    <>
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month">←</button>
        <input className="form-input" type="month" value={month} max={thisMonth}
          onChange={e => e.target.value && setMonth(e.target.value)} style={{ width: 170 }} aria-label="Month" />
        <button className="btn btn-secondary btn-sm" onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label="Next month">→</button>
        {month !== thisMonth && <button className="btn btn-secondary btn-sm" onClick={() => setMonth(thisMonth)}>This month</button>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => { setAllOpen(v => !v); setOpen({}); }}>
          {allOpen ? 'Hide accounts' : 'Show all accounts'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => download('xlsx')} disabled={loading || !data || !!downloading}>
          {downloading === 'xlsx' ? 'Making…' : '⬇ Excel'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => download('pdf')} disabled={loading || !data || !!downloading}>
          {downloading === 'pdf' ? 'Making…' : '⬇ PDF'}
        </button>
      </div>

      {error && <div className="alert alert-error"><div>{error}</div></div>}
      {loading ? <div className="text-muted">Loading…</div> : data && (<>
        {data.unmapped.length > 0 && (
          <div className="alert alert-warn"><div>
            <b>No account chosen for:</b> {data.unmapped.join('; ')}. Choose one on the Accounts tab — until then these show as their own lines.
          </div></div>
        )}

        <div className="card">
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Net amounts — service charge (paid to staff) and tax are not revenue. Revenue is counted night by night as it is posted to guests' bills;
            costs from <b>Finance → Expenses</b>, agent commission and the <b>journal entries</b>.{' '}
            {cols.period.partial && <>{cols.period.label} is the month so far. </>}
            {data.closed_through ? <>Days up to {fmtLong(data.closed_through)} are closed; later days can still change.</> : <>No day is closed yet, so every figure can still change.</>}
            {' '}% is of total revenue, or of the department's own revenue for its expenses and profit. Click a line to see its accounts.{' '}
            <Link to="/guide/profit-and-loss">📘 Guide</Link>
          </div>
          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={TH}></th>
                  {PL_COLS.map(c => [
                    <th key={c} style={{ ...TH, ...R }}>{cols[c].label}</th>,
                    <th key={`${c}-p`} style={{ ...TH, ...R }}>%</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => {
                  if (r.kind === 'heading') {
                    return (
                      <tr key={r.key}>
                        <td colSpan={7} style={{ ...TD, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3, paddingTop: 16, borderBottom: 'none' }}>{r.label}</td>
                      </tr>
                    );
                  }
                  const total = r.kind !== 'line';
                  const grand = r.kind === 'grand';
                  const hasAccounts = (r.accounts || []).length > 0;
                  const style = {
                    ...TD,
                    fontWeight: total ? 700 : 400,
                    borderTop: total ? '1.5px solid var(--text, #111827)' : undefined,
                    background: grand ? 'var(--primary-light, rgba(139,30,63,0.07))' : undefined,
                  };
                  return [
                    <tr key={r.key} onClick={hasAccounts ? () => setOpen(o => ({ ...o, [r.key]: !o[r.key] })) : undefined}
                      style={{ cursor: hasAccounts ? 'pointer' : undefined }}>
                      <td style={{ ...style, paddingLeft: total ? 8 : 20 }}>
                        {hasAccounts && <span className="text-muted" style={{ display: 'inline-block', width: 14 }}>{isOpen(r.key) ? '▾' : '▸'}</span>}
                        {r.label}
                      </td>
                      {PL_COLS.map(c => [
                        <td key={c} style={{ ...style, ...R, color: negative(r.amounts[c]) ? 'var(--danger, #DC2626)' : undefined }}>{money(r.amounts[c])}</td>,
                        <td key={`${c}-p`} style={{ ...style, ...R, fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>{pctText(r.pct[c])}</td>,
                      ])}
                    </tr>,
                    ...(hasAccounts && isOpen(r.key) ? r.accounts.map(a => (
                      <tr key={`${r.key}-${a.code}-${a.name}`}>
                        <td style={{ ...TD, paddingLeft: 40, fontSize: 12, color: a.unmapped ? 'var(--danger, #DC2626)' : 'var(--text-muted)' }}>{a.code} · {a.name}</td>
                        {PL_COLS.map(c => [
                          <td key={c} style={{ ...TD, ...R, fontSize: 12, color: 'var(--text-muted)' }}>{money(a.amounts[c])}</td>,
                          <td key={`${c}-p`} style={TD} />,
                        ])}
                      </tr>
                    )) : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>

        {data.off_pl.length > 0 && (
          <div className="card mt-3">
            <div className="card-title">Not on the P&L</div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Revenue or expense accounts set to “Not on the P&L” on the Accounts tab.</div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <tbody>
                  {data.off_pl.map(a => (
                    <tr key={a.code + a.name}>
                      <td style={TD}>{a.code} · {a.name}</td>
                      {PL_COLS.map(c => <td key={c} style={{ ...TD, ...R }}>{money(a.amounts[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}
    </>
  );
}

function JournalTab() {
  const today = propertyToday();
  const [params] = useSearchParams();
  // ?from=&to= opens a period directly (a link from another page).
  const urlFrom = DATE_RE.test(params.get('from') || '') ? params.get('from') : null;
  const urlTo = urlFrom && DATE_RE.test(params.get('to') || '') && params.get('to') >= urlFrom ? params.get('to') : urlFrom;
  const [from, setFrom] = useState(urlFrom || shiftDate(today, -1));
  const [to, setTo] = useState(urlTo || shiftDate(today, -1));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [version, setVersion] = useState(0);   // bumped when days are closed / opened again

  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/accounting/journal', { params: { from, to } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) { setData(null); setError(err.response?.data?.error || 'Failed to load'); } })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [from, to, version]);

  function pick(f, t) { setFrom(f); setTo(t); }
  const monthStart = today.slice(0, 8) + '01';
  const lastMonthEnd = shiftDate(monthStart, -1);
  const quick = [
    ['Yesterday', shiftDate(today, -1), shiftDate(today, -1)],
    ['Today', today, today],
    ['This month', monthStart, today],
    ['Last month', lastMonthEnd.slice(0, 8) + '01', lastMonthEnd],
  ];

  async function downloadXlsx() {
    setDownloading(true);
    try {
      const r = await api.get('/api/accounting/journal/xlsx', { params: { from, to }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `journal-${from === to ? from : `${from}_to_${to}`}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to make the Excel file');
    } finally {
      setDownloading(false);
    }
  }

  const single = from === to;
  const revenueDiff = data ? data.checks.revenue.filter(r => Math.abs(r.difference) >= 1) : [];

  return (
    <>
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {quick.map(([label, f, t]) => (
          <button key={label} className={`btn btn-sm ${from === f && to === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick(f, t)}>{label}</button>
        ))}
        <input className="form-input" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} style={{ width: 160 }} aria-label="From" />
        <span className="text-muted">to</span>
        <input className="form-input" type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} style={{ width: 160 }} aria-label="To" />
        <button className="btn btn-primary btn-sm" onClick={downloadXlsx} disabled={loading || !data || downloading}>
          {downloading ? 'Making the file…' : '⬇ Excel'}
        </button>
      </div>

      <ClosingCard version={version} onChanged={() => setVersion(v => v + 1)} />

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="text-muted">Loading…</div> : data && (<>
        {data.unmapped.length > 0 && (
          <div className="alert alert-warn"><div>
            <b>No account chosen for:</b> {data.unmapped.join('; ')}. Choose one on the Accounts tab — until then these lines show without an account.
          </div></div>
        )}
        {!data.balanced && (
          <div className="alert alert-error"><div>Debits and credits are not equal for this period. Please tell support before using this journal.</div></div>
        )}

        <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
          <div className="stat-card">
            <div className="stat-label">Journal total</div>
            <div className="stat-value">{idr(data.totals.debit)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{data.balanced ? '✓ Debits = credits' : '⚠ Not balanced'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Money received</div>
            <div className="stat-value">{idr(data.checks.money.journal)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {Math.abs(data.checks.money.difference) < 1 ? '✓ Same as the Daily Close / Cashier Closing'
                : data.closed_days > 0 ? `Daily Close says ${idr(data.checks.money.pms)} — a closed day was corrected later (posted on the day it was next closed)`
                : `⚠ Daily Close says ${idr(data.checks.money.pms)}`}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Revenue posted</div>
            <div className="stat-value">{idr(data.checks.revenue.reduce((s, r) => s + r.journal, 0))}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {revenueDiff.length ? 'Differs from the Reports page — see below' : '✓ Same as the Reports page'}
            </div>
          </div>
        </div>

        {!data.days.length && <div className="card"><div className="text-muted" style={{ fontSize: 13 }}>Nothing to post in this period.</div></div>}

        {data.days.map(day => (
          <div className="card mt-3" key={day.date}>
            <div className="flex-between" style={{ marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>
                {fmtLong(day.date)}
                {day.closed && <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }} title="Closed — this day no longer changes"> · 🔒 closed</span>}
              </div>
              <div className="text-muted" style={{ fontSize: 12 }}>{idr(day.debit)}{day.balanced ? '' : ' · ⚠ not balanced'}</div>
            </div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Account</th><th style={TH}>Name</th>
                    <th style={{ ...TH, ...R }}>Debit</th><th style={{ ...TH, ...R }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {day.entries.map(e => [
                    <tr key={`h-${e.code}`}>
                      <td colSpan={4} style={{ ...TD, fontWeight: 700, background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>{e.label}</td>
                    </tr>,
                    ...e.lines.map(l => (
                      <tr key={`${e.code}-${l.account_id}`}>
                        <td style={{ ...TD, whiteSpace: 'nowrap', fontWeight: 600 }}>{l.account_code}</td>
                        <td style={{ ...TD, paddingLeft: l.credit ? 28 : 8, color: l.unmapped ? 'var(--danger, #DC2626)' : undefined }}>{l.account_name}</td>
                        <td style={{ ...TD, ...R }}>{amt(l.debit)}</td>
                        <td style={{ ...TD, ...R }}>{amt(l.credit)}</td>
                      </tr>
                    )),
                  ])}
                  {day.entries.length > 1 && (
                    <tr>
                      <td colSpan={2} style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>Total for the day</td>
                      <td style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>{amt(day.debit)}</td>
                      <td style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>{amt(day.credit)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {!single && data.accounts.length > 0 && (
          <div className="card mt-3">
            <div className="card-title">Totals per account — whole period</div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Account</th><th style={TH}>Name</th>
                    <th style={{ ...TH, ...R }}>Debit</th><th style={{ ...TH, ...R }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map(a => (
                    <tr key={a.account_code + a.account_name}>
                      <td style={{ ...TD, whiteSpace: 'nowrap', fontWeight: 600 }}>{a.account_code}</td>
                      <td style={TD}>{a.account_name}</td>
                      <td style={{ ...TD, ...R }}>{amt(a.debit)}</td>
                      <td style={{ ...TD, ...R }}>{amt(a.credit)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>Total</td>
                    <td style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>{amt(data.totals.debit)}</td>
                    <td style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>{amt(data.totals.credit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {revenueDiff.length > 0 && (
          <div className="card mt-3">
            <div className="card-title">Revenue: journal and Reports page</div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              The journal counts what has been posted to guests' bills. The Reports page also counts the nights of guests
              who have not checked in yet, and counts an activity on the day it takes place — so the two can differ until those are posted.
            </div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Revenue</th><th style={{ ...TH, ...R }}>Journal</th>
                    <th style={{ ...TH, ...R }}>Reports page</th><th style={{ ...TH, ...R }}>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checks.revenue.map(r => (
                    <tr key={r.label}>
                      <td style={TD}>{r.label}</td>
                      <td style={{ ...TD, ...R }}>{idr(r.journal)}</td>
                      <td style={{ ...TD, ...R }}>{idr(r.reports)}</td>
                      <td style={{ ...TD, ...R, fontWeight: Math.abs(r.difference) >= 1 ? 700 : 400 }}>{Math.abs(r.difference) >= 1 ? idr(r.difference) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}
    </>
  );
}

// Closing days (migration 102): a closed day's journal is kept as it is; a
// later change to it is posted as a correction in the next day closed.
function ClosingCard({ version, onChanged }) {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [st, setSt] = useState(null);
  const [through, setThrough] = useState('');
  const [start, setStart] = useState('');
  const [step, setStep] = useState(null);   // 'close' | 'reopen' — waiting for the second click
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let off = false;
    api.get('/api/accounting/closing')
      .then(r => {
        if (off) return;
        setSt(r.data);
        const yesterday = shiftDate(r.data.today, -1);
        setThrough(t => t || yesterday);
        setStart(s0 => r.data.books_start || s0 || yesterday.slice(0, 8) + '01');
      })
      .catch(err => { if (!off) setError(err.response?.data?.error || 'Failed to load'); });
    return () => { off = true; };
  }, [version]);

  if (!st) return error ? <div className="alert alert-error"><div>{error}</div></div> : null;
  const yesterday = shiftDate(st.today, -1);
  const firstOpen = st.closed_through ? shiftDate(st.closed_through, 1) : start;
  const canClose = through && firstOpen && through >= firstOpen && through <= yesterday;
  const count = canClose ? Math.round((Date.parse(through) - Date.parse(firstOpen)) / 86400000) + 1 : 0;
  const waiting = st.corrections.reduce((n, c) => n + c.items.length, 0);

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); setStep(null); onChanged(); }
    catch (err) { setError(err.response?.data?.error || 'Failed'); setStep(null); }
    finally { setBusy(false); }
  }
  const close = () => run(() => api.post('/api/accounting/closing', { through, ...(st.closed_through ? {} : { start }) }));
  const reopen = () => run(() => api.delete('/api/accounting/closing/last'));

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="card-title" style={{ margin: 0 }}>
            {st.closed_through ? <>🔒 Closed through {fmtLong(st.closed_through)}</> : 'No day is closed yet'}
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
            A closed day never changes again. If something in it is corrected later, the difference is posted in the next day you close.
          </div>
        </div>
        {isOwner && st.closed_through && (step === 'reopen' ? (
          <div className="flex gap-2" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}>Open {fmtLong(st.closed_through)} again?</span>
            <button className="btn btn-danger btn-sm" onClick={reopen} disabled={busy}>Yes, open it</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStep(null)} disabled={busy}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setStep('reopen')}>Open the last day again</button>
        ))}
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 8 }}><div>{error}</div></div>}

      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        {!st.closed_through && (st.books_start ? (
          <span style={{ fontSize: 13 }}>Books start {fmtLong(st.books_start)} ·</span>
        ) : (<>
          <span style={{ fontSize: 13 }}>First day of the books</span>
          <input className="form-input" type="date" value={start} max={yesterday} onChange={e => { setStart(e.target.value); setStep(null); }} style={{ width: 160 }} />
        </>))}
        <span style={{ fontSize: 13 }}>Close {st.closed_through ? `from ${fmtLong(firstOpen)} ` : ''}up to</span>
        <input className="form-input" type="date" value={through} min={firstOpen || undefined} max={yesterday}
          onChange={e => { setThrough(e.target.value); setStep(null); }} style={{ width: 160 }} />
        {step === 'close' ? (<>
          <span style={{ fontSize: 13 }}>
            Close {count} day{count === 1 ? '' : 's'}{waiting ? ` and post ${waiting} correction line${waiting === 1 ? '' : 's'} on ${fmtLong(through)}` : ''}?
          </span>
          <button className="btn btn-primary btn-sm" onClick={close} disabled={busy}>{busy ? 'Closing…' : 'Yes, close'}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setStep(null)} disabled={busy}>Cancel</button>
        </>) : (
          <button className="btn btn-primary btn-sm" onClick={() => setStep('close')} disabled={!canClose}>Close days</button>
        )}
        {st.closed_through && through > yesterday && <span className="text-muted" style={{ fontSize: 12 }}>Today can be closed from tomorrow.</span>}
        {st.closed_through && yesterday < firstOpen && <span className="text-muted" style={{ fontSize: 12 }}>Everything up to yesterday is closed.</span>}
      </div>

      {waiting > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            Changed after closing — {st.corrections.length} day{st.corrections.length === 1 ? '' : 's'}, waiting for the next close{' '}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAll(v => !v)}>{showAll ? 'Hide' : 'Show'}</button>
          </div>
          {showAll && (
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Closed day</th><th style={TH}>Room · guest</th><th style={TH}>What</th><th style={TH}>Account</th>
                    <th style={{ ...TH, ...R }}>Debit</th><th style={{ ...TH, ...R }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {st.corrections.flatMap(c => c.items.map((it, i) => (
                    <tr key={`${c.date}-${i}`}>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }}>{i === 0 ? fmtLong(c.date) : ''}</td>
                      <td style={TD}>{it.ref || '—'}</td>
                      <td style={TD}>{it.what}</td>
                      <td style={TD}>{it.account_code} · {it.account_name}</td>
                      <td style={{ ...TD, ...R }}>{amt(it.debit)}</td>
                      <td style={{ ...TD, ...R }}>{amt(it.credit)}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_ACCOUNT = { code: '', name: '', type: 'asset', pl_line: '' };
// The P&L lines an account of this kind can show on ('' = the kind's default).
const plOptions = (lines, type) => (lines || []).filter(l =>
  l.key === 'none' || (type === 'revenue' ? l.key.startsWith('rev.') : type === 'expense' && !l.key.startsWith('rev.')));
const PL_DEFAULT = { revenue: 'rev.misc', expense: 'und.admin' };

function AccountsTab() {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const [changes, setChanges] = useState({});   // key → account id ('' = back to the standard account)
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [modal, setModal] = useState(null);     // { mode: 'add' | 'edit', id? }
  const [form, setForm] = useState(EMPTY_ACCOUNT);
  const [formError, setFormError] = useState('');

  function load() {
    return api.get('/api/accounting/setup')
      .then(r => { setSetup(r.data); setError(''); })
      .catch(err => setError(err.response?.data?.error || 'Failed to load'));
  }
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const out = [];
    for (const it of setup?.items || []) {
      let g = out.find(x => x.label === it.group);
      if (!g) { g = { label: it.group, items: [] }; out.push(g); }
      g.items.push(it);
    }
    return out;
  }, [setup]);
  const active = (setup?.accounts || []).filter(a => a.is_active);
  const dirty = Object.keys(changes).length > 0;

  async function saveMap() {
    setSaving(true); setError('');
    try {
      const map = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v || null]));
      await api.put('/api/accounting/map', { map });
      setChanges({});
      await load();
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function openAdd() { setForm(EMPTY_ACCOUNT); setFormError(''); setModal({ mode: 'add' }); }
  function openEdit(a) { setForm({ code: a.code, name: a.name, type: a.type, pl_line: a.pl_line || '' }); setFormError(''); setModal({ mode: 'edit', id: a.id }); }
  const plLabel = key => (setup?.pl_lines || []).find(l => l.key === key)?.label || '';
  const plOf = a => (PL_DEFAULT[a.type] ? plLabel(a.pl_line || PL_DEFAULT[a.type]) : '');
  async function saveAccount() {
    setFormError('');
    try {
      if (modal.mode === 'add') await api.post('/api/accounting/accounts', form);
      else await api.put(`/api/accounting/accounts/${modal.id}`, form);
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save');
    }
  }
  async function toggleActive(a) {
    try {
      await api.put(`/api/accounting/accounts/${a.id}`, { is_active: !a.is_active });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  }

  if (!setup) return error ? <div className="alert alert-error">{error}</div> : <div className="text-muted">Loading…</div>;

  return (
    <>
      {error && <div className="alert alert-error"><div>{error}</div></div>}

      <div className="card">
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <div className="card-title" style={{ margin: 0 }}>Which account each amount goes to</div>
          <div className="flex gap-2" style={{ alignItems: 'center' }}>
            {saved && <span className="text-muted" style={{ fontSize: 12 }}>✓ Saved</span>}
            <button className="btn btn-primary btn-sm" onClick={saveMap} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Every item starts on an account from the standard chart. Change it here to match your accountant's chart of accounts.
        </div>
        {groups.map(g => (
          <div key={g.label} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{g.label}</div>
            {g.items.map(it => {
              const value = changes[it.key] !== undefined ? changes[it.key] : (it.account_id || '');
              return (
                <div key={it.key} className="flex-between" style={{ gap: 12, padding: '5px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, flex: '1 1 260px' }}>{it.label}</div>
                  <select className="form-select" style={{ flex: '0 1 340px', minWidth: 220 }} value={value}
                    onChange={e => setChanges(c => ({ ...c, [it.key]: e.target.value }))}>
                    {!value && <option value="">— choose an account —</option>}
                    {active.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="card mt-3">
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Chart of accounts</div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add account</button>
        </div>
        <div className="table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={TH}>Code</th><th style={TH}>Name</th><th style={TH}>Kind</th><th style={TH}>On the P&L</th><th style={TH}></th></tr>
            </thead>
            <tbody>
              {setup.accounts.map(a => (
                <tr key={a.id} style={a.is_active ? undefined : { opacity: 0.5 }}>
                  <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap' }}>{a.code}</td>
                  <td style={TD}>{a.name}{!a.is_active && ' (not used)'}</td>
                  <td style={TD}>{KINDS[a.type] || a.type}</td>
                  <td style={{ ...TD, fontSize: 12, color: 'var(--text-muted)' }}>{plOf(a)}</td>
                  <td style={{ ...TD, ...R }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(a)}>Edit</button>{' '}
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(a)}>{a.is_active ? 'Stop using' : 'Use again'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{modal.mode === 'add' ? 'Add account' : 'Edit account'}</div>
            </div>
            <div className="modal-body">
              {formError && <div className="alert alert-error"><div>{formError}</div></div>}
              <div className="form-group"><label className="form-label">Code *</label>
                <input className="form-input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. 1125" /></div>
              <div className="form-group"><label className="form-label">Name *</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Bank BCA" /></div>
              <div className="form-group"><label className="form-label">Kind *</label>
                <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, pl_line: '' }))}>
                  {setup.types.map(t => <option key={t} value={t}>{KINDS[t] || t}</option>)}
                </select></div>
              {PL_DEFAULT[form.type] && (
                <div className="form-group"><label className="form-label">Line on the Profit & Loss</label>
                  <select className="form-select" value={form.pl_line} onChange={e => setForm(f => ({ ...f, pl_line: e.target.value }))}>
                    <option value="">{plLabel(PL_DEFAULT[form.type])} (standard)</option>
                    {plOptions(setup.pl_lines, form.type).filter(l => l.key !== PL_DEFAULT[form.type]).map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                  </select></div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAccount}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
