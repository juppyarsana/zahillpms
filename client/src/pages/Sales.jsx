import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

// Hotel extras sold from the front desk (migration 067). F&B ('food'/'drinks')
// lives in the resto app / external POS and is deliberately hidden here;
// scheduled experiences (tours, yoga, trekking) live in Activities.
const CATEGORIES = [
  { key: 'room_addon',  icon: '🛏', label: 'Room Add-ons', hint: 'Extra bed, early check-in, late checkout' },
  { key: 'transport',   icon: '🚙', label: 'Transport',    hint: 'Airport transfer, scooter/car rental' },
  { key: 'laundry',     icon: '🧺', label: 'Laundry',      hint: 'Per piece or per bag' },
  { key: 'service',     icon: '🛎', label: 'Services',     hint: 'Decoration, BBQ setup, private dinner setup' },
  { key: 'merchandise', icon: '👕', label: 'Merchandise',  hint: 'Souvenirs, toiletries' },
  { key: 'other',       icon: '📦', label: 'Other',        hint: '' },
];
const CAT_BY_KEY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
const EMPTY_PRODUCT_FORM = { name: '', category: 'room_addon', price: '', description: '', is_available: true, track_stock: false, stock_quantity: '', low_stock_threshold: '' };
// Not something front desk takes at the till.
const HIDDEN_PAY_METHODS = ['ota_managed'];

const TABS = [
  { key: 'sell',    icon: '🛍', label: 'Sell' },
  { key: 'history', icon: '🧾', label: 'History' },
  { key: 'items',   icon: '🏷', label: 'Items' },
];

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const MOVEMENT_REASONS = {
  sale:       { label: 'Sale',       cls: 'badge-gray' },
  restock:    { label: 'Restock',    cls: 'badge-green' },
  adjustment: { label: 'Adjustment', cls: 'badge-amber' },
  waste:      { label: 'Waste',      cls: 'badge-red' },
};

function stockBadge(p) {
  if (!p.track_stock) return null;
  if (p.stock_quantity <= 0) return <span className="badge badge-red">Out of stock</span>;
  if (p.low_stock_threshold != null && p.stock_quantity <= p.low_stock_threshold) return <span className="badge badge-amber">Low: {p.stock_quantity}</span>;
  return <span className="badge badge-gray">{p.stock_quantity} in stock</span>;
}

