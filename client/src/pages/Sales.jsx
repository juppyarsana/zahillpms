import { useState, useEffect } from 'react';
import api from '../services/api';

const CATEGORIES = ['drinks', 'food', 'merchandise', 'tour', 'other'];
const CAT_ICONS = { drinks: '🍹', food: '🍽', merchandise: '👕', tour: '🏔', other: '📦' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function Sales() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [tab, setTab] = useState('pos');
  const [cart, setCart] = useState([]);
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookings, setBookings] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [orderDone, setOrderDone] = useState(false);
  const [newProduct, setNewProduct] = useState(null);
  const [prodForm, setProdForm] = useState({ name: '', category: 'drinks', price: '', description: '' });

  async function loadProducts() { const r = await api.get('/api/products?available=true'); setProducts(r.data); }
  async function loadSales() { const r = await api.get('/api/sales'); setSales(r.data); }
  useEffect(() => { loadProducts(); loadSales(); }, []);

  useEffect(() => {
    if (bookingSearch.length >= 2) {
      api.get(`/api/bookings?status=checked_in`).then(r => {
        setBookings(r.data.filter(b => b.guest_name?.toLowerCase().includes(bookingSearch.toLowerCase())));
      });
    } else setBookings([]);
  }, [bookingSearch]);

  function addToCart(product) {
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
    await api.post('/api/sales', {
      booking_id: selectedBooking?.id || null,
      payment_method: selectedBooking ? 'room_charge' : payMethod,
      items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
    });
    setCart([]);
    setSelectedBooking(null);
    setBookingSearch('');
    setOrderDone(true);
    loadSales();
    setTimeout(() => setOrderDone(false), 2500);
  }

  async function createProduct() {
    if (!prodForm.name || !prodForm.price) return;
    await api.post('/api/products', prodForm);
    setNewProduct(false);
    setProdForm({ name: '', category: 'drinks', price: '', description: '' });
    loadProducts();
  }

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = products.filter(p => p.category === cat);
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
        </div>
      </div>

      {tab === 'pos' && (
        <div className="grid-2" style={{ gap: 16 }}>
          <div>
            {CATEGORIES.filter(cat => grouped[cat].length > 0).map(cat => (
              <div key={cat} className="card mb-3">
                <div className="card-title">{CAT_ICONS[cat]} {cat}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: 8 }}>
                  {grouped[cat].map(p => (
                    <button key={p.id} className="btn btn-secondary" style={{ flexDirection: 'column', height: 72, fontSize: 12 }} onClick={() => addToCart(p)}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span style={{ color: 'var(--green)', fontSize: 11 }}>{fmtIDR(p.price)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {products.length === 0 && <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>No products. Add products in the Products tab.</div>}
          </div>

          <div className="card" style={{ alignSelf: 'flex-start', position: 'sticky', top: 16 }}>
            <div className="card-title">Order</div>

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

            {cart.length === 0 ? (
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
                {orderDone ? (
                  <div className="alert alert-success">Order recorded! ✓</div>
                ) : (
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submitOrder}>
                    {selectedBooking ? '💳 Charge to Room' : '✓ Complete Sale'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Method</th><th>Total</th><th>Served By</th></tr></thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id}>
                    <td>{s.created_at?.slice(0,10)}</td>
                    <td><span className="badge badge-gray">{s.payment_method}</span></td>
                    <td>{fmtIDR(s.total_amount)}</td>
                    <td>{s.served_by_name}</td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>No sales yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div>
          <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={() => setNewProduct(true)}>+ Add Product</button>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Available</th></tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{CAT_ICONS[p.category]} {p.category}</td>
                      <td>{fmtIDR(p.price)}</td>
                      <td><span className={`badge badge-${p.is_available?'green':'gray'}`}>{p.is_available?'Yes':'No'}</span></td>
                    </tr>
                  ))}
                  {products.length === 0 && <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--text-muted)', padding:24 }}>No products yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {newProduct && (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-header">
                  <div className="modal-title">Add Product</div>
                  <button className="btn btn-icon" onClick={() => setNewProduct(false)}>✕</button>
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
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setNewProduct(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={createProduct}>Add Product</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
