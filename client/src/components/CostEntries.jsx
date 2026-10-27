// The entries of one department on the Costs page (pages/Costs.jsx), in a
// window: category chips (with count and total), search, sort, 50 at a time;
// an entry opens its details inside the same window (← All entries goes back
// to the same filter), with a link to its own page when the user may open it.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const dayShort = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const dateTime = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const PAGE = 50;
const STATUS = { paid: ['Paid', 'badge-green'], part_paid: ['Part paid', 'badge-yellow'], not_paid: ['Not paid', 'badge-gray'], overdue: ['Overdue', 'badge-red'], voided: ['Voided', 'badge-gray'] };

function EntryDetail({ entry, month, onBack }) {
  const { can, hasModule } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/api/costs/entries/${entry.kind}/${entry.id}`).then(r => setD(r.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load'));
  }, [entry.kind, entry.id]);
  const row = (label, value) => (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
      <div className="text-muted" style={{ fontSize: 13 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value || <span className="text-muted">—</span>}</div>
    </div>
  );
  const isBill = entry.kind === 'bill';
  const link = isBill
    ? can('payables') && hasModule('accounting') && { to: `/payables?bill=${entry.id}`, label: 'Open in Payables' }
    : can('expenses') && hasModule('back_office') && { to: `/expenses?expense=${entry.id}&month=${month}`, label: 'Open in Expenses' };

  return (
    <div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: 12 }}>← All entries</button>
      {error && <div className="alert alert-error">{error}</div>}
      {!d ? (!error && <div className="text-muted">Loading…</div>) : (<>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ fontSize: 13 }} className="text-muted">{isBill ? `Supplier bill ${d.bill_no}` : 'Expense'}</div>
          {isBill && STATUS[d.status] && <span className={`badge ${STATUS[d.status][1]}`}>{STATUS[d.status][0]}</span>}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{idr(d.amount)}</div>
        {row(isBill ? 'Bill date' : 'Date', dayShort(d.day))}
        {row('What', d.text)}
        {row('Category', d.category_label)}
        {row('Department', d.department_label)}
        {row('Supplier', d.supplier)}
        {row(isBill ? 'Their invoice no.' : 'Reference', d.reference)}
        {!isBill && row('Paid with', d.paid_with)}
        {isBill && row('Due', d.due_date && dayShort(d.due_date))}
        {isBill && row('Paid', `${idr(d.paid)}${d.balance > 0.004 ? ` · ${idr(d.balance)} still to pay` : ''}`)}
        {d.po_number && row('Purchase order', d.po_number)}
        {row('Recorded', [d.created_by, dateTime(d.created_at)].filter(Boolean).join(' · '))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          {link && <Link to={link.to} className="btn btn-secondary btn-sm">{link.label} →</Link>}
          <span className="text-muted" style={{ fontSize: 12 }}>Wrong department? Change it {isBill ? 'on the bill' : 'on the expense'}.</span>
        </div>
      </>)}
    </div>
  );
}

export default function CostEntries({ dept, entries, monthLabel, month, initialCategory = '', initialEntry = null, onClose }) {
  const [cat, setCat] = useState(initialCategory);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('amount');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState(initialEntry);

  useEffect(() => { setLimit(PAGE); }, [cat, q, sort]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { if (open) setOpen(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Chips: every category of the department, biggest first, with count + total.
  const chips = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      const c = m.get(e.category) || { category: e.category, label: e.category_label, n: 0, amount: 0 };
      c.n += 1; c.amount += e.amount; m.set(e.category, c);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [entries]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    const list = entries.filter(e => (!cat || e.category === cat)
      && (!words || [e.text, e.supplier, e.reference, e.bill_no, e.category_label].join(' ').toLowerCase().includes(words)));
    return sort === 'amount' ? [...list].sort((a, b) => b.amount - a.amount)
      : [...list].sort((a, b) => (b.day > a.day ? 1 : b.day < a.day ? -1 : b.amount - a.amount));
  }, [entries, cat, q, sort]);
  const shownTotal = shown.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal cost-entries">
        <div className="modal-header">
          <div>
            <div className="modal-title">{dept.label} · {monthLabel}</div>
            <div className="text-muted" style={{ fontSize: 13 }}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {idr(dept.amount)}</div>
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {open ? <EntryDetail entry={open} month={month} onBack={() => setOpen(null)} /> : (<>
            <div className="cost-chips" role="group" aria-label="Category">
              <button type="button" className={`cost-chip${!cat ? ' active' : ''}`} onClick={() => setCat('')}>
                All <span>{entries.length}</span>
              </button>
              {chips.map(c => (
                <button key={c.category} type="button" className={`cost-chip${cat === c.category ? ' active' : ''}`} onClick={() => setCat(c.category)}>
                  {c.label} <span>{c.n} · {idr(c.amount)}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
              <input className="form-input" style={{ flex: '1 1 200px', height: 34 }} placeholder="Search what, supplier, reference…"
                     value={q} onChange={e => setQ(e.target.value)} />
              <div className="seg">
                <button type="button" className={sort === 'amount' ? 'active' : ''} onClick={() => setSort('amount')}>Biggest</button>
                <button type="button" className={sort === 'newest' ? 'active' : ''} onClick={() => setSort('newest')}>Newest</button>
              </div>
            </div>
            <div className="text-muted" style={{ fontSize: 13, marginBottom: 6 }}>
              {shown.length} {shown.length === 1 ? 'entry' : 'entries'} · <b style={{ color: 'var(--text)' }}>{idr(shownTotal)}</b>
            </div>
            {shown.length === 0 ? <div className="text-muted" style={{ padding: '16px 0' }}>Nothing matches.</div> : (
              <div className="cost-list">
                {shown.slice(0, limit).map(e => (
                  <button key={e.kind + e.id} type="button" className="cost-item" onClick={() => setOpen(e)}>
                    <span className="cost-item-day">{dayShort(e.day).replace(/ \d{4}$/, '')}</span>
                    <span className="cost-item-main">
                      <span className="cost-item-what">{e.text || e.category_label}</span>
                      <span className="text-muted cost-item-sub">
                        {[!cat && e.category_label, e.kind === 'bill' ? e.bill_no : 'Expense', e.supplier, e.reference].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="cost-item-amt">{idr(e.amount)}</span>
                  </button>
                ))}
              </div>
            )}
            {shown.length > limit && (
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setLimit(l => l + PAGE)}>
                Show {Math.min(PAGE, shown.length - limit)} more · {shown.length - limit} left
              </button>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}
