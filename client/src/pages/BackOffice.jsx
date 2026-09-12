import { useState, useEffect } from 'react';
import api from '../services/api';

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
const EMPTY_MATERIAL = { name: '', unit_of_measure: 'kg', low_stock_threshold: '', cost_per_unit: '' };
const UNITS = ['kg', 'g', 'l', 'ml', 'pcs'];

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

const EXPENSE_CATEGORY_LABELS = {
  utilities: 'Utilities', laundry: 'Laundry', maintenance: 'Maintenance', staff: 'Staff',
  supplies: 'Supplies', marketing: 'Marketing', admin_fees: 'Admin & Bank Fees', other: 'Other',
};
const EXPENSE_CATEGORY_COLORS = {
  utilities: 'blue', laundry: 'purple', maintenance: 'orange', staff: 'pink',
  supplies: 'amber', marketing: 'green', admin_fees: 'gray', other: 'gray',
};
const EMPTY_EXPENSE = { category: 'utilities', amount: '', incurred_on: new Date().toISOString().slice(0, 10), payment_method: '', supplier_id: '', description: '', reference: '' };

function materialStockBadge(m) {
  if (m.stock_quantity <= 0) return <span className="badge badge-red">Out of stock</span>;
  if (m.low_stock_threshold != null && Number(m.stock_quantity) <= Number(m.low_stock_threshold)) {
    return <span className="badge badge-amber">Low: {m.stock_quantity} {m.unit_of_measure}</span>;
  }
  return <span className="badge badge-gray">{m.stock_quantity} {m.unit_of_measure}</span>;
}

const TABS = [
  { key: 'suppliers', icon: '🚚', label: 'Suppliers' },
  { key: 'raw_materials', icon: '🌾', label: 'Raw Materials' },
  { key: 'purchase_orders', icon: '📦', label: 'Purchase Orders' },
  { key: 'expenses', icon: '🧾', label: 'Expenses' },
  { key: 'inventory_value', icon: '📊', label: 'Inventory Value' },
];

