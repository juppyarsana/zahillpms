import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PurchaseRequests from './PurchaseRequests';
import api from '../services/api';
import { DEPARTMENTS, DEPARTMENT_LABEL, categoryDepartment } from '../lib/costLists';
import { useAuth } from '../context/AuthContext';
import ReasonModal from '../components/ReasonModal';
import ItemPicker from '../components/ItemPicker';
import { DirectPurchasesTab, DirectPurchaseDetail } from '../components/DirectPurchases';
import { BIG_UNIT, fmtQty, flipBig, toBase, fromBase, UnitSwitch, perUnit } from '../lib/units';

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const EMPTY_SUPPLIER = { name: '', contact_name: '', contact_phone: '', contact_email: '', address: '', payment_terms_days: '' };

const PO_STATUS_LABELS = { draft: 'Draft', pending_approval: 'Pending Approval', approved: 'Approved', received: 'Received', cancelled: 'Cancelled' };
const PO_STATUS_BADGE = { draft: 'gray', pending_approval: 'amber', approved: 'blue', received: 'green', cancelled: 'red' };
// Hex equivalents of the badge colors above, for the row's left-edge accent stripe.
const PO_STATUS_COLOR = { draft: '#9CA3AF', pending_approval: '#D97706', approved: '#2563EB', received: '#16A34A', cancelled: '#DC2626' };

// Shared CSV/PDF-style download helper — same blob-then-click pattern
// Agents.jsx already uses for invoice PDFs, just swapped to text/csv.
async function downloadCsv(url, filename) {
  const r = await api.get(url, { responseType: 'blob' });
  const blobUrl = window.URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = blobUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(blobUrl);
}

// Same list as server/services/costCategories.js (shared with Payables).
const EXPENSE_CATEGORY_LABELS = {
  food: 'Food', drinks: 'Drinks', guest_supplies: 'Guest supplies & amenities',
  laundry: 'Laundry', utilities: 'Utilities', maintenance: 'Maintenance & repairs', supplies: 'Supplies',
  marketing: 'Marketing', staff: 'Staff', admin_fees: 'Admin & Bank Fees', ota_commission: 'OTA Commission', other: 'Other',
};
const EXPENSE_CATEGORY_COLORS = {
  food: 'green', drinks: 'blue', guest_supplies: 'purple',
  utilities: 'blue', laundry: 'purple', maintenance: 'orange', staff: 'pink',
  supplies: 'amber', marketing: 'green', admin_fees: 'gray', ota_commission: 'blue', other: 'gray',
};
const EMPTY_EXPENSE = { category: 'utilities', department: 'engineering', amount: '', incurred_on: new Date().toISOString().slice(0, 10), payment_method: '', supplier_id: '', description: '', reference: '' };

// Purchasing (Operations menu). Expenses has its own page under
// Finance (pages/Expenses.jsx, which uses ExpensesTab below).
// In the order of the work: buying, then the supplier list. The stock itself
// (items, adjust, stock opname, usage, value) is its own page, pages/Stock.jsx.
const TABS = [
  { key: 'requests', label: 'Requests' },
  { key: 'purchase_orders', label: 'Purchase Orders' },
  { key: 'direct', label: 'Bought without a PO' },
  { key: 'suppliers', label: 'Suppliers' },
];

