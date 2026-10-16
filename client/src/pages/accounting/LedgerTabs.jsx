// Accounting step 2, phase B (migration 111): the accountant's own journal
// entries, the first day of the books + opening balances, the balance sheet
// and the trial balance. Tabs of pages/Accounting.jsx.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { propertyToday } from '../../lib/propertyTime';

const TH = { textAlign: 'left', padding: '6px 8px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const TD = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const R = { textAlign: 'right', whiteSpace: 'nowrap' };
const KINDS = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' };
const amt = n => (Math.round(Number(n) || 0) ? Math.round(Number(n)).toLocaleString('id-ID') : '');
const money = n => { const v = Math.round(Number(n) || 0); return v ? v.toLocaleString('id-ID') : '–'; };
// A typed amount: "8500000", "8.500.000" or "8.500.000,50" (Indonesian), "8500000.5".
function num(s) {
  let t = String(s ?? '').replace(/[\s Rp]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return parseFloat(t) || 0;
}
function fmtLong(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function shiftDate(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const errorOf = err => err.response?.data?.error || 'Something went wrong';

async function download(path, params, name, type) {
  try {
    const r = await api.get(path, { params, responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([r.data], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  } catch {
    alert('Failed to make the file');
  }
}
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function useAccounts() {
  const [accounts, setAccounts] = useState([]);
  useEffect(() => { api.get('/api/accounting/setup').then(r => setAccounts(r.data.accounts)).catch(() => {}); }, []);
  return accounts;
}

// Account picker grouped by kind (active accounts only).
function AccountSelect({ accounts, value, onChange }) {
  const groups = useMemo(() => Object.keys(KINDS).map(k => [k, accounts.filter(a => a.is_active && a.type === k)]).filter(([, l]) => l.length), [accounts]);
  return (
    <select className="form-select" value={value || ''} onChange={e => onChange(e.target.value)} style={{ minWidth: 220 }}>
      <option value="">— account —</option>
      {groups.map(([k, list]) => (
        <optgroup key={k} label={KINDS[k]}>
          {list.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function Modal({ title, wide, onClose, children, footer }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" style={wide ? { maxWidth: 900, width: '96vw' } : undefined}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────── Journal entries ───────────────────────────

export function EntriesTab() {
  const today = propertyToday();
  const accounts = useAccounts();
  const [st, setSt] = useState(null);           // { books_start, closed_through }
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState('');
  const [form, setForm] = useState(null);       // a new entry (prefilled when copying)
  const [view, setView] = useState(null);       // entry id
  const [opening, setOpening] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion(v => v + 1);

  useEffect(() => { api.get('/api/accounting/settings').then(r => setSt(r.data)).catch(err => setError(errorOf(err))); }, [version]);
  useEffect(() => {
    let off = false;
    const t = setTimeout(() => {
      api.get('/api/accounting/entries', { params: { from, to: to || undefined, q: q || undefined, voided: showVoided ? 1 : undefined } })
        .then(r => { if (!off) setList(r.data); })
        .catch(err => { if (!off) setError(errorOf(err)); });
    }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [from, to, q, showVoided, version]);

  return (
    <>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      {st && <BooksCard st={st} today={today} onChanged={reload} onOpening={() => setOpening(true)} />}

      <div className="card mt-3">
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Journal entries</div>
          <button className="btn btn-primary btn-sm" onClick={() => setForm({})}>+ New entry</button>
        </div>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          What the PMS doesn't record by itself — payroll, depreciation, rent, service charge paid to staff, bank fees, money moved between accounts.
          An entry is never edited: void it while its day is open, or reverse it once the day is closed.{' '}
          <Link to="/guide/journal-entries">📘 Guide</Link>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 160 }} aria-label="From" />
          <span className="text-muted">to</span>
          <input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 160 }} aria-label="To" />
          <input className="form-input" placeholder="Search description or reference" value={q} onChange={e => setQ(e.target.value)} style={{ width: 240 }} />
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} /> Show voided
          </label>
        </div>
        {!list ? <div className="text-muted">Loading…</div> : !list.length ? (
          <div className="text-muted" style={{ fontSize: 13 }}>No entries in this period.</div>
        ) : (
          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr><th style={TH}>No.</th><th style={TH}>Date</th><th style={TH}>Description</th><th style={TH}>Reference</th><th style={{ ...TH, ...R }}>Amount</th><th style={TH}>By</th></tr>
              </thead>
              <tbody>
                {list.map(e => (
                  <tr key={e.id} onClick={() => setView(e.id)} style={{ cursor: 'pointer', opacity: e.is_voided ? 0.5 : 1 }}>
                    <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.entry_no}</td>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtLong(e.date)}</td>
                    <td style={{ ...TD, textDecoration: e.is_voided ? 'line-through' : undefined }}>
                      {e.kind === 'opening' && <span className="badge" style={{ marginRight: 6 }}>Opening</span>}
                      {e.memo}
                      {e.is_voided && <div className="text-muted" style={{ fontSize: 12, textDecoration: 'none' }}>Voided — {e.void_reason}</div>}
                      {e.reversed_by && <div className="text-muted" style={{ fontSize: 12 }}>Reversed by {e.reversed_by}</div>}
                      {e.reverses && <div className="text-muted" style={{ fontSize: 12 }}>Reverses {e.reverses}</div>}
                    </td>
                    <td style={TD}>{e.reference || ''}</td>
                    <td style={{ ...TD, ...R }}>{money(e.total)}</td>
                    <td style={{ ...TD, fontSize: 12 }}>{e.created_by_name || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && <EntryForm accounts={accounts} st={st} today={today} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {view && <EntryView id={view} today={today} onClose={() => setView(null)}
        onChanged={() => { setView(null); reload(); }}
        onCopy={e => { setView(null); setForm({ memo: e.memo, reference: '', lines: e.lines.map(l => ({ account_id: l.account_id, debit: l.debit || '', credit: l.credit || '', memo: l.memo || '' })) }); }} />}
      {opening && <OpeningModal onClose={() => setOpening(false)} onSaved={() => { setOpening(false); reload(); }} />}
    </>
  );
}

function BooksCard({ st, today, onChanged, onOpening }) {
  const [date, setDate] = useState(st.books_start || today.slice(0, 8) + '01');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = !!st.closed_through;
  async function save() {
    setBusy(true); setError('');
    try { await api.put('/api/accounting/settings', { books_start: date }); onChanged(); }
    catch (err) { setError(errorOf(err)); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 4 }}>First day of the books</div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        The day the books move from the old system to the PMS. The balance sheet and trial balance add up from this day,
        and the opening balances (what the old system's books said at the end of the day before) are dated on it.
      </div>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {locked ? (
          <span style={{ fontWeight: 600 }}>{fmtLong(st.books_start)} <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>· 🔒 days are closed, it can't move</span></span>
        ) : (<>
          <input className="form-input" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} style={{ width: 170 }} />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !date || date === st.books_start}>{busy ? 'Saving…' : st.books_start ? 'Change' : 'Save'}</button>
          {st.books_start && <span className="text-muted" style={{ fontSize: 12 }}>Now: {fmtLong(st.books_start)}</span>}
        </>)}
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={onOpening} disabled={!st.books_start}>Opening balances…</button>
      </div>
    </div>
  );
}

const blankLine = () => ({ account_id: '', debit: '', credit: '', memo: '' });

function EntryForm({ accounts, st, today, initial, onClose, onSaved }) {
  const firstOpen = st?.closed_through ? shiftDate(st.closed_through, 1) : (st?.books_start || '');
  const [date, setDate] = useState(today < firstOpen ? firstOpen : today);
  const [memo, setMemo] = useState(initial.memo || '');
  const [reference, setReference] = useState(initial.reference || '');
  const [lines, setLines] = useState(initial.lines?.length ? [...initial.lines, blankLine()] : [blankLine(), blankLine(), blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (i, patch) => setLines(ls => {
    const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l));
    // A typed debit clears the credit and the other way round.
    if (patch.debit) next[i].credit = '';
    if (patch.credit) next[i].debit = '';
    if (i === next.length - 1 && (next[i].account_id || next[i].debit || next[i].credit)) next.push(blankLine());
    return next;
  });
  const dr = lines.reduce((s, l) => s + num(l.debit), 0), cr = lines.reduce((s, l) => s + num(l.credit), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const used = lines.filter(l => l.account_id && (num(l.debit) || num(l.credit)));
  const canSave = memo.trim() && date && used.length >= 2 && Math.abs(diff) < 0.005 && dr > 0;

  // Puts the difference on the line being typed (or a new one).
  function balance(i) {
    if (!diff) return;
    set(i, diff > 0 ? { credit: String(diff + num(lines[i].credit) - num(lines[i].debit)) } : { debit: String(-diff + num(lines[i].debit) - num(lines[i].credit)) });
  }

  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/api/accounting/entries', {
        date, memo, reference,
        lines: used.map(l => ({ account_id: l.account_id, debit: num(l.debit), credit: num(l.credit), memo: l.memo })),
      });
      onSaved();
    } catch (err) { setError(errorOf(err)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="New journal entry" wide onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!canSave || busy}>{busy ? 'Saving…' : 'Save entry'}</button>
      </>}>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        <div className="form-group" style={{ width: 170 }}><label className="form-label">Date *</label>
          <input className="form-input" type="date" value={date} min={firstOpen || undefined} onChange={e => setDate(e.target.value)} /></div>
        <div className="form-group" style={{ flex: '1 1 280px' }}><label className="form-label">Description *</label>
          <input className="form-input" value={memo} maxLength={300} onChange={e => setMemo(e.target.value)} placeholder="e.g. Payroll October" /></div>
        <div className="form-group" style={{ width: 180 }}><label className="form-label">Reference</label>
          <input className="form-input" value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="e.g. PAY-10" /></div>
      </div>
      {st?.closed_through && <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Days up to {fmtLong(st.closed_through)} are closed — date the entry after that.</div>}
      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr><th style={TH}>Account</th><th style={{ ...TH, ...R }}>Debit</th><th style={{ ...TH, ...R }}>Credit</th><th style={TH}>Line note</th><th style={TH}></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={TD}><AccountSelect accounts={accounts} value={l.account_id} onChange={v => set(i, { account_id: v })} /></td>
                <td style={TD}><input className="form-input" inputMode="decimal" value={l.debit} onChange={e => set(i, { debit: e.target.value })} style={{ textAlign: 'right', width: 140 }} /></td>
                <td style={TD}><input className="form-input" inputMode="decimal" value={l.credit} onChange={e => set(i, { credit: e.target.value })} style={{ textAlign: 'right', width: 140 }} /></td>
                <td style={TD}><input className="form-input" value={l.memo} maxLength={200} onChange={e => set(i, { memo: e.target.value })} /></td>
                <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                  {l.account_id && diff !== 0 && <button className="btn btn-secondary btn-sm" title="Put the difference on this line" onClick={() => balance(i)}>=</button>}{' '}
                  {lines.length > 2 && <button className="btn btn-secondary btn-sm" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line">✕</button>}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>Total</td>
              <td style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>{money(dr)}</td>
              <td style={{ ...TD, ...R, fontWeight: 700, borderBottom: 'none' }}>{money(cr)}</td>
              <td colSpan={2} style={{ ...TD, borderBottom: 'none', fontSize: 12, color: diff ? 'var(--danger, #DC2626)' : 'var(--success, #059669)' }}>
                {diff ? `Not balanced — difference ${Math.abs(diff).toLocaleString('id-ID')}` : dr ? '✓ Balanced' : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
        Type amounts without dots (e.g. 8500000). Debits must equal credits. The “=” button puts the difference on that line.
      </div>
    </Modal>
  );
}

function EntryView({ id, today, onClose, onChanged, onCopy }) {
  const [e, setE] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState(null);   // 'void' | 'reverse'
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/api/accounting/entries/${id}`).then(r => setE(r.data)).catch(err => setError(errorOf(err))); }, [id]);

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); onChanged(); }
    catch (err) { setError(errorOf(err)); }
    finally { setBusy(false); }
  }
  const voidIt = () => run(() => api.post(`/api/accounting/entries/${id}/void`, { reason }));
  const reverse = () => run(() => api.post(`/api/accounting/entries/${id}/reverse`, { date }));

  const canVoid = e && !e.is_voided && !e.day_closed && e.kind === 'manual';
  const canReverse = e && !e.is_voided && !e.reversed_by && e.kind === 'manual';
  return (
    <Modal title={e ? `${e.entry_no} · ${fmtLong(e.date)}` : 'Journal entry'} wide onClose={onClose}
      footer={e && <>
        {e.kind === 'manual' && <button className="btn btn-secondary" onClick={() => onCopy(e)}>Copy as a new entry</button>}
        <span style={{ flex: 1 }} />
        {canVoid && <button className="btn btn-danger" onClick={() => setMode('void')}>Void</button>}
        {canReverse && <button className="btn btn-secondary" onClick={() => setMode('reverse')}>Reverse</button>}
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </>}>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      {!e ? <div className="text-muted">Loading…</div> : (<>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{e.memo}</div>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          {e.reference && <>Ref. {e.reference} · </>}by {e.created_by_name || '—'}, {new Date(e.created_at).toLocaleString('en-GB')}
          {e.day_closed && <> · 🔒 day closed</>}
          {e.reverses && <> · reverses {e.reverses}</>}
          {e.reversed_by && <> · reversed by {e.reversed_by}</>}
        </div>
        {e.is_voided && <div className="alert alert-warn"><div>Voided by {e.voided_by_name || '—'}: {e.void_reason}</div></div>}
        <div className="table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead><tr><th style={TH}>Account</th><th style={TH}>Note</th><th style={{ ...TH, ...R }}>Debit</th><th style={{ ...TH, ...R }}>Credit</th></tr></thead>
            <tbody>
              {e.lines.map(l => (
                <tr key={l.line_no}>
                  <td style={{ ...TD, paddingLeft: l.credit ? 28 : 8 }}>{l.account_code} · {l.account_name}</td>
                  <td style={{ ...TD, fontSize: 12 }}>{l.memo || ''}</td>
                  <td style={{ ...TD, ...R }}>{amt(l.debit)}</td>
                  <td style={{ ...TD, ...R }}>{amt(l.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mode === 'void' && (
          <div className="card mt-3">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Void {e.entry_no}? It is kept, struck through, and no longer counts.</div>
            <input className="form-input" placeholder="Why (required)" value={reason} onChange={ev => setReason(ev.target.value)} maxLength={300} />
            <div className="flex gap-2 mt-3">
              <button className="btn btn-danger btn-sm" onClick={voidIt} disabled={busy || !reason.trim()}>{busy ? 'Voiding…' : 'Yes, void'}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setMode(null)}>Cancel</button>
            </div>
          </div>
        )}
        {mode === 'reverse' && (
          <div className="card mt-3">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Reverse {e.entry_no}: a new entry with debits and credits swapped, on the date below.</div>
            <input className="form-input" type="date" value={date} onChange={ev => setDate(ev.target.value)} style={{ width: 170 }} />
            <div className="flex gap-2 mt-3">
              <button className="btn btn-primary btn-sm" onClick={reverse} disabled={busy || !date}>{busy ? 'Reversing…' : 'Yes, reverse'}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setMode(null)}>Cancel</button>
            </div>
          </div>
        )}
      </>)}
    </Modal>
  );
}

function OpeningModal({ onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [vals, setVals] = useState({});   // account id → { debit, credit } as typed
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/api/accounting/opening').then(r => {
      setData(r.data);
      setVals(Object.fromEntries(r.data.accounts.filter(a => a.code !== '3190').map(a => [a.id, {
        debit: a.amount > 0 ? String(a.amount) : '', credit: a.amount < 0 ? String(-a.amount) : '',
      }])));
    }).catch(err => setError(errorOf(err)));
  }, []);
  if (!data) return <Modal title="Opening balances" onClose={onClose}>{error ? <div className="alert alert-error"><div>{error}</div></div> : 'Loading…'}</Modal>;

  const signed = id => num(vals[id]?.debit) - num(vals[id]?.credit);
  const shown = data.accounts.filter(a => a.code !== '3190' && (a.is_active || signed(a.id)));
  const dr = shown.reduce((s, a) => s + Math.max(signed(a.id), 0), 0);
  const cr = shown.reduce((s, a) => s + Math.max(-signed(a.id), 0), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const set = (id, side, v) => setVals(x => ({ ...x, [id]: side === 'debit' ? { debit: v, credit: v ? '' : x[id]?.credit } : { credit: v, debit: v ? '' : x[id]?.debit } }));
  const usePms = () => setVals(x => {
    const next = { ...x };
    for (const a of data.accounts) {
      if (!a.pms_owned || a.code === '3190') continue;
      next[a.id] = { debit: a.pms_before > 0 ? String(Math.round(a.pms_before * 100) / 100) : '', credit: a.pms_before < 0 ? String(Math.round(-a.pms_before * 100) / 100) : '' };
    }
    return next;
  });
  const hasPms = data.accounts.some(a => a.pms_before);

  async function save() {
    setBusy(true); setError('');
    try {
      await api.put('/api/accounting/opening', { balances: shown.map(a => ({ account_id: a.id, amount: signed(a.id) })).filter(b => b.amount) });
      onSaved();
    } catch (err) { setError(errorOf(err)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Opening balances — ${fmtLong(data.books_start)}`} wide onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        {data.editable && <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save opening balances'}</button>}
      </>}>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Type each account's balance from the old system's balance sheet at the end of {fmtLong(shiftDate(data.books_start, -1))}:
        assets as a debit, liabilities and equity as a credit (a negative balance on the other side).
        Any difference goes to 3190 Opening balance equity, so the books always balance. Saving replaces the opening balances saved before.
        {data.entry && <> Saved now as {data.entry.entry_no}.</>}
        {!data.editable && <b> {fmtLong(data.books_start)} is closed — the opening balances can't change any more.</b>}
      </div>
      {hasPms && (
        <div className="alert alert-warn" style={{ marginBottom: 8 }}><div>
          The PMS already has amounts before {fmtLong(data.books_start)} — shown as “PMS before”. For what guests and agents owe, deposits,
          and service charge / tax / commission to pay (marked ★), the PMS figure is usually the right one:
          {data.editable && <> <button className="btn btn-secondary btn-sm" onClick={usePms}>Use the PMS figures for ★ accounts</button></>}.
          Cash and bank: type the old system's balance.
        </div></div>
      )}
      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr><th style={TH}>Account</th><th style={TH}>Kind</th>{hasPms && <th style={{ ...TH, ...R }}>PMS before</th>}<th style={{ ...TH, ...R }}>Debit</th><th style={{ ...TH, ...R }}>Credit</th></tr></thead>
          <tbody>
            {shown.map(a => (
              <tr key={a.id}>
                <td style={TD}>{a.code} · {a.name}{a.pms_owned && hasPms ? ' ★' : ''}</td>
                <td style={{ ...TD, fontSize: 12 }}>{KINDS[a.type]}</td>
                {hasPms && <td style={{ ...TD, ...R, fontSize: 12, color: 'var(--text-muted)' }}>{a.pms_before ? `${Math.abs(Math.round(a.pms_before)).toLocaleString('id-ID')} ${a.pms_before > 0 ? 'Dr' : 'Cr'}` : ''}</td>}
                <td style={TD}><input className="form-input" inputMode="decimal" disabled={!data.editable} value={vals[a.id]?.debit || ''} onChange={e => set(a.id, 'debit', e.target.value)} style={{ textAlign: 'right', width: 150, marginLeft: 'auto' }} /></td>
                <td style={TD}><input className="form-input" inputMode="decimal" disabled={!data.editable} value={vals[a.id]?.credit || ''} onChange={e => set(a.id, 'credit', e.target.value)} style={{ textAlign: 'right', width: 150, marginLeft: 'auto' }} /></td>
              </tr>
            ))}
            <tr>
              <td colSpan={hasPms ? 3 : 2} style={{ ...TD, ...R, fontWeight: 700 }}>Total</td>
              <td style={{ ...TD, ...R, fontWeight: 700 }}>{money(dr)}</td>
              <td style={{ ...TD, ...R, fontWeight: 700 }}>{money(cr)}</td>
            </tr>
            {diff !== 0 && (
              <tr>
                <td colSpan={hasPms ? 3 : 2} style={{ ...TD, ...R, borderBottom: 'none' }}>3190 · Opening balance equity (the difference)</td>
                <td style={{ ...TD, ...R, borderBottom: 'none' }}>{diff < 0 ? money(-diff) : ''}</td>
                <td style={{ ...TD, ...R, borderBottom: 'none' }}>{diff > 0 ? money(diff) : ''}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ─────────────────────────── Balance sheet ───────────────────────────

function NeedsBooks({ error }) {
  return (
    <div className="card"><div style={{ fontSize: 13 }}>
      {error}{error?.includes('first day') && <> — on the <b>Journal entries</b> tab.</>}
    </div></div>
  );
}

export function BalanceSheetTab() {
  const today = propertyToday();
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/accounting/balance-sheet', { params: { date } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) { setData(null); setError(errorOf(err)); } })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [date]);
  const lastMonthEnd = shiftDate(today.slice(0, 8) + '01', -1);

  const section = (title, rows, totalLabel, total) => [
    <tr key={`h-${title}`}><td colSpan={2} style={{ ...TD, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', paddingTop: 16, borderBottom: 'none' }}>{title}</td></tr>,
    ...(rows.length ? rows : [{ name: 'Nothing', amount: 0 }]).map((r, i) => (
      <tr key={`${title}-${i}`}>
        <td style={{ ...TD, paddingLeft: 20, fontStyle: r.virtual ? 'italic' : undefined }}>{r.code ? `${r.code} · ` : ''}{r.name}</td>
        <td style={{ ...TD, ...R, color: r.amount < 0 ? 'var(--danger, #DC2626)' : undefined }}>{money(r.amount)}</td>
      </tr>
    )),
    <tr key={`t-${title}`}>
      <td style={{ ...TD, fontWeight: 700, borderTop: '1.5px solid var(--text, #111827)' }}>{totalLabel}</td>
      <td style={{ ...TD, ...R, fontWeight: 700, borderTop: '1.5px solid var(--text, #111827)' }}>{money(total)}</td>
    </tr>,
  ];

  return (
    <>
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13 }}>At the end of</span>
        <input className="form-input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={{ width: 170 }} />
        <button className={`btn btn-sm ${date === today ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDate(today)}>Today</button>
        <button className={`btn btn-sm ${date === lastMonthEnd ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDate(lastMonthEnd)}>End of last month</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" disabled={!data} onClick={() => download('/api/accounting/balance-sheet/xlsx', { date }, `balance-sheet-${date}.xlsx`, XLSX)}>⬇ Excel</button>
        <button className="btn btn-primary btn-sm" disabled={!data} onClick={() => download('/api/accounting/balance-sheet/pdf', { date }, `balance-sheet-${date}.pdf`, 'application/pdf')}>⬇ PDF</button>
      </div>
      {loading ? <div className="text-muted">Loading…</div> : error ? <NeedsBooks error={error} /> : data && (<>
        {data.unmapped.length > 0 && <div className="alert alert-warn"><div><b>No account chosen for:</b> {data.unmapped.join('; ')}. Choose one on the Accounts tab.</div></div>}
        <div className="card">
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Books start {fmtLong(data.books_start)}. {data.closed_through ? <>Closed through {fmtLong(data.closed_through)}.</> : <>No day is closed yet.</>}{' '}
            {data.balanced ? <span style={{ color: 'var(--success, #059669)' }}>✓ Assets = liabilities + equity</span>
              : <b style={{ color: 'var(--danger, #DC2626)' }}>Not balanced by Rp {money(data.totals.difference)}</b>}
          </div>
          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {section('Assets', data.assets, 'Total assets', data.totals.assets)}
                {section('Liabilities', data.liabilities, 'Total liabilities', data.totals.liabilities)}
                {section('Equity', data.equity, 'Total equity', data.totals.equity)}
                <tr>
                  <td style={{ ...TD, fontWeight: 700, background: 'var(--primary-light, rgba(139,30,63,0.07))' }}>Total liabilities & equity</td>
                  <td style={{ ...TD, ...R, fontWeight: 700, background: 'var(--primary-light, rgba(139,30,63,0.07))' }}>{money(data.totals.liabilities_equity)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </>)}
    </>
  );
}

// ─────────────────────────── Trial balance ───────────────────────────

export function TrialBalanceTab() {
  const today = propertyToday();
  const monthStart = today.slice(0, 8) + '01';
  const lastEnd = shiftDate(monthStart, -1);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let off = false;
    setLoading(true); setError('');
    api.get('/api/accounting/trial-balance', { params: { from, to } })
      .then(r => { if (!off) setData(r.data); })
      .catch(err => { if (!off) { setData(null); setError(errorOf(err)); } })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [from, to]);
  const quick = [['This month', monthStart, today], ['Last month', lastEnd.slice(0, 8) + '01', lastEnd], ['This year', today.slice(0, 4) + '-01-01', today]];
  const D = (o, k) => <td style={{ ...TD, ...R }}>{amt(o[k])}</td>;

  return (
    <>
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {quick.map(([l, f, t]) => <button key={l} className={`btn btn-sm ${from === f && to === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setFrom(f); setTo(t); }}>{l}</button>)}
        <input className="form-input" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} style={{ width: 160 }} aria-label="From" />
        <span className="text-muted">to</span>
        <input className="form-input" type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} style={{ width: 160 }} aria-label="To" />
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" disabled={!data} onClick={() => download('/api/accounting/trial-balance/xlsx', { from, to }, `trial-balance-${from}_to_${to}.xlsx`, XLSX)}>⬇ Excel</button>
      </div>
      {loading ? <div className="text-muted">Loading…</div> : error ? <NeedsBooks error={error} /> : data && (<>
        {data.unmapped.length > 0 && <div className="alert alert-warn"><div><b>No account chosen for:</b> {data.unmapped.join('; ')}.</div></div>}
        <div className="card">
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {data.from !== from && <>The books start on {fmtLong(data.books_start)}, so the period starts there. </>}
            Revenue and expense accounts start each year at zero; earlier years' profit is shown under equity.{' '}
            {data.balanced ? <span style={{ color: 'var(--success, #059669)' }}>✓ Debits = credits</span> : <b style={{ color: 'var(--danger, #DC2626)' }}>Not balanced</b>}
          </div>
          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={TH}>Account</th>
                  <th style={{ ...TH, ...R }}>Opening Dr</th><th style={{ ...TH, ...R }}>Opening Cr</th>
                  <th style={{ ...TH, ...R }}>Debit</th><th style={{ ...TH, ...R }}>Credit</th>
                  <th style={{ ...TH, ...R }}>Closing Dr</th><th style={{ ...TH, ...R }}>Closing Cr</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...TD, fontStyle: r.virtual ? 'italic' : undefined }}>{r.code ? `${r.code} · ` : ''}{r.name}</td>
                    {D(r.opening, 'debit')}{D(r.opening, 'credit')}{D(r, 'debit')}{D(r, 'credit')}{D(r.closing, 'debit')}{D(r.closing, 'credit')}
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ ...TD, borderTop: '1.5px solid var(--text, #111827)' }}>Total</td>
                  {[data.totals.opening.debit, data.totals.opening.credit, data.totals.debit, data.totals.credit, data.totals.closing.debit, data.totals.closing.credit]
                    .map((v, i) => <td key={i} style={{ ...TD, ...R, borderTop: '1.5px solid var(--text, #111827)' }}>{money(v)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </>)}
    </>
  );
}
