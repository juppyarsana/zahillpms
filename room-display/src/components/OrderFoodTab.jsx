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
      <div className="flex-1 flex flex-col items-center justify-center bg-app gap-6">
        <span className="material-symbols-outlined text-accent" style={{ fontSize: 96 }}>check_circle</span>
        <h2 className="text-4xl font-extralight text-ink">Order placed!</h2>
        <p className="text-muted text-sm">Our team is on it — it'll be with you shortly.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Menu */}
      <section className="flex-1 p-10 bg-app overflow-y-auto">
        <div className="mb-6">
          <h2 className="text-3xl font-extralight text-ink mb-1">Order Food</h2>
          <p className="text-dim text-sm">Browse the menu and we'll bring it right to your room.</p>
        </div>

        {loading && <p className="text-dim text-sm">Loading menu…</p>}
        {!loading && menu.length === 0 && <p className="text-dim text-sm">Nothing on the menu right now.</p>}

        {grouped.map(({ cat, items }) => (
          <div key={cat} className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-lg text-accent">{CATEGORY_ICONS[cat]}</span>
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{CATEGORY_LABELS[cat]}</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {items.map(p => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="glass-card rounded-2xl p-5 text-left flex flex-col gap-2"
                >
                  <span className="text-ink text-sm font-medium">{p.name}</span>
                  {p.description && <span className="text-dim text-xs">{p.description}</span>}
                  <span className="mt-auto pt-2 text-accent" style={{ fontSize: 15, fontWeight: 600 }}>{fmtIDR(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Cart */}
      <aside className="w-[380px] shrink-0 border-l border-app-soft p-8 flex flex-col bg-pane">
        <h3 className="text-xs font-bold uppercase tracking-[0.3em] mb-5 text-accent">Your Order</h3>

        {cart.length === 0 ? (
          <p className="text-faint text-sm text-center mt-10">Tap an item to add it here.</p>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-3">
            {cart.map(i => (
              <div key={i.product_id} className="glass-card rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-ink text-sm">{i.name}</p>
                  <p className="text-dim text-xs">{fmtIDR(i.price)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setQty(i.product_id, i.quantity - 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-muted bg-surface-2">−</button>
                  <span className="text-ink text-sm w-4 text-center">{i.quantity}</span>
                  <button onClick={() => setQty(i.product_id, i.quantity + 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-muted bg-surface-2">+</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs mt-4" style={{ color: 'var(--danger-text)' }}>{error}</p>}

        <div className="mt-auto pt-5 border-t border-app-soft">
          <div className="flex items-center justify-between mb-4">
            <span className="text-muted text-sm">Total</span>
            <span className="text-ink text-xl font-light">{fmtIDR(cartTotal)}</span>
          </div>
          <button
            onClick={placeOrder}
            disabled={cart.length === 0 || placing}
            className="w-full py-3.5 rounded-xl text-sm font-bold uppercase tracking-widest"
            style={{
              background: cart.length === 0 || placing ? 'var(--surface-2)' : 'var(--accent)',
              color: cart.length === 0 || placing ? 'var(--text-faint)' : 'var(--accent-contrast)',
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