export default function Sales() {
  const { user } = useAuth();
  const { paymentMethods, branding } = useSettings();
  // Same rule the server enforces on /api/products writes (requireOwnerOrMenu).
  const canManageItems = user?.role === 'owner' || (user?.allowed_menus || []).includes('resto_menu');

  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [tab, setTab] = useState('sell');
  const [cart, setCart] = useState([]);
  const [bookingSearch, setBookingSearch] = useState('');
  const [inHouse, setInHouse] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [payMethod, setPayMethod] = useState('');
  // 'room' = post to the guest's folio; 'pay' = guest pays now (sale still
  // linked to their booking for reference, but not on the folio).
  const [billing, setBilling] = useState('room');
  const [lastSale, setLastSale] = useState(null); // { id, paidDirectly } — success panel after a sale
  const [orderError, setOrderError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [productModal, setProductModal] = useState(null); // { mode: 'add'|'edit', id? }
  const [prodForm, setProdForm] = useState(EMPTY_PRODUCT_FORM);
  const [stockModal, setStockModal] = useState(null); // product row
  const [stockForm, setStockForm] = useState({ change_qty: '', reason: 'restock', note: '' });
  const [historyModal, setHistoryModal] = useState(null); // { product, rows, loading, error }

  async function loadProducts() { const r = await api.get('/api/products'); setProducts(r.data.filter(p => CAT_BY_KEY[p.category])); }
  async function loadSales() { const r = await api.get('/api/sales?scope=extras'); setSales(r.data); }
  async function loadInHouse() { const r = await api.get('/api/bookings?status=checked_in'); setInHouse(r.data); }
  useEffect(() => { loadProducts(); loadSales(); loadInHouse(); }, []);

  const tillMethods = paymentMethods.filter(m => m.is_active !== false && !HIDDEN_PAY_METHODS.includes(m.id));
  useEffect(() => {
    if (!payMethod && tillMethods.length) setPayMethod(tillMethods.find(m => m.id === 'cash')?.id || tillMethods[0].id);
  }, [tillMethods.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = bookingSearch.trim().toLowerCase();
  const bookingMatches = q.length >= 1 && !selectedBooking
    ? inHouse.filter(b => b.guest_name?.toLowerCase().includes(q) || b.unit_name?.toLowerCase().includes(q)).slice(0, 8)
    : [];

  const availableProducts = products.filter(p => p.is_available);

  function addToCart(product) {
    setLastSale(null);
    if (product.track_stock && product.stock_quantity <= 0) return;
    setCart(c => {
      const ex = c.find(i => i.product_id === product.id);
      if (ex) return c.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { product_id: product.id, name: product.name, unit_price: product.price, quantity: 1 }];
    });
  }

  function removeFromCart(id) { setCart(c => c.filter(i => i.product_id !== id)); }
  function setQty(id, qty) {
    if (qty === '') { setCart(c => c.map(i => i.product_id === id ? { ...i, quantity: '' } : i)); return; }
    const n = parseInt(qty);
    if (!Number.isFinite(n)) return;
    if (n < 1) { removeFromCart(id); return; }
    setCart(c => c.map(i => i.product_id === id ? { ...i, quantity: n } : i));
  }

  const cartValid = cart.length > 0 && cart.every(i => Number.isInteger(i.quantity) && i.quantity >= 1);
  const cartTotal = cart.reduce((sum, i) => sum + i.unit_price * (parseInt(i.quantity) || 0), 0);
  // Prices are before tax. Paid directly, the guest pays service charge + tax
  // on top (same formula as the folio: service on the subtotal, tax on
  // subtotal + service). The server computes the real amounts; this is the
  // preview. Charged to room, the folio adds them at checkout instead.
  const scRate = parseFloat(branding?.service_charge_rate || 0);
  const taxRate = parseFloat(branding?.tax_rate || 0);
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const cartSc = round2(cartTotal * scRate / 100);
  const cartTax = round2((cartTotal + cartSc) * taxRate / 100);
  const cartGross = round2(cartTotal + cartSc + cartTax);

  function pickBooking(b) { setSelectedBooking(b); setBookingSearch(''); setBilling('room'); }
  function clearBooking() { setSelectedBooking(null); setBookingSearch(''); setBilling('room'); }

  const chargeToRoom = !!selectedBooking && billing === 'room';

  // Opens the PDF in a new tab so it can be printed straight away; falls back
  // to a download if the browser blocks the new tab.
  async function openReceipt(saleId) {
    try {
      const r = await api.get(`/api/sales/${saleId}/receipt`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      if (!window.open(url, '_blank')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `sales-receipt-${String(saleId).slice(0, 8)}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      alert('Could not open the receipt');
    }
  }

  async function submitOrder() {
    if (!cartValid || submitting) return;
    if (!chargeToRoom && !payMethod) { setOrderError('Choose a payment method'); return; }
    setOrderError('');
    setSubmitting(true);
    try {
      const { data: sale } = await api.post('/api/sales', {
        booking_id: selectedBooking?.id || null,
        payment_method: chargeToRoom ? 'room_charge' : payMethod,
        items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
      });
      setLastSale({ id: sale.id, paidDirectly: !chargeToRoom });
      setCart([]);
      clearBooking();
      loadSales();
      loadProducts();
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'OUT_OF_STOCK') {
        setOrderError(`Out of stock: ${data.items.map(i => `${i.name} (have ${i.available}, need ${i.requested})`).join(', ')}`);
        loadProducts();
      } else {
        setOrderError(data?.error || 'Could not record the sale');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openAddProduct() { setProdForm(EMPTY_PRODUCT_FORM); setProductModal({ mode: 'add' }); }
  function openEditProduct(p) {
    setProdForm({
      name: p.name, category: p.category, price: p.price, description: p.description || '', is_available: p.is_available,
      track_stock: p.track_stock, stock_quantity: p.stock_quantity, low_stock_threshold: p.low_stock_threshold ?? '',
    });
    setProductModal({ mode: 'edit', id: p.id });
  }

  async function saveProduct() {
    if (!prodForm.name || !prodForm.price) return;
    const payload = {
      name: prodForm.name, category: prodForm.category, price: prodForm.price, description: prodForm.description, is_available: prodForm.is_available,
      track_stock: prodForm.track_stock, low_stock_threshold: prodForm.low_stock_threshold === '' ? null : parseInt(prodForm.low_stock_threshold),
    };
    try {
      if (productModal.mode === 'add') {
        await api.post('/api/products', { ...payload, stock_quantity: prodForm.stock_quantity === '' ? 0 : parseInt(prodForm.stock_quantity) });
      } else {
        await api.put(`/api/products/${productModal.id}`, payload);
      }
      setProductModal(null);
      loadProducts();
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save item');
    }
  }

  function openStockModal(p) { setStockForm({ change_qty: '', reason: 'restock', note: '' }); setStockModal(p); }
  async function submitStockAdjust() {
    const qty = parseInt(stockForm.change_qty);
    if (!qty) return;
    const signedQty = stockForm.reason === 'restock' ? Math.abs(qty) : -Math.abs(qty);
    try {
      await api.patch(`/api/products/${stockModal.id}/stock`, { change_qty: signedQty, reason: stockForm.reason, note: stockForm.note || null });
      setStockModal(null);
      loadProducts();
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not adjust stock');
    }
  }

  async function openStockHistory(p) {
    setHistoryModal({ product: p, rows: [], loading: true, error: '' });
    try {
      const r = await api.get(`/api/products/${p.id}/stock/movements`);
      // Newest first. Work the balance backwards from the current count so
      // each row shows what stock was left right after that change.
      let balance = p.stock_quantity;
      const rows = r.data.map(m => {
        const row = { ...m, balance_after: balance };
        balance -= m.change_qty;
        return row;
      });
      setHistoryModal({ product: p, rows, loading: false, error: '' });
    } catch (err) {
      setHistoryModal({ product: p, rows: [], loading: false, error: err?.response?.data?.error || 'Could not load stock history' });
    }
  }

  const grouped = CATEGORIES
    .map(c => ({ ...c, items: availableProducts.filter(p => p.category === c.key) }))
    .filter(c => c.items.length > 0);

  const methodLabel = id => id === 'room_charge' ? 'Room charge'
    : id === 'unpaid' ? 'Open tab'
    : (paymentMethods.find(m => m.id === id)?.label || id);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Ancillary Sales</div>
          <div className="page-subtitle">Hotel extras: extra bed, transfers, laundry and more. Tours and classes are booked in Activities.</div>
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.key} className={`tab-bar-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tab === 'sell' && (
        <div className="grid-2" style={{ gap: 16 }}>
          <div>
            {grouped.map(cat => (
              <div key={cat.key} className="card mb-3">
                <div className="card-title">{cat.icon} {cat.label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: 8 }}>
                  {cat.items.map(p => {
                    const outOfStock = p.track_stock && p.stock_quantity <= 0;
                    return (
                      <button key={p.id} className="btn btn-secondary" disabled={outOfStock}
                        style={{ flexDirection: 'column', height: 72, fontSize: 12, opacity: outOfStock ? 0.5 : 1 }}
                        onClick={() => addToCart(p)}>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        <span style={{ color: 'var(--green)', fontSize: 11 }}>{fmtIDR(p.price)}</span>
                        {outOfStock && <span style={{ fontSize: 10, color: 'var(--danger-text)' }}>Out of stock</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {availableProducts.length === 0 && (
              <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
                No items yet. {canManageItems ? 'Add extras like "Extra Bed" or "Airport Transfer" in the Items tab.' : 'Ask the owner to add items.'}
              </div>
            )}
          </div>

          <div className="card" style={{ alignSelf: 'flex-start', position: 'sticky', top: 16 }}>
            <div className="card-title">Sale</div>

            <div className="form-group">
              <label className="form-label">In-house guest (optional)</label>
              {selectedBooking ? (
                <>
                  <div className="alert alert-success flex-between" style={{ marginBottom: 8 }}>
                    <span><b>{selectedBooking.guest_name}</b> · {selectedBooking.unit_name}</span>
                    <button className="btn btn-sm btn-secondary" onClick={clearBooking}>Change</button>
                  </div>
                  <div className="flex gap-2">
                    <button className={`btn btn-sm ${billing === 'room' ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => setBilling('room')}>💳 Charge to room</button>
                    <button className={`btn btn-sm ${billing === 'pay' ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => setBilling('pay')}>💵 Pay now</button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {billing === 'room' ? "Added to the guest's folio, settled at checkout." : "Guest pays now. Shown on their folio as charged and paid, so nothing is owed at checkout."}
                  </div>
                </>
              ) : (
                <>
                  <input className="form-input" placeholder="Search in-house guest or room…" value={bookingSearch}
                    onChange={e => setBookingSearch(e.target.value)} />
                  {bookingMatches.length > 0 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4 }}>
                      {bookingMatches.map(b => (
                        <div key={b.id} onClick={() => pickBooking(b)} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                          <div style={{ fontWeight: 600 }}>{b.guest_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.unit_name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {q.length >= 1 && bookingMatches.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>No checked-in guest matches.</div>
                  )}
                </>
              )}
            </div>

            {!chargeToRoom && (
              <div className="form-group">
                <label className="form-label">Payment Method</label>
                <select className="form-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  {tillMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            )}

            <div className="divider" />

            {orderError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{orderError}</div>}

            {lastSale && cart.length === 0 ? (
              <div className="alert alert-success flex-between" style={{ gap: 8 }}>
                <span>{lastSale.paidDirectly ? 'Sale recorded ✓' : 'Charged to room ✓'}</span>
                {lastSale.paidDirectly && (
                  <button className="btn btn-sm btn-secondary" onClick={() => openReceipt(lastSale.id)}>🖨 Print receipt</button>
                )}
              </div>
            ) : cart.length === 0 ? (
              <p className="text-muted" style={{ textAlign: 'center', padding: 16 }}>Tap an item to add it</p>
            ) : (
              <>
                {cart.map(i => (
                  <div key={i.product_id} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{i.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtIDR(i.unit_price)} × {i.quantity || 0} = {fmtIDR(i.unit_price * (parseInt(i.quantity) || 0))}</div>
                    </div>
                    <div className="flex gap-2 flex-center">
                      <button className="btn btn-icon" style={{ fontSize: 12 }} onClick={() => setQty(i.product_id, (parseInt(i.quantity) || 1) - 1)}>−</button>
                      <input className="form-input" type="number" min="1" inputMode="numeric" value={i.quantity}
                        onChange={e => setQty(i.product_id, e.target.value)}
                        style={{ width: 56, textAlign: 'center', padding: '4px 6px' }} aria-label={`Quantity of ${i.name}`} />
                      <button className="btn btn-icon" style={{ fontSize: 12 }} onClick={() => setQty(i.product_id, (parseInt(i.quantity) || 0) + 1)}>+</button>
                      <button className="btn btn-icon" style={{ fontSize: 12 }} onClick={() => removeFromCart(i.product_id)} title="Remove">✕</button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  Per-night items (e.g. extra bed): enter the number of nights as the quantity.
                </div>
                {chargeToRoom ? (
                  <>
                    <div className="flex-between" style={{ fontWeight: 700, fontSize: 16, marginTop: 12 }}>
                      <span>Total</span><span>{fmtIDR(cartTotal)}</span>
                    </div>
                    {(scRate > 0 || taxRate > 0) && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                        Before tax. {scRate > 0 ? `Service ${scRate}% and tax` : 'Tax'}{taxRate > 0 ? ` ${taxRate}%` : ''} are added on the folio at checkout.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ marginTop: 12, marginBottom: 8 }}>
                    {(cartSc > 0 || cartTax > 0) && (
                      <>
                        <div className="flex-between" style={{ fontSize: 13 }}><span>Subtotal</span><span>{fmtIDR(cartTotal)}</span></div>
                        {cartSc > 0 && <div className="flex-between" style={{ fontSize: 13 }}><span>Service Charge ({scRate}%)</span><span>{fmtIDR(cartSc)}</span></div>}
                        {cartTax > 0 && <div className="flex-between" style={{ fontSize: 13 }}><span>Tax ({taxRate}%)</span><span>{fmtIDR(cartTax)}</span></div>}
                      </>
                    )}
                    <div className="flex-between" style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
                      <span>Total to collect</span><span>{fmtIDR(cartGross)}</span>
                    </div>
                    {selectedBooking && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Also recorded on the guest's folio as paid.</div>
                    )}
                  </div>
                )}
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                  disabled={!cartValid || submitting} onClick={submitOrder}>
                  {submitting ? 'Saving…' : chargeToRoom ? '💳 Charge to Room' : '✓ Complete Sale'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Items</th><th>Guest / Room</th><th>Method</th><th>Total</th><th>Served By</th><th></th></tr></thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(s.created_at)}</td>
                    <td>{s.items_summary || '—'}</td>
                    <td>{s.guest_name ? <>{s.guest_name}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.unit_name}</div></> : <span className="text-muted">Walk-in</span>}</td>
                    <td><span className={'badge ' + (s.payment_method === 'unpaid' ? 'badge-amber' : 'badge-gray')}>{methodLabel(s.payment_method)}</span></td>
                    <td>{fmtIDR(parseFloat(s.total_amount) + parseFloat(s.service_charge_amount || 0) + parseFloat(s.tax_amount || 0))}</td>
                    <td>{s.served_by_name || '—'}</td>
                    <td>
                      {s.payment_method !== 'room_charge' && s.payment_method !== 'unpaid' && (
                        <button className="btn btn-sm btn-secondary" onClick={() => openReceipt(s.id)} title="Paid directly — print a receipt">🖨 Receipt</button>
                      )}
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>No sales yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'items' && (
        <div>
          {canManageItems && (
            <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={openAddProduct}>+ Add Item</button>
            </div>
          )}
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Available</th><th>Stock</th>{canManageItems && <th></th>}</tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{CAT_BY_KEY[p.category]?.icon} {CAT_BY_KEY[p.category]?.label}</td>
                      <td>{fmtIDR(p.price)}</td>
                      <td><span className={`badge badge-${p.is_available?'green':'gray'}`}>{p.is_available?'Yes':'No'}</span></td>
                      <td>{stockBadge(p) || <span className="text-muted" style={{ fontSize: 12 }}>Not tracked</span>}</td>
                      {canManageItems && (
                        <td>
                          <div className="flex gap-2">
                            <button className="btn btn-sm btn-secondary" onClick={() => openEditProduct(p)}>Edit</button>
                            {p.track_stock && <button className="btn btn-sm btn-secondary" onClick={() => openStockModal(p)}>Adjust Stock</button>}
                            {p.track_stock && <button className="btn btn-sm btn-secondary" onClick={() => openStockHistory(p)}>History</button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {products.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>No items yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {productModal && (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-header">
                  <div className="modal-title">{productModal.mode === 'add' ? 'Add Item' : 'Edit Item'}</div>
                  <button className="btn btn-icon" onClick={() => setProductModal(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={prodForm.name} onChange={e=>setProdForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Extra Bed (per night)" /></div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Category</label>
                      <select className="form-select" value={prodForm.category} onChange={e=>setProdForm(f=>({...f,category:e.target.value}))}>
                        {CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                      </select>
                      {CAT_BY_KEY[prodForm.category]?.hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{CAT_BY_KEY[prodForm.category].hint}</div>}
                    </div>
                    <div className="form-group"><label className="form-label">Price (IDR) *</label><input className="form-input" type="number" value={prodForm.price} onChange={e=>setProdForm(f=>({...f,price:e.target.value}))} /></div>
                  </div>
                  <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={prodForm.description} onChange={e=>setProdForm(f=>({...f,description:e.target.value}))} /></div>
                  {productModal.mode === 'edit' && (
                    <div className="form-group">
                      <label className="form-label flex gap-2 flex-center" style={{ cursor: 'pointer' }}>
                        <input type="checkbox" checked={prodForm.is_available} onChange={e=>setProdForm(f=>({...f,is_available:e.target.checked}))} />
                        Available for sale
                      </label>
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label flex gap-2 flex-center" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={prodForm.track_stock} onChange={e=>setProdForm(f=>({...f,track_stock:e.target.checked}))} />
                      Track stock for this item
                    </label>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>For physical goods like merchandise. Leave off for services.</div>
                  </div>
                  {prodForm.track_stock && (
                    <div className="form-row">
                      {productModal.mode === 'add' && (
                        <div className="form-group"><label className="form-label">Starting Quantity</label><input className="form-input" type="number" value={prodForm.stock_quantity} onChange={e=>setProdForm(f=>({...f,stock_quantity:e.target.value}))} /></div>
                      )}
                      <div className="form-group"><label className="form-label">Low Stock Alert Below</label><input className="form-input" type="number" value={prodForm.low_stock_threshold} onChange={e=>setProdForm(f=>({...f,low_stock_threshold:e.target.value}))} placeholder="e.g. 5" /></div>
                    </div>
                  )}
                  {productModal.mode === 'edit' && prodForm.track_stock && (
                    <div className="text-muted" style={{ fontSize: 12 }}>Current stock: {prodForm.stock_quantity}. Use "Adjust Stock" from the item list to change quantity.</div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setProductModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveProduct}>{productModal.mode === 'add' ? 'Add Item' : 'Save Changes'}</button>
                </div>
              </div>
            </div>
          )}

          {historyModal && (
            <div className="modal-backdrop">
              <div className="modal" style={{ maxWidth: 720, width: '100%' }}>
                <div className="modal-header">
                  <div className="modal-title">Stock History — {historyModal.product.name}</div>
                  <button className="btn btn-icon" onClick={() => setHistoryModal(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
                    Current stock: <b>{historyModal.product.stock_quantity}</b> · showing the latest 50 changes
                  </div>
                  {historyModal.error && <div className="alert alert-error">{historyModal.error}</div>}
                  {historyModal.loading ? (
                    <p className="text-muted" style={{ textAlign: 'center', padding: 16 }}>Loading…</p>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Date</th><th>Reason</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Stock after</th><th>Note</th><th>By</th></tr></thead>
                        <tbody>
                          {historyModal.rows.map(m => {
                            const r = MOVEMENT_REASONS[m.reason] || { label: m.reason, cls: 'badge-gray' };
                            const note = [m.po_number && `PO ${m.po_number}`, m.note].filter(Boolean).join(' · ');
                            return (
                              <tr key={m.id}>
                                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.created_at)}</td>
                                <td><span className={`badge ${r.cls}`}>{r.label}</span></td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: m.change_qty > 0 ? 'var(--green)' : 'var(--danger-text)' }}>
                                  {m.change_qty > 0 ? '+' : ''}{m.change_qty}
                                </td>
                                <td style={{ textAlign: 'right' }}>{m.balance_after}</td>
                                <td style={{ fontSize: 12 }}>{note || <span className="text-muted">—</span>}</td>
                                <td style={{ fontSize: 12 }}>{m.created_by_name || <span className="text-muted">—</span>}</td>
                              </tr>
                            );
                          })}
                          {historyModal.rows.length === 0 && (
                            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                              No stock changes yet.
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setHistoryModal(null)}>Close</button>
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
                  <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>Current stock: {stockModal.stock_quantity}</div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Reason</label>
                      <select className="form-select" value={stockForm.reason} onChange={e=>setStockForm(f=>({...f,reason:e.target.value}))}>
                        <option value="restock">Restock (+)</option>
                        <option value="waste">Waste (−)</option>
                        <option value="adjustment">Adjustment (−)</option>
                      </select>
                    </div>
                    <div className="form-group"><label className="form-label">Quantity</label><input className="form-input" type="number" min="1" value={stockForm.change_qty} onChange={e=>setStockForm(f=>({...f,change_qty:e.target.value}))} /></div>
                  </div>
                  <div className="form-group"><label className="form-label">Note</label><input className="form-input" value={stockForm.note} onChange={e=>setStockForm(f=>({...f,note:e.target.value}))} placeholder="optional" /></div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setStockModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={submitStockAdjust}>Save</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
