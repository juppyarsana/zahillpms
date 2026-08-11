import { useState, useEffect } from 'react';
import api from '../services/api';

const CATEGORIES = ['drinks', 'food', 'merchandise', 'tour', 'other'];
const CAT_ICONS = { drinks: '🍹', food: '🍽', merchandise: '👕', tour: '🏔', other: '📦' };
const EMPTY_PRODUCT_FORM = { name: '', category: 'drinks', price: '', description: '', is_available: true, track_stock: false, stock_quantity: '', low_stock_threshold: '' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

function stockBadge(p) {
  if (!p.track_stock) return null;
  if (p.stock_quantity <= 0) return <span className="badge badge-red">Out of stock</span>;
  if (p.low_stock_threshold != null && p.stock_quantity <= p.low_stock_threshold) return <span className="badge badge-amber">Low: {p.stock_quantity}</span>;
  return <span className="badge badge-gray">{p.stock_quantity} in stock</span>;
}

export default function Sales() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [tables, setTables] = useState([]);
  const [tab, setTab] = useState('pos');
  const [cart, setCart] = useState([]);
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookings, setBookings] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [orderDone, setOrderDone] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [productModal, setProductModal] = useState(null); // { mode: 'add'|'edit', id? }
  const [prodForm, setProdForm] = useState(EMPTY_PRODUCT_FORM);
  const [orderType, setOrderType] = useState('takeaway');
  const [tableId, setTableId] = useState('');
  const [stockModal, setStockModal] = useState(null); // product row
  const [stockForm, setStockForm] = useState({ change_qty: '', reason: 'restock', note: '' });
  const [newTable, setNewTable] = useState(null);
  const [tableForm, setTableForm] = useState({ name: '', capacity: '' });

  async function loadProducts() { const r = await api.get('/api/products'); setProducts(r.data); }
  async function loadSales() { const r = await api.get('/api/sales'); setSales(r.data); }
  async function loadTables() { const r = await api.get('/api/tables'); setTables(r.data); }
  useEffect(() => { loadProducts(); loadSales(); loadTables(); }, []);

  useEffect(() => {
    if (bookingSearch.length >= 2) {
      api.get(`/api/bookings?status=checked_in`).then(r => {
        setBookings(r.data.filter(b => b.guest_name?.toLowerCase().includes(bookingSearch.toLowerCase())));
      });
    } else setBookings([]);
  }, [bookingSearch]);

  const availableProducts = products.filter(p => p.is_available);

  function addToCart(product) {
    if (product.track_stock && product.stock_quantity <= 0) return;
    setCart(c => {
      const ex = c.find(i => i.product_id === product.id);
      if (ex) return c.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { product_id: product.id, name: product.name, unit_price: product.price, quantity: 1 }];
    });
  }

  function removeFromCart(id) { setCart(c => c.filter(i => i.product_id !== id)); }
  function setQty(id, qty) {
    if (qty < 1) { removeFromCart(id); return; }
    setCart(c => c.map(i => i.product_id === id ? { ...i, quantity: qty } : i));
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  async function submitOrder() {
    if (cart.length === 0) return;
    setOrderError('');
    try {
      await api.post('/api/sales', {
        booking_id: selectedBooking?.id || null,
        payment_method: selectedBooking ? 'room_charge' : payMethod,
        items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
        order_type: orderType,
        table_id: orderType === 'dine_in' ? tableId || null : null,
      });
      setCart([]);
      setSelectedBooking(null);
      setBookingSearch('');
      setTableId('');
      setOrderDone(true);
      loadSales();
      loadProducts();
      loadTables();
      setTimeout(() => setOrderDone(false), 2500);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'OUT_OF_STOCK') {
        setOrderError(`Out of stock: ${data.items.map(i => `${i.name} (have ${i.available}, need ${i.requested})`).join(', ')}`);
        loadProducts();
      } else {
        setOrderError(data?.error || 'Could not submit order');
      }
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
    if (productModal.mode === 'add') {
      await api.post('/api/products', { ...payload, stock_quantity: prodForm.stock_quantity === '' ? 0 : parseInt(prodForm.stock_quantity) });
    } else {
      await api.put(`/api/products/${productModal.id}`, payload);
    }
    setProductModal(null);
    loadProducts();
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

  async function createTable() {
    if (!tableForm.name) return;
    await api.post('/api/tables', { name: tableForm.name, capacity: tableForm.capacity || null });
    setNewTable(false);
    setTableForm({ name: '', capacity: '' });
    loadTables();
  }
  async function clearTable(t) {
    await api.patch(`/api/tables/${t.id}/status`, { status: 'available' });
    loadTables();
  }
  async function deleteTable(t) {
    if (!confirm(`Delete table "${t.name}"?`)) return;
    await api.delete(`/api/tables/${t.id}`);
    loadTables();
  }

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = availableProducts.filter(p => p.category === cat);
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Ancillary Sales</div>
        <div className="flex gap-2">
          <button className={`btn btn-sm ${tab==='pos'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('pos')}>🛍 POS</button>
          <button className={`btn btn-sm ${tab==='history'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('history')}>History</button>
          <button className={`btn btn-sm ${tab==='products'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('products')}>Products</button>
          <button className={`btn btn-sm ${tab==='tables'?'btn-primary':'btn-secondary'}`} onClick={()=>setTab('tables')}>Tables</button>
        </div>
      </div>

      {tab === 'pos' && (
        <div className="grid-2" style={{ gap: 16 }}>
          <div>
            {CATEGORIES.filter(cat => grouped[cat].length > 0).map(cat => (
              <div key={cat} className="card mb-3">
                <div className="card-title">{CAT_ICONS[cat]} {cat}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: 8 }}>
                  {grouped[cat].map(p => {
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
            {availableProducts.length === 0 && <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>No products. Add products in the Products tab.</div>}
          </div>

          <div className="card" style={{ alignSelf: 'flex-start', position: 'sticky', top: 16 }}>
            <div className="card-title">Order</div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Order Type</label>
                <select className="form-select" value={orderType} onChange={e => setOrderType(e.target.value)}>
                  <option value="takeaway">Takeaway</option>
                  <option value="dine_in">Dine-in</option>
                  <option value="room_service">Room Service</option>
                </select>
              </div>
              {orderType === 'dine_in' && (
                <div className="form-group">
                  <label className="form-label">Table</label>
                  <select className="form-select" value={tableId} onChange={e => setTableId(e.target.value)}>
                    <option value="">Select table…</option>
                    {tables.map(t => (
                      <option key={t.id} value={t.id}>{t.name}{t.status === 'occupied' ? ' (occupied)' : ''}</option>
                    ))}
                  </select>
                  {tables.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>No tables set up yet — add some in the Tables tab.</div>}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Charge to Room (optional)</label>
              <input className="form-input" placeholder="Search checked-in guest…" value={bookingSearch}
                onChange={e => setBookingSearch(e.target.value)} />
              {bookings.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4 }}>
                  {bookings.map(b => (
                    <div key={b.id} onClick={() => { setSelectedBooking(b); setBookingSearch(b.guest_name); setBookings([]); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', background: selectedBooking?.id===b.id?'var(--green-pale)':'white' }}>
                      <div style={{ fontWeight: 600 }}>{b.guest_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.unit_name}</div>
                    </div>
                  ))}
                </div>
              )}
              {selectedBooking && <div className="alert alert-success" style={{ marginTop: 4, marginBottom: 0 }}>Charging to: {selectedBooking.guest_name} · {selectedBooking.unit_name}</div>}
            </div>

            {!selectedBooking && (
              <div className="form-group">
                <label className="form-label">Payment Method</label>
                <select className="form-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="qris">QRIS</option>
                </select>
              </div>
            )}

            <div className="divider" />

            {orderError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{orderError}</div>}

            {orderDone ? (
              <div className="alert alert-success">Order recorded! ✓</div>
            ) : cart.length === 0 ? (
              <p className="text-muted" style={{ textAlign: 'center', padding: 16 }}>Cart is empty</p>
            ) : (
              <>
                {cart.map(i => (
                  <div key={i.product_id} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{i.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtIDR(i.unit_price)} × {i.quantity}</div>
                    </div>
                    <div className="flex gap-2 flex-center">
                      <button className="btn btn-icon" style={{ fontSize: 12 }} onClick={() => setQty(i.product_id, i.quantity - 1)}>−</button>
                      <span style={{ minWidth: 20, textAlign: 'center' }}>{i.quantity}</span>
                      <button className="btn btn-icon" style={{ fontSize: 12 }} onClick={() => setQty(i.product_id, i.quantity + 1)}>+</button>
                    </div>
                  </div>
                ))}
                <div className="flex-between" style={{ fontWeight: 700, fontSize: 16, marginTop: 12, marginBottom: 8 }}>
                  <span>Total</span><span>{fmtIDR(cartTotal)}</span>
                </div>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submitOrder}>
                  {selectedBooking ? '💳 Charge to Room' : '✓ Complete Sale'}
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
              <thead><tr><th>Date</th><th>Type</th><th>Table</th><th>Method</th><th>Total</th><th>Served By</th></tr></thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id}>
                    <td>{s.created_at?.slice(0,10)}</td>
                    <td><span className="badge badge-gray">{s.order_type}</span></td>
                    <td>{s.table_number || '—'}</td>
                    <td><span className="badge badge-gray">{s.payment_method}</span></td>
                    <td>{fmtIDR(s.total_amount)}</td>
                    <td>{s.served_by_name}</td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>No sales yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div>
          <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={openAddProduct}>+ Add Product</button>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Available</th><th>Stock</th><th></th></tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{CAT_ICONS[p.category]} {p.category}</td>
                      <td>{fmtIDR(p.price)}</td>
                      <td><span className={`badge badge-${p.is_available?'green':'gray'}`}>{p.is_available?'Yes':'No'}</span></td>
                      <td>{stockBadge(p) || <span className="text-muted" style={{ fontSize: 12 }}>Not tracked</span>}</td>
                      <td>
                        <div className="flex gap-2">
                          <button className="btn btn-sm btn-secondary" onClick={() => openEditProduct(p)}>Edit</button>
                          {p.track_stock && <button className="btn btn-sm btn-secondary" onClick={() => openStockModal(p)}>Adjust Stock</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>No products yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {productModal && (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-header">
                  <div className="modal-title">{productModal.mode === 'add' ? 'Add Product' : 'Edit Product'}</div>
                  <button className="btn btn-icon" onClick={() => setProductModal(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={prodForm.name} onChange={e=>setProdForm(f=>({...f,name:e.target.value}))} /></div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Category</label>
                      <select className="form-select" value={prodForm.category} onChange={e=>setProdForm(f=>({...f,category:e.target.value}))}>
                        {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
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
                      Track stock for this product
                    </label>
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
                    <div className="text-muted" style={{ fontSize: 12 }}>Current stock: {prodForm.stock_quantity} — use "Adjust Stock" from the product list to change quantity.</div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setProductModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveProduct}>{productModal.mode === 'add' ? 'Add Product' : 'Save Changes'}</button>
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

      {tab === 'tables' && (
        <div>
          <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={() => setNewTable(true)}>+ Add Table</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 12 }}>
            {tables.map(t => (
              <div key={t.id} className="card">
                <div className="flex-between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                    {t.capacity && <div className="text-muted" style={{ fontSize: 12 }}>Seats {t.capacity}</div>}
                  </div>
                  <span className={`badge badge-${t.status === 'occupied' ? 'amber' : 'green'}`}>{t.status}</span>
                </div>
                <div className="flex gap-2" style={{ marginTop: 12 }}>
                  {t.status === 'occupied' && <button className="btn btn-sm btn-secondary" onClick={() => clearTable(t)}>Clear Table</button>}
                  <button className="btn btn-sm btn-secondary" onClick={() => deleteTable(t)}>Delete</button>
                </div>
              </div>
            ))}
            {tables.length === 0 && <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32, gridColumn: '1 / -1' }}>No tables yet. Add tables so dine-in orders can be assigned to one.</div>}
          </div>

          {newTable && (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-header">
                  <div className="modal-title">Add Table</div>
                  <button className="btn btn-icon" onClick={() => setNewTable(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={tableForm.name} onChange={e=>setTableForm(f=>({...f,name:e.target.value}))} placeholder="e.g. T1" /></div>
                  <div className="form-group"><label className="form-label">Capacity</label><input className="form-input" type="number" value={tableForm.capacity} onChange={e=>setTableForm(f=>({...f,capacity:e.target.value}))} placeholder="optional" /></div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setNewTable(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={createTable}>Add Table</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
