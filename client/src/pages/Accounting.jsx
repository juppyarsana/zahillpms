// Accounting, step 1 (migration 101): the daily journal built from what the
// PMS records (folio charges, payments, POS sessions, expenses), and the chart
// of accounts + which account each kind of amount goes to.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { propertyToday } from '../lib/propertyTime';

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
  { key: 'journal', label: '📒 Daily journal' },
  { key: 'accounts', label: '🗂 Accounts' },
];

export default function Accounting() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'accounts' ? 'accounts' : 'journal');
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Accounting</div>
          <div className="page-subtitle">The daily journal for your accountant, made from what the PMS already records</div>
        </div>
      </div>
      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.key} className={`tab-bar-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'journal' ? <JournalTab /> : <AccountsTab />}
    </div>
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

  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/accounting/journal', { params: { from, to } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) { setData(null); setError(err.response?.data?.error || 'Failed to load'); } })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [from, to]);

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

        <div className="stat-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card">
            <div className="stat-label">Journal total</div>
            <div className="stat-value">{idr(data.totals.debit)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{data.balanced ? '✓ Debits = credits' : '⚠ Not balanced'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Money received</div>
            <div className="stat-value">{idr(data.checks.money.journal)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {Math.abs(data.checks.money.difference) < 1 ? '✓ Same as the Daily Close / Cashier Closing' : `⚠ Daily Close says ${idr(data.checks.money.pms)}`}
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
              <div className="card-title" style={{ margin: 0 }}>{fmtLong(day.date)}</div>
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

const EMPTY_ACCOUNT = { code: '', name: '', type: 'asset' };

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
  function openEdit(a) { setForm({ code: a.code, name: a.name, type: a.type }); setFormError(''); setModal({ mode: 'edit', id: a.id }); }
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
              <tr><th style={TH}>Code</th><th style={TH}>Name</th><th style={TH}>Kind</th><th style={TH}></th></tr>
            </thead>
            <tbody>
              {setup.accounts.map(a => (
                <tr key={a.id} style={a.is_active ? undefined : { opacity: 0.5 }}>
                  <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap' }}>{a.code}</td>
                  <td style={TD}>{a.name}{!a.is_active && ' (not used)'}</td>
                  <td style={TD}>{KINDS[a.type] || a.type}</td>
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
                <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {setup.types.map(t => <option key={t} value={t}>{KINDS[t] || t}</option>)}
                </select></div>
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