export default function BackOffice() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  // The buying cycle, left to right: a department asks (Requests) → purchasing
  // orders (Purchase Orders) or buys on the spot (Bought without a PO).
  // `purchasing` sees every tab; `direct_purchase` alone (e.g. the accountant)
  // only Buy without a PO; `purchase_request` alone (a department head) only
  // Requests — to ask and follow what they asked for.
  const full = can('purchasing');
  const tabs = full ? TABS : TABS.filter(t =>
    (t.key === 'direct' && can('direct_purchase')) || (t.key === 'requests' && can('purchase_request')));
  const asked = params.get('tab');
  const tab = tabs.some(t => t.key === asked) ? asked
    : params.get('po') && full ? 'purchase_orders' : tabs[0]?.key;
  const setTab = key => setParams({ tab: key }, { replace: true });
  const onlyRequests = tabs.length === 1 && tab === 'requests';

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{onlyRequests ? 'Purchase requests' : 'Purchasing'}</div>
          <div className="page-subtitle">{onlyRequests ? 'Ask purchasing for what your department needs, and follow it until it arrives'
            : full ? 'Requests from the departments, purchase orders, stock bought without a PO, and suppliers — the stock itself is on Stock'
            : 'Stock bought without a purchase order'}</div>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="tab-bar">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`tab-bar-item${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'requests' && <PurchaseRequests embedded />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'purchase_orders' && <PurchaseOrdersTab />}
      {tab === 'direct' && <DirectPurchasesTab />}
    </div>
  );
}

// ───────────────────────────── Suppliers ─────────────────────────────

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState([]);
  const [modal, setModal] = useState(null); // { mode: 'add'|'edit', id? }
  const [form, setForm] = useState(EMPTY_SUPPLIER);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  function load() { api.get('/api/purchasing/suppliers').then(r => setSuppliers(r.data)).catch(() => {}); }
  useEffect(() => { load(); }, []);

  function openAdd() { setForm(EMPTY_SUPPLIER); setError(''); setModal({ mode: 'add' }); }
  function openEdit(s) {
    setForm({
      name: s.name, contact_name: s.contact_name || '', contact_phone: s.contact_phone || '',
      contact_email: s.contact_email || '', address: s.address || '', payment_terms_days: s.payment_terms_days ?? '',
    });
    setError('');
    setModal({ mode: 'edit', id: s.id });
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    const payload = { ...form, payment_terms_days: form.payment_terms_days === '' ? null : parseInt(form.payment_terms_days) };
    try {
      if (modal.mode === 'add') await api.post('/api/purchasing/suppliers', payload);
      else await api.put(`/api/purchasing/suppliers/${modal.id}`, payload);
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  }

  async function deactivate(s) {
    if (!confirm(`Deactivate ${s.name}? It stays visible on past purchase orders but won't be selectable for new ones.`)) return;
    await api.delete(`/api/purchasing/suppliers/${s.id}`);
    load();
  }

  const filtered = suppliers.filter(s => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [s.name, s.contact_name, s.contact_phone, s.contact_email].some(v => v?.toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <input className="form-input" style={{ maxWidth: 320 }} placeholder="Search suppliers…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={openAdd}>+ Add Supplier</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Terms</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.contact_name || <span className="text-muted">—</span>}</td>
                  <td>{s.contact_phone || <span className="text-muted">—</span>}</td>
                  <td>{s.payment_terms_days != null ? `${s.payment_terms_days}d` : <span className="text-muted">—</span>}</td>
                  <td><span className={`badge badge-${s.is_active ? 'green' : 'gray'}`}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(s)}>Edit</button>
                      {s.is_active && <button className="btn btn-sm btn-secondary" onClick={() => deactivate(s)}>Deactivate</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>{suppliers.length === 0 ? 'No suppliers yet' : 'No suppliers match your search'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{modal.mode === 'add' ? 'Add Supplier' : 'Edit Supplier'}</div>
              <button className="btn btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Contact person</label><input className="form-input" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Payment terms (days)</label><input className="form-input" type="number" value={form.payment_terms_days} onChange={e => setForm(f => ({ ...f, payment_terms_days: e.target.value }))} placeholder="e.g. 30" /></div>
              </div>
              <div className="form-group"><label className="form-label">Address</label><textarea className="form-textarea" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{modal.mode === 'add' ? 'Add Supplier' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Purchase Orders ───────────────────────────

function PurchaseOrdersTab() {
  const [pos, setPos] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [newModal, setNewModal] = useState(false);
  const [detail, setDetail] = useState(null); // full PO with items
  const [directDetail, setDirectDetail] = useState(null); // a purchase bought without a PO
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  function showToast(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); }

  function loadPos() {
    api.get('/api/purchasing/purchase-orders', { params: statusFilter ? { status: statusFilter } : {} })
      .then(r => setPos(r.data)).catch(() => {});
  }
  useEffect(() => { loadPos(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?po=<id> (from Purchase requests) opens that purchase order.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get('po');
    if (!id) return;
    refreshDetail(id);
    params.delete('po'); params.set('tab', 'purchase_orders'); setParams(params, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/api/purchasing/suppliers').then(r => setSuppliers(r.data.filter(s => s.is_active))).catch(() => {});
    api.get('/api/purchasing/raw-materials').then(r => setMaterials(r.data.filter(m => m.is_active))).catch(() => {});
    // Only sales items kept in stock (bottled water, minibar, merchandise…) can be bought on a PO —
    // not extra beds, typed-price charges or anything else that isn't counted.
    api.get('/api/products').then(r => setProducts(r.data.filter(p => p.track_stock && !p.per_night && !p.open_price))).catch(() => setProducts([])); // sales module may be off
  }, []);

  function openDetail(po) {
    if (po.is_direct) {
      api.get(`/api/purchasing/direct/${po.id}`).then(r => setDirectDetail(r.data)).catch(() => showToast('Failed to load the purchase', 'error'));
      return;
    }
    api.get(`/api/purchasing/purchase-orders/${po.id}`).then(r => setDetail(r.data)).catch(() => showToast('Failed to load purchase order', 'error'));
  }
  function refreshDetail(id) {
    api.get(`/api/purchasing/purchase-orders/${id}`).then(r => setDetail(r.data)).catch(() => {});
  }
  // A PO waiting for approval can be approved / sent back on Telegram — keep
  // its open window (and the list) up to date while it waits.
  const waitingId = detail?.status === 'pending_approval' ? detail.id : null;
  useEffect(() => {
    if (!waitingId) return;
    const t = setInterval(() => {
      api.get(`/api/purchasing/purchase-orders/${waitingId}`).then(r => {
        setDetail(d => (d?.id === waitingId ? r.data : d));
        if (r.data.status !== 'pending_approval') loadPos();
      }).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [waitingId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(po, status) {
    try {
      await api.patch(`/api/purchasing/purchase-orders/${po.id}/status`, { status });
      showToast(`Moved to ${PO_STATUS_LABELS[status]}`);
      loadPos();
      if (detail?.id === po.id) refreshDetail(po.id);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update status', 'error');
    }
  }

  const filtered = pos.filter(po => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [po.po_number, po.supplier_name, po.notes].some(v => v?.toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="flex gap-2">
          <input className="form-input" style={{ maxWidth: 260 }} placeholder="Search PO # or supplier…" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="form-select" style={{ width: 180 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(PO_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => downloadCsv(`/api/purchasing/purchase-orders/export${statusFilter ? `?status=${statusFilter}` : ''}`, 'purchase-orders.csv')}>⬇ Export CSV</button>
          <button className="btn btn-primary" onClick={() => setNewModal(true)}>+ New Purchase Order</button>
        </div>
      </div>

      {toast && <div className={`alert ${toast.type === 'error' ? 'alert-error' : 'alert-success'}`}>{toast.msg}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>PO #</th><th>Supplier</th><th>Total</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(po => (
                <tr key={po.id}>
                  <td style={{ fontWeight: 600, borderLeft: `4px solid ${PO_STATUS_COLOR[po.status]}` }}>{po.po_number}</td>
                  <td>{po.supplier_name}{po.is_direct && <span className="badge badge-gray" style={{ marginLeft: 6 }} title="Bought without a PO">Direct</span>}</td>
                  <td style={{ textDecoration: po.voided_at ? 'line-through' : 'none' }}>{fmtIDR(po.total_amount)}</td>
                  <td>{fmtDate(po.created_at)}</td>
                  <td><span className={`badge badge-${po.voided_at ? 'red' : PO_STATUS_BADGE[po.status]}`} style={{ fontSize: 13, padding: '5px 14px' }}>{po.voided_at ? 'Voided' : PO_STATUS_LABELS[po.status]}</span></td>
                  <td><button className="btn btn-sm btn-secondary" onClick={() => openDetail(po)}>View</button></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>{pos.length === 0 ? 'No purchase orders yet' : 'No purchase orders match your search'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {newModal && (
        <NewPOModal
          suppliers={suppliers} products={products} materials={materials}
          onClose={() => setNewModal(false)}
          onCreated={() => { setNewModal(false); showToast('Purchase order created'); loadPos(); }}
          onError={m => showToast(m, 'error')}
        />
      )}

      {directDetail && (
        <DirectPurchaseDetail p={directDetail} onClose={() => setDirectDetail(null)}
          onVoided={(p, sent) => { setDirectDetail(p); loadPos(); showToast(sent ? `${p.po_number} — sent to the POS` : `${p.po_number} voided — stock taken back out`); }} />
      )}

      {detail && (
        <PODetailModal
          po={detail}
          suppliers={suppliers} products={products} materials={materials}
          onEdited={() => { showToast('Purchase order saved'); loadPos(); refreshDetail(detail.id); }}
          onClose={() => setDetail(null)}
          onStatus={status => setStatus(detail, status)}
          onReceived={sync => {
            showToast(sync?.failed ? `Received — but the restaurant system did not get it: ${sync.error}. Use "Send to the POS" on the PO.`
              : sync?.sent ? 'Received — restaurant items sent to the POS stock' : 'Received', sync?.failed ? 'error' : 'success');
            loadPos(); refreshDetail(detail.id);
          }}
          onError={m => showToast(m, 'error')}
        />
      )}
    </div>
  );
}

function NewPOModal({ suppliers, products, materials, onClose, onCreated, onError }) {
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ kind: 'material', product_id: '', raw_material_id: '', quantity: '', unit_cost: '' }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function updateLine(i, patch) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function addLine() { setLines(ls => [...ls, { kind: 'material', product_id: '', raw_material_id: '', quantity: '', unit_cost: '' }]); }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)); }

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0), 0);

  async function submit() {
    setFormError('');
    if (!supplierId) { setFormError('Pick a supplier'); return; }
    const items = [];
    for (const l of lines) {
      const unit = l.kind === 'material' ? materials.find(x => x.id === l.raw_material_id)?.unit_of_measure : null;
      const { quantity: qty, unit_cost: cost } = toBase(l, unit);
      if (!qty || qty <= 0) { setFormError('Every line needs a positive quantity'); return; }
      if (!Number.isFinite(cost) || cost < 0) { setFormError('Every line needs a unit cost'); return; }
      if (l.kind === 'product') {
        if (!l.product_id) { setFormError('Choose the item on every "For resale" line'); return; }
        items.push({ product_id: l.product_id, quantity: qty, unit_cost: cost });
      } else {
        if (!l.raw_material_id) { setFormError('Choose the stock item on every line'); return; }
        items.push({ raw_material_id: l.raw_material_id, quantity: qty, unit_cost: cost });
      }
    }
    setSaving(true);
    try {
      await api.post('/api/purchasing/purchase-orders', { supplier_id: supplierId, notes: notes || null, items });
      onCreated();
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 980, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">New Purchase Order</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {formError && <div className="alert alert-error">{formError}</div>}
          <div className="form-group">
            <label className="form-label">Supplier *</label>
            <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="form-label" style={{ marginTop: 8 }}>What you are ordering</div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            <b>Stock item</b> — used by the hotel (rice, vegetables, cleaning supplies; see the Stock items tab).{' '}
            <b>For resale</b> — sold to guests as it is (bottled water, minibar drinks, souvenirs): Sales items with Track stock on.
          </div>
          <div className="table-wrap">
            <table style={{ minWidth: 760 }}>
              <thead><tr>
                <th style={{ width: 170 }}>Kind</th><th>Item</th><th style={{ width: 110, textAlign: 'right' }}>Qty</th>
                <th style={{ width: 160, textAlign: 'right' }}>Unit cost (IDR)</th><th style={{ width: 140, textAlign: 'right' }}>Line total</th><th style={{ width: 40 }}></th>
              </tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const m = l.kind === 'material' ? materials.find(x => x.id === l.raw_material_id) : null;
                  const lineTotal = (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0);
                  return (
                    <tr key={i}>
                      <td>
                        <select className="form-select" value={l.kind} onChange={e => updateLine(i, { kind: e.target.value, product_id: '', raw_material_id: '' })}>
                          <option value="material">Stock item</option>
                          <option value="product">For resale</option>
                        </select>
                      </td>
                      <td>
                        {l.kind === 'product' ? (
                          <ItemPicker value={l.product_id} onChange={v => updateLine(i, { product_id: v })}
                            placeholder={products.length ? 'Type to find the item…' : 'No Sales item has Track stock on'}
                            options={products.map(p => ({ value: p.id, label: p.name }))} />
                        ) : (
                          <ItemPicker value={l.raw_material_id} onChange={v => updateLine(i, { raw_material_id: v })}
                            placeholder={materials.length ? 'Type to find the stock item…' : 'No stock items yet — add them in Stock items'}
                            options={materials.map(x => ({ value: x.id, label: x.name, hint: x.unit_of_measure }))} />
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input className="form-input" style={{ textAlign: 'right' }} type="number" step={l.kind === 'material' ? '0.001' : '1'} value={l.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} />
                          {m && <UnitSwitch unit={m.unit_of_measure} line={l} onFlip={() => updateLine(i, flipBig(l, m.unit_of_measure))} />}
                        </div>
                      </td>
                      <td><input className="form-input" style={{ textAlign: 'right' }} type="number" placeholder={m ? perUnit(m.unit_of_measure, l) : 'per unit'} value={l.unit_cost} onChange={e => updateLine(i, { unit_cost: e.target.value })} /></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{lineTotal ? fmtIDR(lineTotal) : <span className="text-muted">—</span>}</td>
                      <td>{lines.length > 1 && <button className="btn btn-icon" title="Remove line" onClick={() => removeLine(i)}>✕</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={addLine}>+ Add line</button>

          <div style={{ fontWeight: 700, marginTop: 12, textAlign: 'right' }}>Total: {fmtIDR(total)}</div>
          <div className="form-group" style={{ marginTop: 10 }}>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create Purchase Order'}</button>
        </div>
      </div>
    </div>
  );
}

function PODetailModal({ po, suppliers, products, materials, onClose, onStatus, onReceived, onEdited, onError }) {
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { can, hasModule } = useAuth();   // approving needs the approve_po permission (owners always)
  // Received goods → the supplier's bill in Finance → Payables (needs the chart: accounting module).
  const canBill = can('payables') && hasModule('accounting') && po.items.some(it => Number(it.received_quantity) > 0);
  // Restaurant lines received here but not yet in the POS's stock (it was down / not linked).
  const unsent = po.items.some(it => it.pos_item_id && Number(it.received_quantity) > Number(it.pos_sent_qty));
  const [sending, setSending] = useState(false);
  async function sendToPos() {
    setSending(true);
    try {
      const r = await api.post(`/api/purchasing/purchase-orders/${po.id}/pos-send`);
      onReceived(r.data);
    } catch (err) { onError(err.response?.data?.error || 'Could not send'); }
    setSending(false);
  }

  const transitions = {
    draft: [['pending_approval', 'Submit for Approval'], ['cancelled', 'Cancel']],
    pending_approval: [can('approve_po') && ['approved', 'Approve'], ['draft', 'Back to Draft'], ['cancelled', 'Cancel']].filter(Boolean),
    approved: [['cancelled', 'Cancel']],
    received: [],
    cancelled: [],
  }[po.status] || [];

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{po.po_number}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{po.supplier_name}</div>
          </div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="flex gap-2" style={{ marginBottom: 12, alignItems: 'center' }}>
            <span className={`badge badge-${PO_STATUS_BADGE[po.status]}`}>{PO_STATUS_LABELS[po.status]}</span>
            {['approved', 'received'].includes(po.status) && po.approved_by_name && (
              <span className="text-muted" style={{ fontSize: 12 }}>by {po.approved_by_name}{po.approved_via === 'telegram' ? ' on Telegram' : ''}</span>)}
            {po.status === 'pending_approval' && po.telegram_approvers?.length > 0 && (
              <span className="text-muted" style={{ fontSize: 12 }} title="They can approve it from the Telegram message">Waiting on Telegram: {po.telegram_approvers.join(', ')}</span>)}
            {po.notes && <span className="text-muted" style={{ fontSize: 13 }}>{po.notes}</span>}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Item</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>Received</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>Unit cost</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>Line total</th>
            </tr></thead>
            <tbody>
              {po.items.map(it => (
                <tr key={it.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '6px 4px' }}>
                    {it.description}{it.unit_of_measure && !it.product_id ? ` (${it.unit_of_measure})` : ''}
                    {it.line_kind === 'pos' && <span className="badge badge-orange" style={{ marginLeft: 6 }} title="Goes to the restaurant's stock in the POS when received">Restaurant</span>}
                    {it.line_kind === 'text' && <span className="badge badge-gray" style={{ marginLeft: 6 }} title="Not kept in any stock">Not in stock</span>}
                    {it.request_no_text && <Link to="/purchasing?tab=requests&view=requests" className="text-muted" style={{ marginLeft: 6, fontSize: 11 }}>{it.request_no_text}</Link>}
                    {it.line_kind === 'pos' && it.pos_send_error && <div style={{ fontSize: 11, color: 'var(--danger-text)' }}>Not sent to the POS: {it.pos_send_error}</div>}
                    {it.line_kind === 'pos' && !it.pos_send_error && Number(it.received_quantity) > 0 && Number(it.pos_sent_qty) >= Number(it.received_quantity) && <div style={{ fontSize: 11, color: '#16A34A' }}>In the restaurant's stock</div>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 4px' }}>{it.product_id ? it.quantity : fmtQty(it.quantity, it.unit_of_measure)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 4px', color: Number(it.received_quantity) >= Number(it.quantity) ? '#16A34A' : '#6B7280' }}>{it.product_id ? it.received_quantity : fmtQty(it.received_quantity, it.unit_of_measure)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 4px' }}>
                    {perUnitIDR(it.unit_cost, it.product_id ? null : it.unit_of_measure)}
                    {it.price_jump != null && (
                      <div style={{ fontSize: 11, color: 'var(--danger-text)', whiteSpace: 'nowrap' }} title="Compared with the item's average cost">
                        ⚠ {Math.round(it.price_jump * 100)}% above usual {perUnitIDR(it.usual_cost, it.product_id ? null : it.unit_of_measure)}
                      </div>)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 4px' }}>{fmtIDR(it.quantity * it.unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontWeight: 700, textAlign: 'right' }}>Total: {fmtIDR(po.total_amount)}</div>

          <div className="form-label" style={{ marginTop: 16 }}>Activity</div>
          <div style={{ fontSize: 12 }}>
            {(po.events || []).map(e => (
              <div key={e.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #F3F4F6' }}>
                <div style={{ color: '#9CA3AF', whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</div>
                <div style={{ flex: 1 }}>{e.note}{e.created_by_name ? <span className="text-muted"> — {e.created_by_name}</span> : ''}</div>
              </div>
            ))}
            {(!po.events || po.events.length === 0) && <div className="text-muted">No activity yet.</div>}
          </div>
        </div>
        <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
          {po.status === 'draft' && <button className="btn btn-sm btn-secondary" onClick={() => setEditOpen(true)}>✏ Edit</button>}
          {transitions.map(([status, label]) => (
            <button key={status} className={`btn btn-sm ${status === 'cancelled' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => onStatus(status)}>{label}</button>
          ))}
          {po.status === 'approved' && <button className="btn btn-sm btn-primary" onClick={() => setReceiveOpen(true)}>Receive Items</button>}
          {unsent && <button className="btn btn-sm btn-secondary" disabled={sending} onClick={sendToPos}>{sending ? 'Sending…' : 'Send to the POS'}</button>}
          {canBill && <Link className="btn btn-sm btn-secondary" to={`/payables?from_po=${po.id}`} title="Record the supplier's bill for what was received">Make bill</Link>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>

      {editOpen && (
        <EditPOModal po={po} suppliers={suppliers} products={products} materials={materials}
          onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); onEdited(); }} onError={onError} />
      )}
      {receiveOpen && (
        <ReceiveModal po={po} onClose={() => setReceiveOpen(false)} onDone={sync => { setReceiveOpen(false); onReceived(sync); }} onError={onError} />
      )}
    </div>
  );
}

// Rp per unit, per kg / L for items kept in g / ml.
function perUnitIDR(cost, unit) {
  const big = BIG_UNIT[unit];
  return big ? `${fmtIDR(Math.round(cost * big[1]))}/${big[0]}` : fmtIDR(Math.round(cost));
}

// A draft PO (new, or sent back from approval) — quantities, prices, supplier,
// lines added or taken off, note. Lines from a purchase request keep their link.
function EditPOModal({ po, suppliers, products, materials, onClose, onSaved, onError }) {
  const lineOf = it => {
    const unit = it.product_id ? null : it.unit_of_measure;
    return {
      key: it.id, kind: it.raw_material_id ? 'material' : it.product_id ? 'product' : it.pos_item_id ? 'pos' : 'text',
      raw_material_id: it.raw_material_id || '', product_id: it.product_id || '', pos_item_id: it.pos_item_id || null,
      description: it.description, unit: it.unit || null, request_line_id: it.request_line_id || null,
      request_no_text: it.request_no_text, usual_cost: it.usual_cost, existing: true,
      ...(BIG_UNIT[unit] ? fromBase(unit, it.quantity, it.unit_cost) : { big: false, quantity: String(Number(it.quantity)), unit_cost: String(Number(it.unit_cost)) }),
    };
  };
  const [supplierId, setSupplierId] = useState(po.supplier_id || '');
  const [notes, setNotes] = useState(po.notes || '');
  const [lines, setLines] = useState(() => po.items.map(lineOf));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const upd = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const unitOf = l => (l.kind === 'material' ? (materials.find(m => m.id === l.raw_material_id)?.unit_of_measure || l.unit) : l.kind === 'pos' ? l.unit : null);
  const usualOf = l => (l.existing ? l.usual_cost
    : l.kind === 'material' ? Number(materials.find(m => m.id === l.raw_material_id)?.cost_per_unit) || null
    : l.kind === 'product' ? Number(products.find(p => p.id === l.product_id)?.cost_per_unit) || null : null);
  const total = lines.reduce((t, l) => t + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0), 0);

  async function save() {
    setFormError('');
    if (!supplierId) return setFormError('Pick a supplier');
    if (!lines.length) return setFormError('A purchase order needs at least one line');
    const items = [];
    for (const l of lines) {
      const { quantity, unit_cost } = toBase(l, unitOf(l));
      if (!(quantity > 0)) return setFormError(`How many ${l.description || 'of each item'}?`);
      if (!Number.isFinite(unit_cost) || unit_cost < 0) return setFormError(`Type the price of ${l.description || 'each item'}`);
      const base = { quantity, unit_cost, request_line_id: l.request_line_id || undefined };
      if (l.kind === 'material') { if (!l.raw_material_id) return setFormError('Choose the stock item on every line'); items.push({ ...base, raw_material_id: l.raw_material_id }); }
      else if (l.kind === 'product') { if (!l.product_id) return setFormError('Choose the item on every "For resale" line'); items.push({ ...base, product_id: l.product_id }); }
      else items.push({ ...base, pos_item_id: l.pos_item_id || undefined, description: l.description, unit: l.unit });
    }
    setSaving(true);
    try {
      await api.put(`/api/purchasing/purchase-orders/${po.id}`, { supplier_id: supplierId, notes, items });
      onSaved();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not save');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 980, width: '100%' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Edit {po.po_number}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>A draft can be changed freely — submit it for approval again when it's right.</div>
          </div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {formError && <div className="alert alert-error">{formError}</div>}
          <div className="form-group">
            <label className="form-label">Supplier *</label>
            <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">Select supplier…</option>
              {suppliers.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table style={{ minWidth: 760 }}>
              <thead><tr>
                <th>Item</th><th style={{ width: 150, textAlign: 'right' }}>Qty</th>
                <th style={{ width: 190, textAlign: 'right' }}>Price per unit (IDR)</th><th style={{ width: 130, textAlign: 'right' }}>Line total</th><th style={{ width: 40 }}></th>
              </tr></thead>
              <tbody>
                {lines.map(l => {
                  const unit = unitOf(l);
                  const lineTotal = (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0);
                  const usual = usualOf(l);
                  const perBase = toBase(l, unit).unit_cost;
                  const jump = usual > 0 && perBase > usual * 1.2 ? perBase / usual - 1 : null;
                  return (
                    <tr key={l.key}>
                      <td>
                        {l.existing ? (
                          <div>
                            {l.description}
                            {l.kind === 'pos' && <span className="badge badge-orange" style={{ marginLeft: 6 }}>Restaurant</span>}
                            {l.kind === 'text' && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Not in stock</span>}
                            {l.request_no_text && <span className="text-muted" style={{ marginLeft: 6, fontSize: 11 }}>{l.request_no_text}</span>}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select className="form-select" style={{ width: 130 }} value={l.kind} onChange={e => upd(l.key, { kind: e.target.value, product_id: '', raw_material_id: '' })}>
                              <option value="material">Stock item</option>
                              <option value="product">For resale</option>
                            </select>
                            {l.kind === 'product' ? (
                              <ItemPicker style={{ flex: 1 }} value={l.product_id} onChange={v => upd(l.key, { product_id: v, description: products.find(p => p.id === v)?.name })}
                                placeholder="Type to find the item…" options={products.map(p => ({ value: p.id, label: p.name }))} />
                            ) : (
                              <ItemPicker style={{ flex: 1 }} value={l.raw_material_id} onChange={v => upd(l.key, { raw_material_id: v, description: materials.find(m => m.id === v)?.name })}
                                placeholder="Type to find the stock item…" options={materials.map(m => ({ value: m.id, label: m.name, hint: m.unit_of_measure }))} />
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input className="form-input" style={{ textAlign: 'right' }} type="number" step="any" value={l.quantity} onChange={e => upd(l.key, { quantity: e.target.value })} />
                          {unit && <UnitSwitch unit={unit} line={l} onFlip={() => upd(l.key, flipBig(l, unit))} />}
                        </div>
                      </td>
                      <td>
                        <input className="form-input" style={{ textAlign: 'right' }} type="number" step="any" placeholder={unit ? perUnit(unit, l) : 'per unit'} value={l.unit_cost} onChange={e => upd(l.key, { unit_cost: e.target.value })} />
                        {usual > 0 && (
                          <div style={{ fontSize: 11, textAlign: 'right', marginTop: 2, color: jump ? 'var(--danger-text)' : 'var(--text-muted)' }}>
                            {jump ? `⚠ ${Math.round(jump * 100)}% above ` : ''}usual {perUnitIDR(usual, unit)}
                          </div>)}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{lineTotal ? fmtIDR(lineTotal) : <span className="text-muted">—</span>}</td>
                      <td><button className="btn btn-icon" title="Take this line off the PO" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }}
            onClick={() => setLines(ls => [...ls, { key: `new-${Date.now()}`, kind: 'material', raw_material_id: '', product_id: '', quantity: '', unit_cost: '' }])}>+ Add line</button>
          {lines.some(l => l.request_line_id) && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
              Taking a line from a purchase request off this PO puts it back on the request's <b>To order</b> list.
            </div>)}
          <div style={{ fontWeight: 700, marginTop: 12, textAlign: 'right' }}>Total: {fmtIDR(total)}</div>
          <div className="form-group" style={{ marginTop: 10 }}>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

function ReceiveModal({ po, onClose, onDone, onError }) {
  const outstanding = po.items.filter(it => Number(it.received_quantity) < Number(it.quantity));
  // Lines kept in g / ml are received in kg / L (switchable).
  const unitOf = it => (it.product_id ? null : it.unit_of_measure);
  const [amounts, setAmounts] = useState(() => Object.fromEntries(outstanding.map(it => [it.id, fromBase(unitOf(it), Number(it.quantity) - Number(it.received_quantity))])));
  const [saving, setSaving] = useState(false);

  async function submit() {
    const items = Object.entries(amounts)
      .map(([item_id, v]) => ({ item_id, receive_quantity: toBase(v, unitOf(po.items.find(it => it.id === item_id)), 'quantity', null).quantity }))
      .filter(i => i.receive_quantity > 0);
    if (items.length === 0) { onError('Enter a quantity to receive for at least one item'); return; }
    setSaving(true);
    try {
      const r = await api.post(`/api/purchasing/purchase-orders/${po.id}/receive`, { items });
      onDone(r.data?.pos_sync);
    } catch (err) {
      onError(err.response?.data?.error || 'Failed to receive items');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Receive Items — {po.po_number}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {outstanding.length === 0 ? (
            <div className="text-muted">Everything on this PO has already been received.</div>
          ) : outstanding.map(it => (
            <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 13 }}>
                {it.description}
                <div className="text-muted" style={{ fontSize: 11 }}>
                  outstanding {fmtQty(Number(it.quantity) - Number(it.received_quantity), unitOf(it))}
                  {it.line_kind === 'pos' ? ' · to the restaurant stock (POS)' : it.line_kind === 'text' ? ' · not kept in stock' : ''}
                </div>
              </div>
              <input
                className="form-input" style={{ width: 100 }} type="number" step={it.product_id ? '1' : 'any'} min="0"
                value={amounts[it.id]?.quantity ?? ''} onChange={e => setAmounts(a => ({ ...a, [it.id]: { ...a[it.id], quantity: e.target.value } }))}
              />
              <UnitSwitch unit={unitOf(it)} line={amounts[it.id] || {}} onFlip={() => setAmounts(a => ({ ...a, [it.id]: { ...a[it.id], ...flipBig(a[it.id], unitOf(it), 'quantity', null) } }))} />
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || outstanding.length === 0}>{saving ? 'Saving…' : 'Confirm Receipt'}</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Expenses ─────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// One expense, everything recorded about it (Finance → Expenses, row click).
function ExpenseDetail({ e, onClose, onVoid }) {
  const row = (label, value) => (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="text-muted" style={{ fontSize: 13 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value || <span className="text-muted">—</span>}</div>
    </div>
  );
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 520, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Expense · {fmtIDR(e.amount)}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {e.is_voided && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              <div>Voided {fmtDateTime(e.voided_at)}{e.voided_by_name ? ` by ${e.voided_by_name}` : ''}{e.void_reason ? ` — ${e.void_reason}` : ''}. Not counted in the totals.</div>
            </div>
          )}
          {row('Date', fmtDate(e.incurred_on))}
          {row('Category', EXPENSE_CATEGORY_LABELS[e.category] || e.category)}
          {row('Department', DEPARTMENT_LABEL[e.department])}
          {row('Amount', <b style={{ textDecoration: e.is_voided ? 'line-through' : 'none' }}>{fmtIDR(e.amount)}</b>)}
          {row('Paid via', e.payment_method_label || e.payment_method)}
          {row('Supplier', e.supplier_name)}
          {row('Reference', e.reference)}
          {e.po_number && row('From', <>Bought without a PO — <b>{e.po_number}</b> (Purchasing)</>)}
          {row('Description', e.description)}
          {row('Recorded', `${e.created_by_name || 'Unknown'} · ${fmtDateTime(e.created_at)}`)}
        </div>
        <div className="modal-footer">
          {!e.is_voided && e.po_number && <span className="text-muted" style={{ fontSize: 12, marginRight: 'auto' }}>Void it in Purchasing → Bought without a PO, so the stock is taken back out too.</span>}
          {!e.is_voided && !e.po_number && <button className="btn btn-danger" onClick={onVoid}>Void…</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function ExpensesTab() {
  const now = new Date();
  // ?month=YYYY-MM&expense=<id> (from Insights → Costs) opens that month and that expense.
  const [params, setParams] = useSearchParams();
  const linked = /^(\d{4})-(\d{2})$/.exec(params.get('month') || '');
  const [month, setMonth] = useState(linked ? Number(linked[2]) : now.getMonth() + 1);
  const [year, setYear] = useState(linked ? Number(linked[1]) : now.getFullYear());
  const [category, setCategory] = useState('');
  const [department, setDepartment] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [open, setOpen] = useState(null);        // the expense whose details are shown
  const [voiding, setVoiding] = useState(null);  // the expense being voided (asks why)
  const [expenses, setExpenses] = useState([]);
  const [deptTouched, setDeptTouched] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_EXPENSE);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);

  function load() {
    const params = { month, year };
    if (category) params.category = category;
    if (department) params.department = department;
    if (showVoided) params.voided = 1;
    api.get('/api/expenses', { params }).then(r => setExpenses(r.data)).catch(() => {});
  }
  useEffect(() => { load(); }, [month, year, category, department, showVoided]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = params.get('expense');
    const e = id && expenses.find(x => x.id === id);
    if (!e) return;
    setOpen(e);
    const n = new URLSearchParams(params); n.delete('expense'); n.delete('month'); setParams(n, { replace: true });
  }, [expenses]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/api/purchasing/suppliers').then(r => setSuppliers(r.data.filter(s => s.is_active))).catch(() => {});
    api.get('/api/settings/payment-methods').then(r => setPaymentMethods(r.data.filter(m => m.is_active))).catch(() => setPaymentMethods([]));
  }, []);

  function openAdd() { setForm({ ...EMPTY_EXPENSE, incurred_on: new Date().toISOString().slice(0, 10) }); setDeptTouched(false); setError(''); setModal(true); }
  // The department follows the category (or the supplier's usual one) until it is chosen by hand.
  function pickCategory(cat) {
    setForm(f => ({ ...f, category: cat, department: deptTouched ? f.department
      : (suppliers.find(s => s.id === f.supplier_id)?.default_department || categoryDepartment(cat)) }));
  }
  function pickSupplier(id) {
    const sup = suppliers.find(s => s.id === id);
    setForm(f => ({ ...f, supplier_id: id, department: deptTouched ? f.department : (sup?.default_department || categoryDepartment(f.category)) }));
  }

  async function save() {
    const amt = parseFloat(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a valid amount'); return; }
    setSaving(true);
    try {
      await api.post('/api/expenses', {
        ...form,
        amount: amt,
        payment_method: form.payment_method || null,
        supplier_id: form.supplier_id || null,
      });
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function voidExpense(e, reason) {
    await api.delete(`/api/expenses/${e.id}`, { data: { reason } });
    setVoiding(null); setOpen(null);
    load();
  }

  const total = expenses.filter(e => !e.is_voided).reduce((s, e) => s + Number(e.amount), 0);

  function exportUrl() {
    const params = new URLSearchParams({ month, year });
    if (category) params.set('category', category);
    if (department) params.set('department', department);
    return `/api/expenses/export?${params.toString()}`;
  }

  return (
    <div>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 140 }} value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-select" style={{ width: 100 }} value={year} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="form-select" style={{ width: 180 }} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="form-select" style={{ width: 200 }} value={department} onChange={e => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {DEPARTMENTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <label className="flex gap-1" style={{ alignItems: 'center', fontSize: 13, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} /> Show voided
          </label>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => downloadCsv(exportUrl(), `expenses-${year}-${String(month).padStart(2, '0')}.csv`)}>⬇ Export CSV</button>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Expense</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12, padding: 14 }}>
        <div className="stat-label">Total — {MONTHS[month - 1]} {year}{category ? ` · ${EXPENSE_CATEGORY_LABELS[category]}` : ''}{department ? ` · ${DEPARTMENT_LABEL[department]}` : ''}</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtIDR(total)}</div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Department</th><th>Amount</th><th>Paid Via</th><th>Supplier</th><th>Reference</th></tr></thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} onClick={() => setOpen(e)} title="Open the details"
                  style={{ cursor: 'pointer', ...(e.is_voided ? { color: 'var(--text-muted)' } : {}) }}>
                  <td>{fmtDate(e.incurred_on)}</td>
                  <td><span className={`badge badge-${EXPENSE_CATEGORY_COLORS[e.category]}`}>{EXPENSE_CATEGORY_LABELS[e.category]}</span>
                    {e.is_voided && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Voided</span>}</td>
                  <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.po_number && <span className="badge badge-gray" style={{ marginRight: 6 }} title="Made by Buy without a PO">{e.po_number}</span>}{e.description || <span className="text-muted">—</span>}</td>
                  <td>{DEPARTMENT_LABEL[e.department] || '—'}</td>
                  <td style={{ fontWeight: 600, textDecoration: e.is_voided ? 'line-through' : 'none' }}>{fmtIDR(e.amount)}</td>
                  <td>{e.payment_method_label || e.payment_method || <span className="text-muted">—</span>}</td>
                  <td>{e.supplier_name || <span className="text-muted">—</span>}</td>
                  <td>{e.reference || <span className="text-muted">—</span>}</td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No expenses recorded for this period</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {open && !voiding && <ExpenseDetail e={open} onClose={() => setOpen(null)} onVoid={() => setVoiding(open)} />}
      {voiding && (
        <ReasonModal title="Void this expense?" confirmLabel="Void expense" danger placeholder="e.g. entered twice, wrong amount"
          onConfirm={reason => voidExpense(voiding, reason)} onClose={() => setVoiding(null)}>
          <p style={{ marginTop: 0 }}>{EXPENSE_CATEGORY_LABELS[voiding.category]} · {fmtIDR(voiding.amount)} · {fmtDate(voiding.incurred_on)}</p>
          <p className="text-muted" style={{ fontSize: 13 }}>It stays on record (Show voided) but leaves the totals, the reports and the journal. A wrong expense is put right by voiding it and adding it again.</p>
        </ReasonModal>
      )}

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Expense</div>
              <button className="btn btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-row">
                <div className="form-group"><label className="form-label">Category *</label>
                  <select className="form-select" value={form.category} onChange={e => pickCategory(e.target.value)}>
                    {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Department *</label>
                  <select className="form-select" value={form.department} onChange={e => { setDeptTouched(true); setForm(f => ({ ...f, department: e.target.value })); }}>
                    {DEPARTMENTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Amount (IDR) *</label><input className="form-input" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={form.incurred_on} onChange={e => setForm(f => ({ ...f, incurred_on: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Paid via</label>
                  <select className="form-select" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
                    <option value="">Not specified</option>
                    {paymentMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group"><label className="form-label">Supplier / vendor</label>
                <select className="form-select" value={form.supplier_id} onChange={e => pickSupplier(e.target.value)}>
                  <option value="">None — one-off cost</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Reference</label><input className="form-input" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="invoice / receipt #" /></div>
              </div>
              <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="optional" /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Expense'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
