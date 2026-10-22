import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import Icon from '../components/Icon';
import ReasonModal from '../components/ReasonModal';

// Finance → Payables (migration 129): supplier bills recorded when they
// arrive, payments to suppliers, what the hotel owes. Owner or the
// `payables` permission. ?from_po=<id> opens a new bill filled from a
// received purchase order (Purchasing & Stock → Make bill).

const idr = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const fmtDate = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const STATUS = { open: ['Not paid', 'amber'], part_paid: ['Part paid', 'blue'], paid: ['Paid', 'green'], voided: ['Voided', 'gray'] };
const TYPE_LABEL = { expense: 'Costs', asset: 'Assets (stock, prepaid, equipment)', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue' };
const errText = err => err.response?.data?.error || err.message || 'Something went wrong';

function AccountSelect({ accounts, value, onChange }) {
  const groups = ['expense', 'asset', 'liability', 'equity', 'revenue']
    .map(t => [t, accounts.filter(a => a.type === t)]).filter(([, l]) => l.length);
  return (
    <select className="form-select" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">Choose an account…</option>
      {groups.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABEL[t]}>
          {list.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export default function Payables() {
  const [params, setParams] = useSearchParams();
  const [setup, setSetup] = useState(null);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('suppliers');
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [status, setStatus] = useState('open');
  const [supplierId, setSupplierId] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [billForm, setBillForm] = useState(null);      // { bill?, prefill? }
  const [viewing, setViewing] = useState(null);        // bill id
  const [paying, setPaying] = useState(null);          // { supplier_id, bill_id? }
  const [supplierEdit, setSupplierEdit] = useState(null);
  const [voidingPay, setVoidingPay] = useState(null);

  const loadSetup = () => api.get('/api/payables/setup').then(r => setSetup(r.data)).catch(e => setError(errText(e)));
  const loadSummary = () => api.get('/api/payables/summary').then(r => setSummary(r.data)).catch(e => setError(errText(e)));
  const loadBills = () => api.get('/api/payables/bills', { params: { status, supplier_id: supplierId || undefined, q: q || undefined } })
    .then(r => setBills(r.data)).catch(e => setError(errText(e)));
  const loadPayments = () => api.get('/api/payables/payments', { params: { supplier_id: supplierId || undefined } })
    .then(r => setPayments(r.data)).catch(e => setError(errText(e)));
  const reloadAll = () => { loadSummary(); loadBills(); loadPayments(); };

  useEffect(() => { loadSetup(); loadSummary(); }, []);
  useEffect(() => { loadBills(); }, [status, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(loadBills, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'payments') loadPayments(); }, [tab, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Make bill from a purchase order
  useEffect(() => {
    const po = params.get('from_po');
    if (!po || !setup) return;
    api.get(`/api/payables/from-po/${po}`).then(r => {
      const d = r.data;
      if (!d.lines.length) { setError(`Everything received on ${d.purchase_order.po_number} is already on a bill.`); return; }
      setBillForm({ prefill: {
        supplier_id: d.supplier.id, purchase_order_id: d.purchase_order.id, po_number: d.purchase_order.po_number,
        lines: d.lines.map(l => ({ account_id: d.supplier.default_account_id || '', description: l.description, amount: String(l.amount), po_item_id: l.po_item_id })),
      } });
    }).catch(e => setError(errText(e)));
    params.delete('from_po'); setParams(params, { replace: true });
  }, [setup]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSupplierBills = id => { setSupplierId(id); setStatus('open'); setTab('bills'); };
  const t = summary?.totals;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Payables</div>
          <div className="page-subtitle">What the hotel owes suppliers — bills recorded when they arrive, paid later · <Link to="/guide/payables">Guide</Link></div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setPaying({ supplier_id: supplierId || '' })} disabled={!setup}>Pay a supplier</button>
          <button className="btn btn-primary" onClick={() => setBillForm({})} disabled={!setup}><Icon name="plus" />New bill</button>
        </div>
      </div>
      <div className="tab-bar">
        {[['suppliers', 'Suppliers'], ['bills', 'Bills'], ['payments', 'Payments']].map(([k, l]) => (
          <button key={k} type="button" className={`tab-bar-item${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {error && <div className="alert alert-error mb-3"><div>{error}</div></div>}

      {t && (
        <div className="stat-grid stat-grid-money" style={{ margin: '12px 0' }}>
          <div className="stat-card"><div className="stat-label">Owed to suppliers</div><div className="stat-value">{idr(t.owed)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{t.bills} bill{t.bills === 1 ? '' : 's'} not paid</div></div>
          <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-value" style={{ color: summary.overdue > 0 ? 'var(--danger, #DC2626)' : undefined }}>{idr(summary.overdue)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>past the due date</div></div>
          <div className="stat-card"><div className="stat-label">Due in the next 7 days</div><div className="stat-value">{idr(summary.due_this_week)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>not overdue yet</div></div>
        </div>
      )}

      {tab === 'suppliers' && (
        <SuppliersTab summary={summary} setup={setup} onOpen={openSupplierBills}
          onPay={id => setPaying({ supplier_id: id })} onEdit={s => setSupplierEdit(s)} onAdd={() => setSupplierEdit({})} />
      )}

      {tab === 'bills' && (
        <>
          <div className="page-toolbar">
            <div className="seg">
              {[['open', 'Not paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['voided', 'Voided'], ['all', 'All']].map(([k, l]) => (
                <button key={k} type="button" className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>
              ))}
            </div>
            <div className="page-toolbar-end flex gap-2" style={{ flexWrap: 'wrap' }}>
              <select className="form-select" style={{ width: 200 }} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">All suppliers</option>
                {setup?.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input className="form-input" style={{ width: 200 }} placeholder="Search bill no., invoice…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table style={{ minWidth: 820 }}>
                <thead><tr><th>Bill</th><th>Supplier</th><th>Their invoice</th><th>Bill date</th><th>Due</th>
                  <th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Still owed</th><th>Status</th></tr></thead>
                <tbody>
                  {bills.map(b => (
                    <tr key={b.id} style={{ cursor: 'pointer', opacity: b.is_voided ? 0.6 : 1 }} onClick={() => setViewing(b.id)}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{b.bill_no_text}</td>
                      <td>{b.supplier_name}{b.po_number && <div className="text-muted" style={{ fontSize: 12 }}>{b.po_number}</div>}</td>
                      <td>{b.supplier_ref || <span className="text-muted">—</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.bill_date)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.due_date)}
                        {b.days_overdue > 0 && <div style={{ fontSize: 12, color: '#DC2626' }}>{b.days_overdue} days overdue</div>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{idr(b.total)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{b.is_voided ? '—' : idr(b.balance)}</td>
                      <td><span className={`badge badge-${STATUS[b.status][1]}`}>{STATUS[b.status][0]}</span></td>
                    </tr>
                  ))}
                  {!bills.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No bills here</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'payments' && (
        <>
          <div className="page-toolbar">
            <select className="form-select" style={{ width: 220 }} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">All suppliers</option>
              {setup?.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table style={{ minWidth: 760 }}>
                <thead><tr><th>Paid on</th><th>Supplier</th><th>How</th><th>Bills paid</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={{ opacity: p.is_voided ? 0.6 : 1 }}>
                      <td style={{ whiteSpace: 'nowrap', textDecoration: p.is_voided ? 'line-through' : 'none' }}>{fmtDate(p.paid_on)}</td>
                      <td>{p.supplier_name}</td>
                      <td>{p.method_label}{p.reference && <div className="text-muted" style={{ fontSize: 12 }}>{p.reference}</div>}</td>
                      <td style={{ fontSize: 13 }}>{p.bills.map(b => (
                        <div key={b.bill_id}><a href="#" onClick={e => { e.preventDefault(); setViewing(b.bill_id); }}>{b.bill_no_text}</a>
                          {b.supplier_ref ? ` · ${b.supplier_ref}` : ''} · {idr(b.amount)}</div>))}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', textDecoration: p.is_voided ? 'line-through' : 'none' }}>{idr(p.amount)}
                        {p.is_voided && <div className="text-muted" style={{ fontSize: 12, fontWeight: 400, textDecoration: 'none' }}>Voided{p.voided_by_name ? ` by ${p.voided_by_name}` : ''}: {p.void_reason}</div>}</td>
                      <td style={{ textAlign: 'right' }}>{!p.is_voided && <button className="btn btn-sm btn-secondary" onClick={() => setVoidingPay(p)}>Void</button>}</td>
                    </tr>
                  ))}
                  {!payments.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No payments yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {billForm && setup && (
        <BillFormModal setup={setup} bill={billForm.bill} prefill={billForm.prefill}
          onSupplierAdded={loadSetup}
          onClose={() => setBillForm(null)}
          onSaved={b => { setBillForm(null); reloadAll(); setViewing(b.id); }} />
      )}
      {viewing && (
        <BillDetailModal id={viewing} onClose={() => setViewing(null)}
          onEdit={b => { setViewing(null); setBillForm({ bill: b }); }}
          onPay={b => { setViewing(null); setPaying({ supplier_id: b.supplier_id, bill_id: b.id }); }}
          onChanged={reloadAll} />
      )}
      {paying && setup && (
        <PayModal setup={setup} initial={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); reloadAll(); }} />
      )}
      {supplierEdit && setup && (
        <SupplierModal setup={setup} supplier={supplierEdit} onClose={() => setSupplierEdit(null)}
          onSaved={() => { setSupplierEdit(null); loadSetup(); loadSummary(); }} />
      )}
      {voidingPay && (
        <ReasonModal title={`Void payment of ${idr(voidingPay.amount)}`} danger confirmLabel="Void payment"
          onClose={() => setVoidingPay(null)}
          onConfirm={async reason => { await api.post(`/api/payables/payments/${voidingPay.id}/void`, { reason }); setVoidingPay(null); reloadAll(); }}>
          It stays listed, struck through. The bills it paid are owed again ({voidingPay.bills.map(b => b.bill_no_text).join(', ')}).
        </ReasonModal>
      )}
    </div>
  );
}

function SuppliersTab({ summary, setup, onOpen, onPay, onEdit, onAdd }) {
  if (!summary || !setup) return <div className="text-muted">Loading…</div>;
  const owing = new Map(summary.suppliers.map(s => [s.supplier_id, s]));
  const rows = [...summary.suppliers, ...setup.suppliers.filter(s => !owing.has(s.id) && s.is_active)
    .map(s => ({ supplier_id: s.id, supplier_name: s.name, owed: 0 }))];
  const acct = id => setup.accounts.find(a => a.id === id);
  const cell = (v, red) => v > 0 ? <span style={{ color: red ? '#DC2626' : undefined }}>{idr(v)}</span> : <span className="text-muted">—</span>;
  return (
    <div className="card">
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="text-muted" style={{ fontSize: 13 }}>Overdue columns count from each bill's due date.</div>
        <button className="btn btn-sm btn-secondary" onClick={onAdd}><Icon name="plus" />Add supplier</button>
      </div>
      <div className="table-wrap">
        <table style={{ minWidth: 900 }}>
          <thead><tr><th>Supplier</th><th style={{ textAlign: 'right' }}>Owed</th><th style={{ textAlign: 'right' }}>Not due yet</th>
            <th style={{ textAlign: 'right' }}>1–30 days late</th><th style={{ textAlign: 'right' }}>31–60</th><th style={{ textAlign: 'right' }}>Over 60</th>
            <th>Next due</th><th></th></tr></thead>
          <tbody>
            {rows.map(s => {
              const sup = setup.suppliers.find(x => x.id === s.supplier_id) || {};
              const a = acct(sup.default_account_id);
              return (
                <tr key={s.supplier_id}>
                  <td><a href="#" onClick={e => { e.preventDefault(); onOpen(s.supplier_id); }} style={{ fontWeight: 600 }}>{s.supplier_name}</a>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {sup.payment_terms_days != null ? `Pays in ${sup.payment_terms_days} days` : 'No payment terms'}{a ? ` · ${a.code} ${a.name}` : ''}</div></td>
                  <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{cell(s.owed)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cell(s.not_due)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cell(s.d1_30, true)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cell(s.d31_60, true)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cell(s.d60, true)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.next_due ? fmtDate(s.next_due) : <span className="text-muted">—</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {s.owed > 0 && <button className="btn btn-sm btn-primary" onClick={() => onPay(s.supplier_id)} style={{ marginRight: 6 }}>Pay</button>}
                    <button className="btn btn-sm btn-secondary" onClick={() => onEdit(sup)}>Edit</button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No suppliers yet — add one, or start with New bill</td></tr>}
          </tbody>
          {summary.suppliers.length > 1 && (
            <tfoot><tr style={{ fontWeight: 700 }}>
              <td>Total</td><td style={{ textAlign: 'right' }}>{idr(summary.totals.owed)}</td><td style={{ textAlign: 'right' }}>{idr(summary.totals.not_due)}</td>
              <td style={{ textAlign: 'right' }}>{idr(summary.totals.d1_30)}</td><td style={{ textAlign: 'right' }}>{idr(summary.totals.d31_60)}</td>
              <td style={{ textAlign: 'right' }}>{idr(summary.totals.d60)}</td><td colSpan={2}></td></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function SupplierModal({ setup, supplier, onClose, onSaved }) {
  const isNew = !supplier.id;
  const [f, setF] = useState({ name: supplier.name || '', payment_terms_days: supplier.payment_terms_days ?? '', default_account_id: supplier.default_account_id || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    try {
      if (isNew) await api.post('/api/payables/suppliers', f);
      else await api.put(`/api/payables/suppliers/${supplier.id}`, f);
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">{isNew ? 'Add supplier' : supplier.name}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {err && <div className="alert alert-error mb-3"><div>{err}</div></div>}
          {isNew && <div className="form-group"><label className="form-label">Name *</label>
            <input className="form-input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>}
          <div className="form-group"><label className="form-label">Pays bills after (days)</label>
            <input className="form-input" type="number" min="0" value={f.payment_terms_days} placeholder="e.g. 14 — empty = due the day it arrives"
              onChange={e => setF({ ...f, payment_terms_days: e.target.value })} />
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>A new bill's due date = bill date + these days.</div></div>
          <div className="form-group"><label className="form-label">Usual account</label>
            <AccountSelect accounts={setup.accounts} value={f.default_account_id} onChange={v => setF({ ...f, default_account_id: v })} />
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>New bill lines from this supplier start on it (e.g. 5220 F&amp;B — cost of food).</div></div>
          {!isNew && <div className="text-muted" style={{ fontSize: 12 }}>Name, contact and address: Operations → Purchasing &amp; Stock → Suppliers.</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || (isNew && !f.name.trim())}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function BillFormModal({ setup, bill, prefill, onClose, onSaved, onSupplierAdded }) {
  const p = prefill || {};
  const [suppliers, setSuppliers] = useState(setup.suppliers);
  const [f, setF] = useState(() => bill ? {
    supplier_id: bill.supplier_id, supplier_ref: bill.supplier_ref || '', bill_date: bill.bill_date, due_date: bill.due_date,
    notes: bill.notes || '', purchase_order_id: bill.purchase_order_id || null,
    lines: bill.lines.map(l => ({ account_id: l.account_id, description: l.description || '', amount: String(l.amount), po_item_id: l.po_item_id })),
  } : {
    supplier_id: p.supplier_id || '', supplier_ref: '', bill_date: setup.today, due_date: '', notes: '',
    purchase_order_id: p.purchase_order_id || null,
    lines: p.lines || [{ account_id: '', description: '', amount: '' }],
  });
  const [dueTouched, setDueTouched] = useState(!!bill);
  const [newSupplier, setNewSupplier] = useState(null);
  const [err, setErr] = useState('');
  const [dupWarn, setDupWarn] = useState('');
  const [busy, setBusy] = useState(false);
  const sup = suppliers.find(s => s.id === f.supplier_id);

  // Due date follows the supplier's terms until it is typed by hand.
  useEffect(() => {
    if (dueTouched || !f.bill_date) return;
    setF(x => ({ ...x, due_date: addDays(x.bill_date, sup?.payment_terms_days || 0) }));
  }, [f.supplier_id, f.bill_date, dueTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickSupplier(id) {
    const s = suppliers.find(x => x.id === id);
    setF(x => ({ ...x, supplier_id: id,
      lines: x.lines.map(l => l.account_id || !s?.default_account_id ? l : { ...l, account_id: s.default_account_id }) }));
  }
  async function addSupplier() {
    try {
      const { data } = await api.post('/api/payables/suppliers', { name: newSupplier });
      setSuppliers(list => [...list, data.supplier].sort((a, b) => a.name.localeCompare(b.name)));
      setF(x => ({ ...x, supplier_id: data.supplier.id }));
      setNewSupplier(null); onSupplierAdded();
    } catch (e) { setErr(errText(e)); }
  }
  const setLine = (i, k, v) => setF(x => ({ ...x, lines: x.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) }));
  const total = f.lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

  async function save(confirmDuplicate = false) {
    setBusy(true); setErr('');
    const body = { ...f, confirm_duplicate: confirmDuplicate,
      lines: f.lines.filter(l => l.amount !== '' || l.account_id).map(l => ({ ...l, amount: parseFloat(l.amount) })) };
    try {
      const { data } = bill ? await api.put(`/api/payables/bills/${bill.id}`, body) : await api.post('/api/payables/bills', body);
      onSaved(data.bill);
    } catch (e) {
      if (e.response?.data?.code === 'DUPLICATE_REF') setDupWarn(e.response.data.error);
      else setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 760, width: '100%' }}>
        <div className="modal-header">
          <div><div className="modal-title">{bill ? `Edit ${bill.bill_no_text}` : 'New supplier bill'}</div>
            {p.po_number && <div className="text-muted" style={{ fontSize: 12 }}>From {p.po_number} — what was received and isn't on a bill yet</div>}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="alert alert-error mb-3"><div>{err}</div></div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Supplier *</label>
              {newSupplier == null ? (
                <select className="form-select" value={f.supplier_id} disabled={!!f.purchase_order_id}
                  onChange={e => e.target.value === '__new' ? setNewSupplier('') : pickSupplier(e.target.value)}>
                  <option value="">Choose…</option>
                  {suppliers.filter(s => s.is_active || s.id === f.supplier_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__new">+ New supplier…</option>
                </select>
              ) : (
                <div className="flex gap-2">
                  <input className="form-input" autoFocus placeholder="Supplier name" value={newSupplier} onChange={e => setNewSupplier(e.target.value)} />
                  <button className="btn btn-sm btn-primary" onClick={addSupplier} disabled={!newSupplier.trim()}>Add</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setNewSupplier(null)}>✕</button>
                </div>
              )}
            </div>
            <div className="form-group"><label className="form-label">Their invoice number</label>
              <input className="form-input" value={f.supplier_ref} placeholder="as printed on the bill" onChange={e => setF({ ...f, supplier_ref: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Bill date *</label>
              <input className="form-input" type="date" value={f.bill_date} onChange={e => setF({ ...f, bill_date: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Due date</label>
              <input className="form-input" type="date" value={f.due_date} onChange={e => { setDueTouched(true); setF({ ...f, due_date: e.target.value }); }} />
              {sup && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                {sup.payment_terms_days != null ? `${sup.name} is paid ${sup.payment_terms_days} days after the bill` : 'No payment terms set for this supplier'}</div>}</div>
          </div>

          <label className="form-label">What the bill is for</label>
          <div className="table-wrap">
            <table style={{ minWidth: 600 }}>
              <thead><tr><th style={{ width: '38%' }}>Account</th><th>Description</th><th style={{ width: 150, textAlign: 'right' }}>Amount (IDR)</th><th></th></tr></thead>
              <tbody>
                {f.lines.map((l, i) => (
                  <tr key={i}>
                    <td><AccountSelect accounts={setup.accounts} value={l.account_id} onChange={v => setLine(i, 'account_id', v)} /></td>
                    <td><input className="form-input" value={l.description} onChange={e => setLine(i, 'description', e.target.value)} /></td>
                    <td><input className="form-input" type="number" style={{ textAlign: 'right' }} value={l.amount} onChange={e => setLine(i, 'amount', e.target.value)} /></td>
                    <td>{f.lines.length > 1 && <button className="btn btn-icon" onClick={() => setF(x => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 12px' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setF(x => ({ ...x, lines: [...x.lines, { account_id: sup?.default_account_id || '', description: '', amount: '' }] }))}>
              <Icon name="plus" />Add line</button>
            <div style={{ fontWeight: 700 }}>Total {idr(total)}</div>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Enter the bill as printed, tax included. A discount on the bill = a line with a minus amount.</div>
          <div className="form-group"><label className="form-label">Notes</label>
            <textarea className="form-textarea" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="optional" /></div>
          {dupWarn && (
            <div className="alert alert-warn"><div>{dupWarn}. Record it again anyway?
              <div className="flex gap-2" style={{ marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => { setDupWarn(''); save(true); }}>Yes, it's a different bill</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setDupWarn('')}>No</button></div></div></div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => save(false)} disabled={busy || !f.supplier_id || !(total > 0)}>
            {busy ? 'Saving…' : bill ? 'Save changes' : `Save bill · ${idr(total)}`}</button>
        </div>
      </div>
    </div>
  );
}

function BillDetailModal({ id, onClose, onEdit, onPay, onChanged }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState('');
  const [voiding, setVoiding] = useState(false);
  const load = () => api.get(`/api/payables/bills/${id}`).then(r => setB(r.data)).catch(e => setErr(errText(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const livePaid = b ? b.payments.filter(p => !p.is_voided).length > 0 : false;
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 680, width: '100%' }}>
        <div className="modal-header">
          <div><div className="modal-title">{b ? `${b.bill_no_text} · ${b.supplier_name}` : 'Bill'}</div>
            {b && <div className="text-muted" style={{ fontSize: 12 }}>{b.supplier_ref ? `Their invoice ${b.supplier_ref} · ` : ''}recorded by {b.created_by_name || '—'}</div>}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="alert alert-error mb-3"><div>{err}</div></div>}
          {b && (
            <>
              {b.is_voided && <div className="alert alert-warn mb-3"><div>Voided{b.voided_by_name ? ` by ${b.voided_by_name}` : ''}: {b.void_reason}</div></div>}
              <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 12, fontSize: 14 }}>
                <span className={`badge badge-${STATUS[b.status][1]}`}>{STATUS[b.status][0]}</span>
                <span>Bill date <b>{fmtDate(b.bill_date)}</b></span>
                <span>· Due <b>{fmtDate(b.due_date)}</b>{b.days_overdue > 0 && <span style={{ color: '#DC2626' }}> ({b.days_overdue} days overdue)</span>}</span>
                {b.po_number && <span>· {b.po_number}</span>}
              </div>
              <table style={{ width: '100%', fontSize: 13, marginBottom: 8 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Account</th><th style={{ textAlign: 'left' }}>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>{b.lines.map(l => (
                  <tr key={l.id}><td>{l.account_code} · {l.account_name}</td><td>{l.description || '—'}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{idr(l.amount)}</td></tr>))}</tbody>
              </table>
              <div style={{ textAlign: 'right', fontSize: 14 }}>
                <div>Total <b>{idr(b.total)}</b></div>
                {!b.is_voided && <><div>Paid {idr(b.paid)}</div><div style={{ fontWeight: 700, fontSize: 16 }}>Still owed {idr(b.balance)}</div></>}
              </div>
              {b.notes && <div className="alert alert-info" style={{ marginTop: 10 }}>{b.notes}</div>}
              {b.payments.length > 0 && (
                <>
                  <div className="form-label" style={{ marginTop: 14 }}>Payments</div>
                  {b.payments.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--rule, #eee)', opacity: p.is_voided ? 0.6 : 1 }}>
                      <span style={{ textDecoration: p.is_voided ? 'line-through' : 'none' }}>{fmtDate(p.paid_on)} · {p.method_label}{p.reference ? ` · ${p.reference}` : ''}
                        {p.payment_amount !== p.amount ? ` (part of ${idr(p.payment_amount)})` : ''}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{idr(p.amount)}{p.is_voided ? ' · voided' : ''}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
          {b && !b.is_voided && !livePaid && <button className="btn btn-sm btn-secondary" onClick={() => setVoiding(true)}>Void</button>}
          {b && !b.is_voided && !livePaid && <button className="btn btn-sm btn-secondary" onClick={() => onEdit(b)}>Edit</button>}
          {b && b.balance > 0 && <button className="btn btn-sm btn-primary" onClick={() => onPay(b)}>Pay this bill</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {voiding && b && (
        <ReasonModal title={`Void ${b.bill_no_text}`} danger confirmLabel="Void bill" onClose={() => setVoiding(false)}
          onConfirm={async reason => { await api.post(`/api/payables/bills/${b.id}/void`, { reason }); setVoiding(false); load(); onChanged(); }}>
          The bill stays listed as voided and is no longer owed or counted as a cost. Record the right one as a new bill.
        </ReasonModal>
      )}
    </div>
  );
}

function PayModal({ setup, initial, onClose, onSaved }) {
  const [supplierId, setSupplierId] = useState(initial.supplier_id || '');
  const [open, setOpen] = useState([]);
  const [pay, setPay] = useState({});          // bill id → amount string
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(() => (setup.payment_methods.find(m => /bank|transfer/i.test(`${m.id} ${m.label}`)) || setup.payment_methods[0] || {}).id || '');
  const [paidOn, setPaidOn] = useState(setup.today);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supplierId) { setOpen([]); setPay({}); return; }
    api.get('/api/payables/bills', { params: { supplier_id: supplierId, status: 'open' } }).then(r => {
      setOpen(r.data);
      const start = {};
      for (const b of r.data) if (!initial.bill_id || b.id === initial.bill_id) start[b.id] = String(b.balance);
      setPay(start);
      setAmount('');
    }).catch(e => setErr(errText(e)));
  }, [supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Typing the amount paid spreads it over the bills, the oldest due first.
  function spread(v) {
    setAmount(v);
    let left = parseFloat(v) || 0;
    const next = {};
    for (const b of open) { const a = Math.min(left, b.balance); if (a > 0) next[b.id] = String(Math.round(a * 100) / 100); left -= a; }
    setPay(next);
  }
  const total = useMemo(() => Object.values(pay).reduce((s, v) => s + (parseFloat(v) || 0), 0), [pay]);
  const over = (parseFloat(amount) || 0) > open.reduce((s, b) => s + b.balance, 0) + 0.004;

  async function save() {
    setBusy(true); setErr('');
    try {
      await api.post('/api/payables/payments', { supplier_id: supplierId, method, paid_on: paidOn, reference, notes,
        allocations: Object.entries(pay).map(([bill_id, v]) => ({ bill_id, amount: parseFloat(v) || 0 })).filter(a => a.amount > 0) });
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 680, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">Pay a supplier</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {err && <div className="alert alert-error mb-3"><div>{err}</div></div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Supplier *</label>
              <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">Choose…</option>
                {setup.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Amount paid</label>
              <input className="form-input" type="number" value={amount} placeholder="spreads over the bills, oldest first" onChange={e => spread(e.target.value)} />
              {over && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 4 }}>More than this supplier is owed — the rest isn't recorded.</div>}</div>
          </div>
          {supplierId && (
            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table style={{ minWidth: 520 }}>
                <thead><tr><th>Bill</th><th>Due</th><th style={{ textAlign: 'right' }}>Still owed</th><th style={{ width: 160, textAlign: 'right' }}>Paying now</th></tr></thead>
                <tbody>
                  {open.map(b => (
                    <tr key={b.id}>
                      <td>{b.bill_no_text}{b.supplier_ref ? ` · ${b.supplier_ref}` : ''}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.due_date)}{b.days_overdue > 0 && <span style={{ color: '#DC2626' }}> · {b.days_overdue}d late</span>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{idr(b.balance)}</td>
                      <td><input className="form-input" type="number" style={{ textAlign: 'right' }} value={pay[b.id] || ''}
                        onChange={e => setPay(x => ({ ...x, [b.id]: e.target.value }))} /></td>
                    </tr>
                  ))}
                  {!open.length && <tr><td colSpan={4} className="text-muted" style={{ textAlign: 'center', padding: 16 }}>Nothing owed to this supplier</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Paid with *</label>
              <select className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
                {setup.payment_methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Date paid *</label>
              <input className="form-input" type="date" value={paidOn} max={setup.today} onChange={e => setPaidOn(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Reference</label>
              <input className="form-input" value={reference} placeholder="transfer number" onChange={e => setReference(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Notes</label>
              <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !supplierId || !method || !(total > 0)}>
            {busy ? 'Saving…' : `Record payment · ${idr(total)}`}</button>
        </div>
      </div>
    </div>
  );
}
