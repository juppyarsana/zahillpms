import { useState, useEffect, useCallback } from 'react';
import api from '../api';

const CATEGORIES = ['food', 'drinks', 'merchandise', 'tour', 'other'];
const CATEGORY_LABELS = { food: 'Food', drinks: 'Drinks', merchandise: 'Merchandise', tour: 'Tours & Activities', other: 'Other' };
const CATEGORY_ICONS = { food: 'restaurant', drinks: 'local_bar', merchandise: 'checkroom', tour: 'hiking', other: 'inventory_2' };
const CONFIRMATION_MS = 4000;

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function OrderFoodTab({ roomId, onOrderPlaced }) {
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [placing, setPlacing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);

  const loadMenu = useCallback(async () => {
    try {
      const { data } = await api.get(`/display/room/${roomId}/menu`);
      setMenu(data);
      setError(null);
    } catch {
      setError('Could not load the menu. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  function addToCart(product) {
    setCart(c => {
      const existing = c.find(i => i.product_id === product.id);
      if (existing) return c.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { product_id: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
  }

  function setQty(productId, qty) {
    if (qty < 1) { setCart(c => c.filter(i => i.product_id !== productId)); return; }
    setCart(c => c.map(i => i.product_id === productId ? { ...i, quantity: qty } : i));
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  async function placeOrder() {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    setError(null);
    try {
      await api.post(`/display/room/${roomId}/order`, {
        items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
      });
      setCart([]);
      setConfirmed(true);
      onOrderPlaced?.();
      setTimeout(() => setConfirmed(false), CONFIRMATION_MS);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'OUT_OF_STOCK') {
        setError(`Sorry, we just ran out of ${data.items.map(i => i.name).join(', ')}. Please adjust your order.`);
        loadMenu();
      } else {
        setError(data?.error || 'Could not place your order. Please try again.');
      }
    } finally {
      setPlacing(false);
    }
  }

  const grouped = CATEGORIES.map(cat => ({ cat, items: menu.filter(p => p.category === cat) })).filter(g => g.items.length > 0);

  if (confirmed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-bg-dark gap-6">
        <span className="material-symbols-outlined" style={{ fontSize: 96, color: '#c9a227' }}>check_circle</span>
        <h2 className="text-4xl font-extralight text-white">Order placed!</h2>
        <p className="text-slate-400 text-sm">Our team is on it — it'll be with you shortly.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Menu */}
      <section className="flex-1 p-10 bg-bg-dark overflow-y-auto">
        <div className="mb-6">
          <h2 className="text-3xl font-extralight text-white mb-1">Order Food</h2>
          <p className="text-slate-500 text-sm">Browse the menu and we'll bring it right to your room.</p>
        </div>

        {loading && <p className="text-slate-500 text-sm">Loading menu…</p>}
        {!loading && menu.length === 0 && <p className="text-slate-500 text-sm">Nothing on the menu right now.</p>}

        {grouped.map(({ cat, items }) => (
          <div key={cat} className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-lg" style={{ color: '#c9a227' }}>{CATEGORY_ICONS[cat]}</span>
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{CATEGORY_LABELS[cat]}</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {items.map(p => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="glass-card rounded-2xl p-5 text-left flex flex-col gap-2"
                  style={{ border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <span className="text-white text-sm font-medium">{p.name}</span>
                  {p.description && <span className="text-slate-500 text-xs">{p.description}</span>}
                  <span className="mt-auto pt-2" style={{ color: '#c9a227', fontSize: 15, fontWeight: 600 }}>{fmtIDR(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Cart */}
      <aside className="w-[380px] shrink-0 border-l border-white/5 p-8 flex flex-col" style={{ background: 'rgba(14,17,23,0.5)' }}>
        <h3 className="text-xs font-bold uppercase tracking-[0.3em] mb-5" style={{ color: '#c9a227' }}>Your Order</h3>

        {cart.length === 0 ? (
          <p className="text-slate-600 text-sm text-center mt-10">Tap an item to add it here.</p>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-3">
            {cart.map(i => (
              <div key={i.product_id} className="glass-card rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm">{i.name}</p>
                  <p className="text-slate-500 text-xs">{fmtIDR(i.price)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setQty(i.product_id, i.quantity - 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>−</button>
                  <span className="text-white text-sm w-4 text-center">{i.quantity}</span>
                  <button onClick={() => setQty(i.product_id, i.quantity + 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>+</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs mt-4" style={{ color: '#f87171' }}>{error}</p>}

        <div className="mt-auto pt-5 border-t border-white/5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400 text-sm">Total</span>
            <span className="text-white text-xl font-light">{fmtIDR(cartTotal)}</span>
          </div>
          <button
            onClick={placeOrder}
            disabled={cart.length === 0 || placing}
            className="w-full py-3.5 rounded-xl text-sm font-bold uppercase tracking-widest"
            style={{
              background: cart.length === 0 || placing ? 'rgba(255,255,255,0.06)' : '#c9a227',
              color: cart.length === 0 || placing ? '#475569' : '#0a0d12',
              cursor: cart.length === 0 || placing ? 'default' : 'pointer',
            }}
          >
            {placing ? 'Placing…' : 'Place Order'}
          </button>
        </div>
      </aside>
    </div>
  );
}
