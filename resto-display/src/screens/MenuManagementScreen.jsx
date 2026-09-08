import { useState, useEffect, useMemo } from 'react';
import api from '../api';

const CATEGORIES = ['drinks', 'food', 'merchandise', 'tour', 'other'];
const EMPTY_FORM = { name: '', category: 'food', price: '', description: '', is_available: true, track_stock: false, stock_quantity: '', low_stock_threshold: '' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// Menu/product management, moved into the resto domain — reuses the same
// /api/products endpoints the PMS Sales page's Products tab already calls.
// Mutations are gated server-side by requireOwnerOrMenu('resto_menu')
// (server/middleware/requireOwnerOrMenu.js), not just owner — a resto
// manager role with the resto_menu permission can use this screen without
// needing the property's actual owner login.
export default function MenuManagementScreen() {
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | 'add' | product row (edit)
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/products');
    setProducts(data);
  }
  useEffect(() => { load(); }, []);

  function openAdd() { setForm(EMPTY_FORM); setError(''); setModal('add'); }
  function openEdit(p) {
    setForm({
      name: p.name, category: p.category, price: p.price, description: p.description || '',
      is_available: p.is_available, track_stock: p.track_stock,
      stock_quantity: p.stock_quantity ?? '', low_stock_threshold: p.low_stock_threshold ?? '',
    });
    setError('');
    setModal(p);
  }

  async function save() {
    if (!form.name || form.price === '') { setError('Name and price are required'); return; }
    const payload = {
      name: form.name, category: form.category, price: parseFloat(form.price), description: form.description || null,
      is_available: form.is_available, track_stock: form.track_stock,
      low_stock_threshold: form.low_stock_threshold === '' ? null : parseInt(form.low_stock_threshold),
    };
    try {
      if (modal === 'add') {
        await api.post('/products', { ...payload, stock_quantity: form.stock_quantity === '' ? 0 : parseInt(form.stock_quantity) });
      } else {
        await api.put(`/products/${modal.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this item.');
    }
  }

  async function toggleAvailable(p) {
    await api.put(`/products/${p.id}`, { is_available: !p.is_available });
    load();
  }

  const filtered = useMemo(() => products
    .filter(p => filter === 'all' || p.category === filter)
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase())),
    [products, filter, search]);

  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <h1 className="text-xl font-light text-ink">Menu</h1>
        <button onClick={openAdd} className="rounded-lg bg-accent text-[color:var(--accent-contrast)] text-xs font-bold px-3.5 py-2">
          + Add Item
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-2 overflow-x-auto">
          {['all', ...CATEGORIES].map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={
                'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ' +
                (filter === cat ? 'bg-accent text-[color:var(--accent-contrast)]' : 'bg-surface text-muted')
              }
            >
              {cat}
            </button>
          ))}
        </div>
        <input
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-surface border border-app rounded-lg px-3 py-1.5 text-sm text-ink outline-none ml-auto min-w-[160px]"
        />
      </div>

      <div className="rounded-2xl border border-app bg-surface overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 border-b border-app-soft text-[11px] font-bold uppercase tracking-wider text-dim">
          <span>Item</span>
          <span className="text-right">Price</span>
          <span>Stock</span>
          <span></span>
        </div>
        {filtered.map(p => (
          <div key={p.id} className={'grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 items-center border-b border-app-soft last:border-b-0' + (p.is_available ? '' : ' opacity-50')}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{p.name}</div>
              <div className="text-xs text-dim capitalize">{p.category}</div>
            </div>
            <div className="text-sm text-accent font-bold text-right whitespace-nowrap">{fmtIDR(p.price)}</div>
            <div className="text-xs text-dim whitespace-nowrap">
              {p.track_stock ? (
                p.stock_quantity <= 0 ? <span className="text-danger">Out of stock</span>
                : (p.low_stock_threshold != null && p.stock_quantity <= p.low_stock_threshold) ? <span className="text-warn">Low: {p.stock_quantity}</span>
                : `${p.stock_quantity} in stock`
              ) : '—'}
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggleAvailable(p)} className="rounded-lg bg-surface-2 border border-app text-ink text-[11px] font-bold px-2.5 py-1.5 whitespace-nowrap">
                {p.is_available ? 'Hide' : 'Show'}
              </button>
              <button onClick={() => openEdit(p)} className="rounded-lg bg-surface-2 border border-app text-ink text-[11px] font-bold px-2.5 py-1.5">
                Edit
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-dim text-sm p-4">No menu items match.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-5" onClick={() => setModal(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-surface border border-app rounded-2xl p-6 w-[360px] max-h-[85vh] overflow-y-auto flex flex-col gap-3 shadow-card">
            <h3 className="text-base font-bold text-ink">{modal === 'add' ? 'Add Item' : 'Edit Item'}</h3>

            <input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none" />

            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none">
              {CATEGORIES.map(c => <option key={c} value={c} style={{ color: '#000' }}>{c}</option>)}
            </select>

            <input type="number" placeholder="Price" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none" />

            <textarea placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none min-h-[60px] resize-y" />

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={form.is_available} onChange={e => setForm(f => ({ ...f, is_available: e.target.checked }))} />
              Available for ordering
            </label>

            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={form.track_stock} onChange={e => setForm(f => ({ ...f, track_stock: e.target.checked }))} />
              Track stock
            </label>

            {form.track_stock && (
              <>
                {modal === 'add' && (
                  <input type="number" placeholder="Starting stock quantity" value={form.stock_quantity} onChange={e => setForm(f => ({ ...f, stock_quantity: e.target.value }))} className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none" />
                )}
                <input type="number" placeholder="Low stock threshold (optional)" value={form.low_stock_threshold} onChange={e => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))} className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none" />
              </>
            )}

            {error && <p className="text-danger text-xs">{error}</p>}

            <div className="flex gap-2 mt-1">
              <button onClick={save} className="flex-1 rounded-lg bg-accent text-[color:var(--accent-contrast)] text-sm font-bold py-3">
                Save
              </button>
              <button onClick={() => setModal(null)} className="flex-1 rounded-lg border border-app text-dim text-sm font-bold py-3">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