export default function BackOffice() {
  const [tab, setTab] = useState('suppliers');

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <div>
          <div className="page-title">Back Office</div>
          <div className="page-subtitle">Suppliers, Purchasing &amp; Expenses · Owner only</div>
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`tab-bar-item${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'raw_materials' && <RawMaterialsTab />}
      {tab === 'purchase_orders' && <PurchaseOrdersTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'inventory_value' && <InventoryValueTab />}
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

// ─────────────────────────── Raw Materials ───────────────────────────

function RawMaterialsTab() {
  const [materials, setMaterials] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_MATERIAL);
  const [error, setError] = useState('');
  const [stockModal, setStockModal] = useState(null); // material row
  const [stockForm, setStockForm] = useState({ change_qty: '', reason: 'purchase', note: '' });
  const [search, setSearch] = useState('');

  function load() { api.get('/api/purchasing/raw-materials').then(r => setMaterials(r.data)).catch(() => {}); }
  useEffect(() => { load(); }, []);

  function openAdd() { setForm(EMPTY_MATERIAL); setError(''); setModal({ mode: 'add' }); }
  function openEdit(m) {
    setForm({ name: m.name, unit_of_measure: m.unit_of_measure, low_stock_threshold: m.low_stock_threshold ?? '', cost_per_unit: m.cost_per_unit ?? '' });
    setError('');
    setModal({ mode: 'edit', id: m.id });
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    const payload = {
      ...form,
      low_stock_threshold: form.low_stock_threshold === '' ? null : parseFloat(form.low_stock_threshold),
      cost_per_unit: form.cost_per_unit === '' ? null : parseFloat(form.cost_per_unit),
    };
    try {
      if (modal.mode === 'add') await api.post('/api/purchasing/raw-materials', payload);
      else await api.put(`/api/purchasing/raw-materials/${modal.id}`, payload);
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  }

  async function deactivate(m) {
    if (!confirm(`Deactivate ${m.name}? It stays on past purchase orders but won't be selectable for new ones.`)) return;
    await api.delete(`/api/purchasing/raw-materials/${m.id}`);
    load();
  }

  function openStockModal(m) { setStockForm({ change_qty: '', reason: 'purchase', note: '' }); setStockModal(m); }
  async function submitStockAdjust() {
    const qty = parseFloat(stockForm.change_qty);
    if (!qty) return;
    const signedQty = stockForm.reason === 'purchase' ? Math.abs(qty) : -Math.abs(qty);
    try {
      await api.patch(`/api/purchasing/raw-materials/${stockModal.id}/stock`, { change_qty: signedQty, reason: stockForm.reason, note: stockForm.note || null });
      setStockModal(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not adjust stock');
    }
  }

  const filtered = materials.filter(m => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.unit_of_measure?.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <input className="form-input" style={{ maxWidth: 320 }} placeholder="Search raw materials…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={openAdd}>+ Add Raw Material</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Unit</th><th>Stock</th><th>Cost / unit</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m.unit_of_measure}</td>
                  <td>{materialStockBadge(m)}</td>
                  <td>{m.cost_per_unit != null ? fmtIDR(m.cost_per_unit) : <span className="text-muted">—</span>}</td>
                  <td><span className={`badge badge-${m.is_active ? 'green' : 'gray'}`}>{m.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(m)}>Edit</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => openStockModal(m)}>Adjust Stock</button>
                      {m.is_active && <button className="btn btn-sm btn-secondary" onClick={() => deactivate(m)}>Deactivate</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>{materials.length === 0 ? 'No raw materials yet' : 'No raw materials match your search'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{modal.mode === 'add' ? 'Add Raw Material' : 'Edit Raw Material'}</div>
              <button className="btn btn-icon" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rice" /></div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Unit of measure</label>
                  <select className="form-select" value={form.unit_of_measure} onChange={e => setForm(f => ({ ...f, unit_of_measure: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Low stock alert below</label><input className="form-input" type="number" step="0.001" value={form.low_stock_threshold} onChange={e => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))} placeholder="e.g. 5" /></div>
              </div>
              <div className="form-group"><label className="form-label">Reference cost per unit (IDR)</label><input className="form-input" type="number" value={form.cost_per_unit} onChange={e => setForm(f => ({ ...f, cost_per_unit: e.target.value }))} placeholder="optional — updates automatically on receipt" /></div>
              {modal.mode === 'edit' && (
                <div className="text-muted" style={{ fontSize: 12 }}>Use "Adjust Stock" from the list to change quantity.</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{modal.mode === 'add' ? 'Add Raw Material' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {stockModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Adjust Stock — {stockModal.name}</div>
              <button className="btn btn-icon" onClick={() => setStockModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>Current stock: {stockModal.stock_quantity} {stockModal.unit_of_measure}</div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Reason</label>
                  <select className="form-select" value={stockForm.reason} onChange={e => setStockForm(f => ({ ...f, reason: e.target.value }))}>
                    <option value="purchase">Purchase (+)</option>
                    <option value="waste">Waste (−)</option>
                    <option value="adjustment">Adjustment (−)</option>
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Quantity ({stockModal.unit_of_measure})</label><input className="form-input" type="number" step="0.001" min="0" value={stockForm.change_qty} onChange={e => setStockForm(f => ({ ...f, change_qty: e.target.value }))} /></div>
              </div>
              <div className="form-group"><label className="form-label">Note</label><input className="form-input" value={stockForm.note} onChange={e => setStockForm(f => ({ ...f, note: e.target.value }))} placeholder="optional" /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setStockModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitStockAdjust}>Save</button>
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
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  function showToast(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); }

  function loadPos() {
    api.get('/api/purchasing/purchase-orders', { params: statusFilter ? { status: statusFilter } : {} })
      .then(r => setPos(r.data)).catch(() => {});
  }
  useEffect(() => { loadPos(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/api/purchasing/suppliers').then(r => setSuppliers(r.data.filter(s => s.is_active))).catch(() => {});
    api.get('/api/purchasing/raw-materials').then(r => setMaterials(r.data.filter(m => m.is_active))).catch(() => {});
    api.get('/api/products').then(r => setProducts(r.data)).catch(() => setProducts([])); // sales module may be off
  }, []);

  function openDetail(po) {
    api.get(`/api/purchasing/purchase-orders/${po.id}`).then(r => setDetail(r.data)).catch(() => showToast('Failed to load purchase order', 'error'));
  }
  function refreshDetail(id) {
    api.get(`/api/purchasing/purchase-orders/${id}`).then(r => setDetail(r.data)).catch(() => {});
  }

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
                  <td>{po.supplier_name}</td>
                  <td>{fmtIDR(po.total_amount)}</td>
                  <td>{fmtDate(po.created_at)}</td>
                  <td><span className={`badge badge-${PO_STATUS_BADGE[po.status]}`} style={{ fontSize: 13, padding: '5px 14px' }}>{PO_STATUS_LABELS[po.status]}</span></td>
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

      {detail && (
        <PODetailModal
          po={detail}
          onClose={() => setDetail(null)}
          onStatus={status => setStatus(detail, status)}
          onReceived={() => { showToast('Received'); loadPos(); refreshDetail(detail.id); }}
          onError={m => showToast(m, 'error')}
        />
      )}
    </div>
  );
}

function NewPOModal({ suppliers, products, materials, onClose, onCreated, onError }) {
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ kind: 'product', product_id: '', raw_material_id: '', quantity: '', unit_cost: '' }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function updateLine(i, patch) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function addLine() { setLines(ls => [...ls, { kind: 'product', product_id: '', raw_material_id: '', quantity: '', unit_cost: '' }]); }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)); }

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0), 0);

  async function submit() {
    setFormError('');
    if (!supplierId) { setFormError('Pick a supplier'); return; }
    const items = [];
    for (const l of lines) {
      const qty = parseFloat(l.quantity);
      const cost = parseFloat(l.unit_cost);
      if (!qty || qty <= 0) { setFormError('Every line needs a positive quantity'); return; }
      if (!Number.isFinite(cost) || cost < 0) { setFormError('Every line needs a unit cost'); return; }
      if (l.kind === 'product') {
        if (!l.product_id) { setFormError('Pick a product for every product line'); return; }
        items.push({ product_id: l.product_id, quantity: qty, unit_cost: cost });
      } else {
        if (!l.raw_material_id) { setFormError('Pick a raw material for every ingredient line'); return; }
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
      <div className="modal" style={{ maxWidth: 640 }}>
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

          <div className="form-label" style={{ marginTop: 8 }}>Line items</div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <select className="form-select" style={{ width: 110 }} value={l.kind} onChange={e => updateLine(i, { kind: e.target.value, product_id: '', raw_material_id: '' })}>
                  <option value="product">Product</option>
                  <option value="material">Ingredient</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0, flex: 2, minWidth: 140 }}>
                {l.kind === 'product' ? (
                  <select className="form-select" value={l.product_id} onChange={e => updateLine(i, { product_id: e.target.value })}>
                    <option value="">Select product…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : (
                  <select className="form-select" value={l.raw_material_id} onChange={e => updateLine(i, { raw_material_id: e.target.value })}>
                    <option value="">Select ingredient…</option>
                    {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit_of_measure})</option>)}
                  </select>
                )}
              </div>
              <input className="form-input" style={{ width: 90 }} type="number" step={l.kind === 'material' ? '0.001' : '1'} placeholder="Qty" value={l.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} />
              <input className="form-input" style={{ width: 130 }} type="number" placeholder="Unit cost" value={l.unit_cost} onChange={e => updateLine(i, { unit_cost: e.target.value })} />
              {lines.length > 1 && <button className="btn btn-sm btn-secondary" onClick={() => removeLine(i)}>✕</button>}
            </div>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={addLine}>+ Add Line</button>

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

function PODetailModal({ po, onClose, onStatus, onReceived, onError }) {
  const [receiveOpen, setReceiveOpen] = useState(false);

  const transitions = {
    draft: [['pending_approval', 'Submit for Approval'], ['cancelled', 'Cancel']],
    pending_approval: [['approved', 'Approve'], ['draft', 'Back to Draft'], ['cancelled', 'Cancel']],
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
                  <td style={{ padding: '6px 4px' }}>{it.description}{it.raw_material_id ? ` (${it.unit_of_measure})` : ''}</td>
                  <td style={{ textAlign: 'right', padding: '6px 4px' }}>{it.quantity}</td>
                  <td style={{ textAlign: 'right', padding: '6px 4px', color: Number(it.received_quantity) >= Number(it.quantity) ? '#16A34A' : '#6B7280' }}>{it.received_quantity}</td>
                  <td style={{ textAlign: 'right', padding: '6px 4px' }}>{fmtIDR(it.unit_cost)}</td>
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
          {transitions.map(([status, label]) => (
            <button key={status} className={`btn btn-sm ${status === 'cancelled' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => onStatus(status)}>{label}</button>
          ))}
          {po.status === 'approved' && <button className="btn btn-sm btn-primary" onClick={() => setReceiveOpen(true)}>Receive Items</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>

      {receiveOpen && (
        <ReceiveModal po={po} onClose={() => setReceiveOpen(false)} onDone={() => { setReceiveOpen(false); onReceived(); }} onError={onError} />
      )}
    </div>
  );
}

function ReceiveModal({ po, onClose, onDone, onError }) {
  const outstanding = po.items.filter(it => Number(it.received_quantity) < Number(it.quantity));
  const [amounts, setAmounts] = useState(() => Object.fromEntries(outstanding.map(it => [it.id, String(Number(it.quantity) - Number(it.received_quantity))])));
  const [saving, setSaving] = useState(false);

  async function submit() {
    const items = Object.entries(amounts)
      .map(([item_id, v]) => ({ item_id, receive_quantity: parseFloat(v) }))
      .filter(i => i.receive_quantity > 0);
    if (items.length === 0) { onError('Enter a quantity to receive for at least one item'); return; }
    setSaving(true);
    try {
      await api.post(`/api/purchasing/purchase-orders/${po.id}/receive`, { items });
      onDone();
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
                <div className="text-muted" style={{ fontSize: 11 }}>outstanding {Number(it.quantity) - Number(it.received_quantity)}{it.raw_material_id ? ` ${it.unit_of_measure}` : ''}</div>
              </div>
              <input
                className="form-input" style={{ width: 100 }} type="number" step={it.raw_material_id ? '0.001' : '1'} min="0"
                value={amounts[it.id] || ''} onChange={e => setAmounts(a => ({ ...a, [it.id]: e.target.value }))}
              />
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

function ExpensesTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [category, setCategory] = useState('');
  const [expenses, setExpenses] = useState([]);
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
    api.get('/api/expenses', { params }).then(r => setExpenses(r.data)).catch(() => {});
  }
  useEffect(() => { load(); }, [month, year, category]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/api/purchasing/suppliers').then(r => setSuppliers(r.data.filter(s => s.is_active))).catch(() => {});
    api.get('/api/settings/payment-methods').then(r => setPaymentMethods(r.data.filter(m => m.is_active))).catch(() => setPaymentMethods([]));
  }, []);

  function openAdd() { setForm({ ...EMPTY_EXPENSE, incurred_on: new Date().toISOString().slice(0, 10) }); setError(''); setModal(true); }

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

  async function voidExpense(e) {
    if (!confirm('Void this expense? It stays on record but is removed from totals.')) return;
    await api.delete(`/api/expenses/${e.id}`);
    load();
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  function exportUrl() {
    const params = new URLSearchParams({ month, year });
    if (category) params.set('category', category);
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
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => downloadCsv(exportUrl(), `expenses-${year}-${String(month).padStart(2, '0')}.csv`)}>⬇ Export CSV</button>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Expense</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12, padding: 14 }}>
        <div className="stat-label">Total — {MONTHS[month - 1]} {year}{category ? ` · ${EXPENSE_CATEGORY_LABELS[category]}` : ''}</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtIDR(total)}</div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Paid Via</th><th>Supplier</th><th>Reference</th><th></th></tr></thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id}>
                  <td>{fmtDate(e.incurred_on)}</td>
                  <td><span className={`badge badge-${EXPENSE_CATEGORY_COLORS[e.category]}`}>{EXPENSE_CATEGORY_LABELS[e.category]}</span></td>
                  <td style={{ fontWeight: 600 }}>{fmtIDR(e.amount)}</td>
                  <td>{e.payment_method || <span className="text-muted">—</span>}</td>
                  <td>{e.supplier_name || <span className="text-muted">—</span>}</td>
                  <td>{e.reference || <span className="text-muted">—</span>}</td>
                  <td><button className="btn btn-sm btn-secondary" onClick={() => voidExpense(e)}>Void</button></td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No expenses recorded for this period</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

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
                  <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
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
                <select className="form-select" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
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

// ───────────────────────────── Inventory Value ─────────────────────────────

function InventoryValueTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/api/purchasing/inventory-value').then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="stat-label">Total Inventory Value (at cost)</div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{fmtIDR(data.grand_total)}</div>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          Raw Materials {fmtIDR(data.raw_materials_total)} · Products {fmtIDR(data.products_total)}
        </div>
        {data.uncosted_count > 0 && (
          <div style={{ fontSize: 12, color: '#D97706', marginTop: 8 }}>
            ⚠ {data.uncosted_count} item{data.uncosted_count !== 1 ? 's have' : ' has'} stock but no recorded cost yet (never received through a Purchase Order) — excluded from the total above, so this figure is a floor, not the complete picture.
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Raw Materials</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Stock</th><th>Cost / unit</th><th>Value</th></tr></thead>
            <tbody>
              {data.raw_materials.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m.stock_quantity} {m.unit_of_measure}</td>
                  <td>{m.cost_per_unit != null ? fmtIDR(m.cost_per_unit) : <span className="text-muted">No cost recorded yet</span>}</td>
                  <td style={{ fontWeight: 600 }}>{m.value != null ? fmtIDR(m.value) : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
              {data.raw_materials.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No raw materials yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Products</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Stock</th><th>Cost / unit</th><th>Value</th></tr></thead>
            <tbody>
              {data.products.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.stock_quantity}</td>
                  <td>{p.cost_per_unit != null ? fmtIDR(p.cost_per_unit) : <span className="text-muted">No cost recorded yet</span>}</td>
                  <td style={{ fontWeight: 600 }}>{p.value != null ? fmtIDR(p.value) : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
              {data.products.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No stock-tracked products yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
