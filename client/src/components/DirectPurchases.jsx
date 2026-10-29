import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { DEPARTMENT_LABEL, categoryDepartment } from '../lib/costLists';
import ReasonModal from './ReasonModal';
import ItemPicker from './ItemPicker';
import { BIG_UNIT, isBig, fmtQty, flipBig, toBase, UnitSwitch, perUnit } from '../lib/units';

// Buy without a PO (migration 135) — Purchasing. Stock bought at the
// market or a shop: one save adds the stock (average cost updated) and
// records the money — paid already → Finance → Expenses, pay later → a
// supplier bill in Finance → Payables. Voided here, never in Expenses /
// Payables, so the stock always follows. Restaurant goods (POS items) go to
// the POS stock instead of the PMS's.

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const fmtDay = d => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = s => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const qtyText = q => String(+Number(q).toFixed(3));
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const STATUS = {
  paid: ['Paid', 'green'], owed: ['To pay', 'amber'], voided: ['Voided', 'red'],
};
const EMPTY_LINE = { kind: 'material', raw_material_id: '', product_id: '', pos_item_id: '', quantity: '', amount: '' };

export function DirectPurchasesTab() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [buying, setBuying] = useState(false);
  const [open, setOpen] = useState(null);
  const [toast, setToast] = useState(null);

  function showToast(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast(null), 6000); }
  function load() {
    api.get('/api/purchasing/direct', { params: { q: search || undefined, voided: showVoided ? 1 : undefined } })
      .then(r => setRows(r.data)).catch(() => setRows([]));
  }
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search, showVoided]); // eslint-disable-line react-hooks/exhaustive-deps

  function openOne(id) {
    api.get(`/api/purchasing/direct/${id}`).then(r => setOpen(r.data)).catch(() => showToast('Could not open the purchase', 'error'));
  }
  const total = rows.filter(r => !r.voided_at).reduce((t, r) => t + r.total_amount, 0);

  return (
    <div>
      <div className="page-toolbar">
        <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="form-input" style={{ maxWidth: 260 }} placeholder="Search item, supplier, receipt…" value={search} onChange={e => setSearch(e.target.value)} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} /> Show voided
          </label>
        </div>
        <div className="page-toolbar-end">
          <button className="btn btn-primary" onClick={() => setBuying(true)}>+ Buy without a PO</button>
        </div>
      </div>
      <p className="text-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        Stock bought at the market or a shop with no purchase order. Saving adds the stock and records the money:
        paid already → Finance → Expenses, pay later → a supplier bill in Finance → Payables. Don't type it again there.{' '}
        <Link to="/guide/purchasing">📘 Guide</Link>
      </p>

      {toast && <div className={`alert ${toast.type === 'error' ? 'alert-error' : 'alert-success'}`}><div>{toast.msg}</div></div>}

      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 820 }}>
            <thead><tr>
              <th>Date</th><th>Bought from</th><th>Items</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th><th>Money</th><th>No.</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onClick={() => openOne(r.id)} style={{ cursor: 'pointer', opacity: r.voided_at ? 0.6 : 1 }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(r.purchased_on)}</td>
                  <td>{r.supplier_name || <span className="text-muted">—</span>}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.items_text}</td>
                  <td>{r.category_label}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, textDecoration: r.voided_at ? 'line-through' : 'none' }}>{fmtIDR(r.total_amount)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`badge badge-${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>{' '}
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {r.voided_at ? '' : r.pay === 'later' ? `${r.bill_no_text}${r.bill_left > 0 ? ` · due ${fmtDay(r.bill_due)}` : ''}` : r.paid_with}
                    </span>
                  </td>
                  <td className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.po_number}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Nothing bought without a PO yet</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr>
                <td colSpan={4} style={{ fontWeight: 600 }}>Total{showVoided ? ' (voided left out)' : ''}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtIDR(total)}</td><td colSpan={2}></td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>

      {buying && (
        <BuyWithoutPoModal
          onClose={() => setBuying(false)}
          onSaved={r => {
            setBuying(false); load();
            const pos = r.pos_sync ? (r.pos_sync.failed ? ' Restaurant items NOT sent to the POS yet — open it and press Send to the POS.' : ' Restaurant items added to the POS stock.') : '';
            showToast(`Saved ${r.purchase.po_number} — stock updated, ${r.money.kind === 'bill' ? `bill ${r.money.bill_no_text} in Payables` : 'expense recorded in Expenses'}.${pos}`);
          }}
        />
      )}
      {open && (
        <DirectPurchaseDetail p={open} onClose={() => setOpen(null)}
          onVoided={(p, sent) => { setOpen(p); load(); showToast(sent ? `${p.po_number} — sent to the POS` : `${p.po_number} voided — stock taken back out`); }} />
      )}
    </div>
  );
}

export function BuyWithoutPoModal({ onClose, onSaved }) {
  const [setup, setSetup] = useState(null);
  const [supplierId, setSupplierId] = useState('');
  const [boughtFrom, setBoughtFrom] = useState('');
  const [day, setDay] = useState('');
  const [reference, setReference] = useState('');
  const [category, setCategory] = useState('food');
  const [department, setDepartment] = useState('');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [pay, setPay] = useState('paid');
  const [method, setMethod] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/purchasing/direct/setup').then(r => {
      setSetup(r.data); setDay(r.data.today);
      const cash = r.data.payment_methods.find(m => /cash|tunai/i.test(m.id + m.label)) || r.data.payment_methods[0];
      if (cash) setMethod(cash.id);
    }).catch(err => setError(err.response?.data?.error || 'Could not load the form'));
  }, []);

  const supplier = setup?.suppliers.find(s => s.id === supplierId);
  function pickSupplier(id) {
    setSupplierId(id);
    const s = setup.suppliers.find(x => x.id === id);
    if (s?.default_category) setCategory(s.default_category);
    if (s?.default_department) setDepartment(s.default_department);
  }
  const updateLine = (i, patch) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const posItems = setup?.pos?.items || [];
  const itemOf = l => l.kind === 'product' ? setup?.products.find(p => p.id === l.product_id)
    : l.kind === 'pos' ? posItems.find(x => x.id === l.pos_item_id)
    : setup?.materials.find(m => m.id === l.raw_material_id);
  const unitOf = l => (l.kind === 'material' ? itemOf(l)?.unit_of_measure : l.kind === 'pos' ? itemOf(l)?.unit : null);
  const idOf = l => (l.kind === 'product' ? l.product_id : l.kind === 'pos' ? l.pos_item_id : l.raw_material_id);
  const total = lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const showKind = !!setup && (setup.products.length > 0 || posItems.length > 0);
  const usualDue = supplier ? addDays(day || setup?.today || '2000-01-01', supplier.payment_terms_days || 0) : '';
  const closed = setup?.closed_through && day && day <= setup.closed_through;

  async function save(confirmDuplicate = false) {
    setError('');
    const items = [];
    for (const l of lines) {
      if (!idOf(l)) { setError('Choose the item on every line'); return; }
      const quantity = +toBase(l, unitOf(l), 'quantity', null).quantity.toFixed(3);
      if (!(quantity > 0)) { setError('Every line needs how many'); return; }
      if (!(Number(l.amount) > 0)) { setError('Every line needs the price paid'); return; }
      const key = l.kind === 'product' ? 'product_id' : l.kind === 'pos' ? 'pos_item_id' : 'raw_material_id';
      items.push({ [key]: idOf(l), quantity, amount: Number(l.amount) });
    }
    setSaving(true);
    try {
      const r = await api.post('/api/purchasing/direct', {
        supplier_id: supplierId || null, bought_from: supplierId ? null : boughtFrom, purchased_on: day, reference, category,
        department: department || null, notes, items, pay, method: pay === 'paid' ? method : null,
        due_date: pay === 'later' ? (dueDate || null) : null, confirm_duplicate: confirmDuplicate,
      });
      onSaved(r.data);
    } catch (err) {
      const d = err.response?.data;
      if (d?.code === 'DUPLICATE_REF' && window.confirm(d.error)) { setSaving(false); return save(true); }
      setError(d?.error || 'Could not save');
    }
    setSaving(false);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 940, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Buy without a PO</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
          {!setup ? <div className="text-muted">Loading…</div> : (<>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Bought from</label>
                <select className="form-select" value={supplierId} onChange={e => pickSupplier(e.target.value)}>
                  <option value="">— Not a regular supplier (market, shop…) —</option>
                  {setup.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {!supplierId && <input className="form-input" style={{ marginTop: 6 }} placeholder="Where — e.g. Pasar Kintamani (optional)" value={boughtFrom} onChange={e => setBoughtFrom(e.target.value)} />}
              </div>
              <div className="form-group">
                <label className="form-label">Date bought</label>
                <input className="form-input" type="date" max={setup.today} value={day} onChange={e => setDay(e.target.value)} />
                {closed && <div style={{ fontSize: 12, color: 'var(--warning, #b45309)', marginTop: 4 }}>This day is already closed in Accounting — it will show as a correction in the next close.</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Receipt / nota number</label>
                <input className="form-input" value={reference} onChange={e => setReference(e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">What it is for (cost category)</label>
                <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
                  {setup.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Department</label>
                <select className="form-select" value={department} onChange={e => setDepartment(e.target.value)}>
                  <option value="">Usual — {DEPARTMENT_LABEL[supplier?.default_department || categoryDepartment(category)]}</option>
                  {setup.departments.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
            </div>

            <div className="form-label" style={{ marginTop: 4 }}>What was bought — type the price paid for each line, as on the receipt</div>
            <div className="table-wrap">
              <table style={{ minWidth: 760 }}>
                <thead><tr>
                  {showKind && <th style={{ width: 150 }}>Kind</th>}
                  <th>Item</th><th style={{ width: 170, textAlign: 'right' }}>How many</th>
                  <th style={{ width: 160, textAlign: 'right' }}>Price paid (IDR)</th><th style={{ width: 170, textAlign: 'right' }}>Per unit</th><th style={{ width: 40 }}></th>
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const it = itemOf(l);
                    const unit = unitOf(l);
                    const per = Number(l.quantity) > 0 && Number(l.amount) > 0 ? Number(l.amount) / Number(l.quantity) : null;
                    const f = isBig(l) && BIG_UNIT[unit] ? BIG_UNIT[unit][1] : 1;
                    const usual = it?.cost_per_unit != null ? Number(it.cost_per_unit) * f : null;
                    const pct = per && usual > 0 ? Math.round((per / usual - 1) * 100) : null;
                    return (
                      <tr key={i}>
                        {showKind && (
                          <td>
                            <select className="form-select" value={l.kind} onChange={e => updateLine(i, { kind: e.target.value, product_id: '', raw_material_id: '', pos_item_id: '' })}>
                              <option value="material">Stock item</option>
                              {setup.products.length > 0 && <option value="product">For resale</option>}
                              {posItems.length > 0 && <option value="pos">Restaurant (POS)</option>}
                            </select>
                          </td>
                        )}
                        <td>
                          {l.kind === 'pos' ? (
                            <ItemPicker value={l.pos_item_id} onChange={v => updateLine(i, { pos_item_id: v })} placeholder="Type to find the restaurant item…"
                              options={posItems.map(x => ({ value: x.id, label: x.name, hint: x.unit }))} />
                          ) : l.kind === 'product' ? (
                            <ItemPicker value={l.product_id} onChange={v => updateLine(i, { product_id: v })} placeholder="Type to find the item…"
                              options={setup.products.map(p => ({ value: p.id, label: p.name }))} />
                          ) : (
                            <ItemPicker value={l.raw_material_id} onChange={v => updateLine(i, { raw_material_id: v })}
                              placeholder={setup.materials.length ? 'Type to find the stock item…' : 'No stock items yet — add them on Stock → Stock items'}
                              options={setup.materials.map(m => ({ value: m.id, label: m.name, hint: m.unit_of_measure }))} />
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input className="form-input" style={{ textAlign: 'right' }} type="number" min="0" step={l.kind === 'product' ? '1' : 'any'} value={l.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} />
                            <UnitSwitch unit={unit} line={l} onFlip={() => updateLine(i, flipBig(l, unit, 'quantity', null))} />
                          </div>
                        </td>
                        <td><input className="form-input" style={{ textAlign: 'right' }} type="number" min="0" value={l.amount} onChange={e => updateLine(i, { amount: e.target.value })} /></td>
                        <td style={{ textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {per ? <div>{fmtIDR(per)} {unit ? perUnit(unit, l) : ''}</div> : <span className="text-muted">—</span>}
                          {usual > 0 && <div style={{ color: pct >= 20 ? 'var(--danger, #b91c1c)' : 'var(--text-muted)' }}>usual {fmtIDR(usual)}{pct != null && pct !== 0 ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}</div>}
                        </td>
                        <td>{lines.length > 1 && <button className="btn btn-icon" title="Remove line" onClick={() => setLines(ls => ls.filter((_, x) => x !== i))}>✕</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex-between" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setLines(ls => [...ls, { ...EMPTY_LINE }])}>+ Add line</button>
              <div style={{ fontWeight: 700 }}>Total {fmtIDR(total)}</div>
            </div>

            <div className="form-label" style={{ marginTop: 16 }}>The money</div>
            <div className="seg" style={{ marginBottom: 10 }}>
              <button type="button" className={pay === 'paid' ? 'active' : ''} onClick={() => setPay('paid')}>Paid already</button>
              <button type="button" className={pay === 'later' ? 'active' : ''} onClick={() => setPay('later')}>Pay later</button>
            </div>
            {pay === 'paid' ? (
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Paid with</label>
                  <select className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
                    {setup.payment_methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div className="form-group text-muted" style={{ fontSize: 13, alignSelf: 'end' }}>Recorded in Finance → Expenses by itself.</div>
              </div>
            ) : supplierId ? (
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Due date</label>
                  <input className="form-input" type="date" min={day} value={dueDate} onChange={e => setDueDate(e.target.value)} />
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Empty = {fmtDay(usualDue)} ({supplier.payment_terms_days || 0} days, the supplier's terms)</div>
                </div>
                <div className="form-group text-muted" style={{ fontSize: 13, alignSelf: 'end' }}>A supplier bill is made in Finance → Payables — pay it there.</div>
              </div>
            ) : (
              <div className="alert alert-warn"><div>Pay later needs the supplier — choose them under <b>Bought from</b> (add a new one in Finance → Payables → Suppliers).</div></div>
            )}
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
            </div>
          </>)}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!setup || saving || (pay === 'later' && !supplierId)} onClick={() => save(false)}>
            {saving ? 'Saving…' : `Save — ${fmtIDR(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DirectPurchaseDetail({ p, onClose, onVoided }) {
  const { can } = useAuth();
  const [voiding, setVoiding] = useState(false);
  const [sending, setSending] = useState(false);
  const [s1, s2] = STATUS[p.status];
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 640, width: '100%' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{p.po_number} · bought without a PO</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{p.supplier_name || 'No supplier'} · {fmtDay(p.purchased_on)}</div>
          </div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {p.voided_at && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              <div>Voided {fmtDateTime(p.voided_at)}{p.voided_by_name ? ` by ${p.voided_by_name}` : ''} — {p.void_reason}. The stock was taken back out and its {p.pay === 'later' ? 'bill' : 'expense'} voided.</div>
            </div>
          )}
          <div className="flex gap-2" style={{ marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge badge-${s2}`}>{s1}</span>
            <span className="text-muted" style={{ fontSize: 13 }}>{p.category_label}{p.reference ? ` · receipt ${p.reference}` : ''}</span>
          </div>
          <div className="table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>How many</th><th style={{ textAlign: 'right' }}>Per unit</th><th style={{ textAlign: 'right' }}>Price paid</th></tr></thead>
              <tbody>
                {p.items.map(it => (
                  <tr key={it.id}>
                    <td>{it.description}
                      {it.pos_item_id && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Restaurant</span>}
                      {it.pos_item_id && (it.pos_send_error
                        ? <div style={{ fontSize: 11, color: 'var(--danger, #b91c1c)' }}>Not sent to the POS: {it.pos_send_error}</div>
                        : Number(it.pos_sent_qty) >= Number(it.quantity) ? <div style={{ fontSize: 11, color: '#16A34A' }}>In the restaurant's stock</div> : null)}</td>
                    <td style={{ textAlign: 'right' }}>{it.product_id ? qtyText(it.quantity) : fmtQty(it.quantity, it.unit_of_measure)}</td>
                    <td style={{ textAlign: 'right' }}>{BIG_UNIT[it.unit_of_measure] ? `${fmtIDR(it.line_total / it.quantity * BIG_UNIT[it.unit_of_measure][1])} / ${BIG_UNIT[it.unit_of_measure][0]}` : fmtIDR(it.line_total / it.quantity)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtIDR(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontWeight: 700, textAlign: 'right', margin: '8px 0 14px' }}>Total {fmtIDR(p.total_amount)}</div>

          <div className="form-label">The money</div>
          <div style={{ fontSize: 14, marginBottom: 12 }}>
            {p.pay === 'later' ? (
              <>Bill <b>{p.bill_no_text}</b> in Finance → Payables — due {fmtDay(p.bill_due)}
                {p.bill_paid > 0 ? `, ${fmtIDR(p.bill_paid)} paid` : ''}{p.bill_left > 0 && !p.voided_at ? `, ${fmtIDR(p.bill_left)} still to pay` : ''}.
                {can('payables') && <> <Link to="/payables">Open Payables →</Link></>}</>
            ) : (
              <>Paid with <b>{p.paid_with}</b> — recorded in Finance → Expenses.</>
            )}
          </div>
          {p.notes && <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{p.notes}</div>}

          <div className="form-label">History</div>
          <div style={{ fontSize: 12 }}>
            {(p.events || []).map(e => (
              <div key={e.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</div>
                <div style={{ flex: 1 }}>{e.note}{e.created_by_name ? <span className="text-muted"> — {e.created_by_name}</span> : ''}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          {!p.voided_at && p.items.some(it => it.pos_item_id && Number(it.pos_sent_qty) < Number(it.quantity)) && (
            <button className="btn btn-secondary" disabled={sending} onClick={async () => {
              setSending(true);
              try {
                const r = await api.post(`/api/purchasing/direct/${p.id}/pos-send`);
                if (r.data.failed) window.alert(`Not sent: ${r.data.error}`);
                onVoided((await api.get(`/api/purchasing/direct/${p.id}`)).data, true);
              } catch (err) { window.alert(err.response?.data?.error || 'Could not send'); }
              setSending(false);
            }}>{sending ? 'Sending…' : 'Send to the POS'}</button>
          )}
          {!p.voided_at && !p.items.some(it => it.pos_item_id && Number(it.pos_sent_qty) > 0) && <button className="btn btn-danger" onClick={() => setVoiding(true)}>Void…</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {voiding && (
        <ReasonModal title={`Void ${p.po_number}?`} danger confirmLabel="Void purchase" onClose={() => setVoiding(false)}
          onConfirm={async reason => {
            const r = await api.post(`/api/purchasing/direct/${p.id}/void`, { reason });
            setVoiding(false); onVoided(r.data.purchase);
          }}>
          The stock is taken back out ({p.items.map(i => `${i.description} ${qtyText(i.quantity)}${i.unit_of_measure ? ' ' + i.unit_of_measure : ''}`).join(', ')})
          and its {p.pay === 'later' ? `bill ${p.bill_no_text}` : 'expense'} is voided. Refused if the stock has been used, or if something is already paid on the bill.
        </ReasonModal>
      )}
    </div>
  );
}
