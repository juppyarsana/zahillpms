import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

// Two menus can arrive here:
//  • from the property's POS (migration 094): { source: 'pos', status, message,
//    items, prices } — POS categories, "room service is closed" messages, and
//    a note for the kitchen. Charged to the room once the restaurant accepts.
//  • the PMS's own food products (an array) — F&B only (migration 067).
const LEGACY_LABELS = { food: 'Food', drinks: 'Drinks' };
const LEGACY_ICONS = { food: 'restaurant', drinks: 'local_bar' };
const CONFIRMATION_MS = 5000;

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
const newRef = () => 'rd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export default function OrderFoodTab({ roomId, onOrderPlaced }) {
  const [menu, setMenu] = useState({ items: [], pos: false });
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [confirmed, setConfirmed] = useState(null);   // 'pending' | 'accepted'
  const [error, setError] = useState(null);
  const ref = useRef(newRef());   // same id on a retry, so an order is never sent twice

  const loadMenu = useCallback(async () => {
    try {
      const { data } = await api.get(`/display/room/${roomId}/menu`);
      setMenu(Array.isArray(data) ? { items: data, pos: false } : { ...data, pos: true });
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the menu. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  const closed = menu.pos && menu.status !== 'open';

  function changeCart(fn) { ref.current = newRef(); setCart(fn); }
  function addToCart(product) {
    if (closed) return;
    changeCart(c => {
      const existing = c.find(i => i.product_id === product.id);
      if (existing) return c.map(i => i.product_id === product.id ? { ...i, quantity: Math.min(20, i.quantity + 1) } : i);
      return [...c, { product_id: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
  }
  function setQty(productId, qty) {
    if (qty < 1) { changeCart(c => c.filter(i => i.product_id !== productId)); return; }
    changeCart(c => c.map(i => i.product_id === productId ? { ...i, quantity: Math.min(20, qty) } : i));
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const plus = menu.pos && menu.prices && menu.prices.include === false && (menu.prices.service > 0 || menu.prices.tax > 0);

  async function placeOrder() {
    if (cart.length === 0 || placing || closed) return;
    setPlacing(true);
    setError(null);
    try {
      const { data } = await api.post(`/display/room/${roomId}/order`, {
        items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
        ...(menu.pos ? { note: note.trim(), client_ref: ref.current } : {}),
      });
      setCart([]);
      setNote('');
      ref.current = newRef();
      setConfirmed(data?.status === 'accepted' ? 'accepted' : 'pending');
      onOrderPlaced?.();
      setTimeout(() => setConfirmed(null), CONFIRMATION_MS);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'OUT_OF_STOCK') {
        setError(`Sorry, we just ran out of ${data.items.map(i => i.name).join(', ')}. Please adjust your order.`);
        loadMenu();
      } else {
        setError(data?.error || 'Could not place your order. Please try again.');
        if (['OFF', 'PAUSED', 'CLOSED', 'NOT_ON_MENU'].includes(data?.code)) loadMenu();
      }
    } finally {
      setPlacing(false);
    }
  }

  // Categories in menu order (POS) or Food / Drinks (PMS menu).
  const cats = menu.pos
    ? [...new Set(menu.items.map(p => p.category))]
    : ['food', 'drinks'];
  const grouped = cats.map(cat => ({ cat, items: menu.items.filter(p => p.category === cat) })).filter(g => g.items.length > 0);

  if (confirmed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-app gap-6">
        <span className="material-symbols-outlined text-accent" style={{ fontSize: 96 }}>check_circle</span>
        <h2 className="text-4xl font-extralight text-ink">Order sent!</h2>
        <p className="text-muted text-sm text-center" style={{ maxWidth: 460 }}>
          {confirmed === 'accepted'
            ? 'The kitchen has your order. It is charged to your room.'
            : 'Sent to the restaurant — you will see it confirmed shortly under Your Orders. It is charged to your room once confirmed.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Menu */}
      <section className="flex-1 p-10 bg-app overflow-y-auto">
        <div className="mb-6">
          <h2 className="text-3xl font-extralight text-ink mb-1">Order Food</h2>
          <p className="text-dim text-sm">
            Browse the menu and we'll bring it right to your room.
            {menu.pos && menu.hours && <> Room service {menu.hours.from} – {menu.hours.to}.</>}
          </p>
        </div>

        {closed && (
          <div className="glass-card rounded-2xl p-5 mb-6 flex items-center gap-3">
            <span className="material-symbols-outlined text-accent">schedule</span>
            <span className="text-ink text-sm">{menu.message || 'Room service is not taking orders right now — please call the front desk'}</span>
          </div>
        )}

        {loading && <p className="text-dim text-sm">Loading menu…</p>}
        {!loading && !error && menu.items.length === 0 && !closed && <p className="text-dim text-sm">Nothing on the menu right now.</p>}

        {grouped.map(({ cat, items }) => (
          <div key={cat} className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              {!menu.pos && <span className="material-symbols-outlined text-lg text-accent">{LEGACY_ICONS[cat]}</span>}
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted">{menu.pos ? cat : LEGACY_LABELS[cat]}</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {items.map(p => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={closed}
                  className="glass-card rounded-2xl p-5 text-left flex flex-col gap-2"
                  style={{ opacity: closed ? 0.55 : 1, cursor: closed ? 'default' : 'pointer' }}
                >
                  <span className="text-ink text-sm font-medium">{p.emoji ? `${p.emoji} ` : ''}{p.name}</span>
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
            {menu.pos && (
              <textarea
                value={note}
                onChange={e => setNote(e.target.value.slice(0, 200))}
                placeholder="Note for the kitchen (optional) — e.g. no chili, extra ice"
                rows={2}
                className="glass-card rounded-xl p-3 text-sm text-ink"
                style={{ resize: 'none', border: 'none', outline: 'none', background: 'var(--surface-2)' }}
              />
            )}
          </div>
        )}

        {error && <p className="text-xs mt-4" style={{ color: 'var(--danger-text)' }}>{error}</p>}

        <div className="mt-auto pt-5 border-t border-app-soft">
          <div className="flex items-center justify-between mb-1">
            <span className="text-muted text-sm">Total</span>
            <span className="text-ink text-xl font-light">{fmtIDR(cartTotal)}</span>
          </div>
          <p className="text-dim text-xs mb-4">
            {plus ? `+ service ${menu.prices.service}% and tax ${menu.prices.tax}% · ` : ''}Charged to your room
          </p>
          <button
            onClick={placeOrder}
            disabled={cart.length === 0 || placing || closed}
            className="w-full py-3.5 rounded-xl text-sm font-bold uppercase tracking-widest"
            style={{
              background: cart.length === 0 || placing || closed ? 'var(--surface-2)' : 'var(--accent)',
              color: cart.length === 0 || placing || closed ? 'var(--text-faint)' : 'var(--accent-contrast)',
              cursor: cart.length === 0 || placing || closed ? 'default' : 'pointer',
            }}
          >
            {placing ? 'Placing…' : 'Place Order'}
          </button>
        </div>
      </aside>
    </div>
  );
}
