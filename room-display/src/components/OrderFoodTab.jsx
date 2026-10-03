import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../api';

// Two menus can arrive here:
//  • from the property's POS (migration 094): { source: 'pos', status, message,
//    items, prices } — POS categories, "room service is closed" messages, and
//    a note for the kitchen. Charged to the room once the restaurant accepts.
//  • the PMS's own food products (an array) — F&B only (migration 067).
const LEGACY_LABELS = { food: 'Food', drinks: 'Drinks' };
const LEGACY_ICONS = { food: 'restaurant', drinks: 'local_bar' };
const CONFIRMATION_MS = 6000;
// How the guest can pay (the POS says which are allowed). Cash / card are paid
// at the door — the restaurant brings the bill with the food.
const PAY_OPTIONS = {
  room: { icon: 'bed', title: 'Charge to my room', sub: 'Added to your room bill — pay at check-out' },
  cash: { icon: 'payments', title: 'Cash on delivery', sub: 'Pay in cash when the food arrives' },
  card: { icon: 'credit_card', title: 'Card on delivery', sub: 'We bring the card machine with your food' },
};
const MAX_QTY = 20;

function fmtIDR(n) { return 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID'); }
const newRef = () => 'rd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Same formula as the POS till: service first, then tax on price + service —
// added only to "++" items; an item marked nett (price incl. service & tax)
// counts at exactly its price. service / tax = what is added on top.
function totals(lines, prices) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  if (!prices || prices.include !== false) return { subtotal, service: 0, tax: 0, total: subtotal, added: false };
  const plus = lines.filter(l => !l.nett).reduce((s, l) => s + l.amount, 0);
  const service = Math.round(plus * (prices.service || 0) / 100);
  const tax = Math.round((plus + service) * (prices.tax || 0) / 100);
  return { subtotal, service, tax, total: subtotal + service + tax, added: service > 0 || tax > 0 };
}

function Stepper({ qty, onChange, size = 34 }) {
  const btn = {
    width: size, height: size, borderRadius: size / 2, border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  return (
    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
      <button onClick={() => onChange(qty - 1)} className="bg-surface-2 text-ink" style={btn} aria-label="One less">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{qty === 1 ? 'delete' : 'remove'}</span>
      </button>
      <span className="text-ink font-semibold text-center" style={{ minWidth: 18, fontSize: 15 }}>{qty}</span>
      <button onClick={() => onChange(qty + 1)} disabled={qty >= MAX_QTY} style={{ ...btn, background: 'var(--accent)', color: 'var(--accent-contrast)', opacity: qty >= MAX_QTY ? 0.4 : 1 }} aria-label="One more">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
      </button>
    </div>
  );
}

function DishCard({ item, qty, closed, legacyIcon, onAdd, onQty, onOpen }) {
  const inCart = qty > 0;
  return (
    <div
      onClick={onOpen}
      className="rounded-3xl p-5 flex flex-col gap-4 transition-all"
      style={{
        background: inCart ? 'rgb(var(--accent-rgb) / 0.08)' : 'var(--surface)',
        border: `1.5px solid ${inCart ? 'rgb(var(--accent-rgb) / 0.55)' : 'var(--border)'}`,
        cursor: 'pointer',
        opacity: closed ? 0.5 : 1,
      }}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 rounded-2xl flex items-center justify-center accent-tint" style={{ width: 64, height: 64 }}>
          {item.emoji
            ? <span style={{ fontSize: 34, lineHeight: 1 }}>{item.emoji}</span>
            : <span className="material-symbols-outlined text-accent" style={{ fontSize: 30 }}>{legacyIcon || 'restaurant'}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-ink font-semibold leading-snug" style={{ fontSize: 16 }}>{item.name}</div>
          {item.description && (
            <div className="text-dim mt-1 leading-snug" style={{ fontSize: 13, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {item.description}
            </div>
          )}
          <div className="text-accent mt-1 flex items-center gap-0.5" style={{ fontSize: 12, fontWeight: 600 }}>
            Details <span className="material-symbols-outlined" style={{ fontSize: 15 }}>chevron_right</span>
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-accent font-semibold" style={{ fontSize: 17, whiteSpace: 'nowrap' }}>
          {fmtIDR(item.price)}
          {item.nett && <span className="block text-muted" style={{ fontSize: 11, fontWeight: 500 }}>incl. service &amp; tax</span>}
        </span>
        {inCart ? (
          <Stepper qty={qty} onChange={onQty} size={32} />
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onAdd(); }}
            disabled={closed}
            className="flex items-center gap-1 rounded-full font-semibold"
            style={{ padding: '8px 16px 8px 12px', fontSize: 13, border: '1.5px solid rgb(var(--accent-rgb) / 0.6)', color: 'var(--accent)', background: 'transparent', cursor: closed ? 'default' : 'pointer' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span> Add
          </button>
        )}
      </div>
    </div>
  );
}

// The whole dish: big picture tile, full description, price, Add / quantity.
function DishDetails({ item, qty, closed, legacyIcon, category, onAdd, onQty, onClose }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-10" style={{ background: 'var(--scrim)' }} onClick={onClose}>
      <div className="rounded-3xl bg-pane w-full flex flex-col" style={{ maxWidth: 560, maxHeight: '100%', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-5 p-8 pb-5">
          <div className="shrink-0 rounded-3xl flex items-center justify-center accent-tint" style={{ width: 104, height: 104 }}>
            {item.emoji
              ? <span style={{ fontSize: 58, lineHeight: 1 }}>{item.emoji}</span>
              : <span className="material-symbols-outlined text-accent" style={{ fontSize: 50 }}>{legacyIcon || 'restaurant'}</span>}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            {category && <div className="text-xs font-bold uppercase tracking-[0.25em] text-accent mb-2">{category}</div>}
            <h3 className="text-ink font-light leading-tight" style={{ fontSize: 28 }}>{item.name}</h3>
            <div className="text-accent font-semibold mt-2" style={{ fontSize: 20 }}>{fmtIDR(item.price)}</div>
            {item.nett && <div className="text-muted" style={{ fontSize: 13 }}>Price includes service &amp; tax</div>}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full flex items-center justify-center bg-surface-2 text-ink"
            style={{ width: 44, height: 44, border: 'none', cursor: 'pointer' }} aria-label="Close">
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>close</span>
          </button>
        </div>
        <div className="px-8 overflow-y-auto" style={{ minHeight: 0 }}>
          <p className="text-muted" style={{ fontSize: 16, lineHeight: 1.65, whiteSpace: 'pre-line' }}>
            {item.description || 'No description for this dish.'}
          </p>
        </div>
        <div className="p-8 pt-6 flex items-center justify-between gap-4">
          {closed ? (
            <span className="text-dim" style={{ fontSize: 14 }}>Room service isn't taking orders right now.</span>
          ) : qty > 0 ? (
            <>
              <span className="text-muted" style={{ fontSize: 14 }}>In your order · {fmtIDR(item.price * qty)}</span>
              <Stepper qty={qty} onChange={onQty} size={44} />
            </>
          ) : (
            <button onClick={onAdd} className="flex-1 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-2"
              style={{ padding: '15px 0', fontSize: 14, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-contrast)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span> Add to order · {fmtIDR(item.price)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Category chips in one row. When they don't all fit, the edge that hides
// more fades out and shows an arrow (tap to slide) so guests know to swipe.
function CategoryBar({ groups, activeCat, onPick }) {
  const rowRef = useRef(null);
  const [more, setMore] = useState({ left: false, right: false });
  const check = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    check();
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [check, groups]);
  // Keep the active chip in view while the menu scrolls.
  useEffect(() => {
    const chip = rowRef.current?.querySelector(`[data-cat="${CSS.escape(String(activeCat))}"]`);
    chip?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeCat]);
  const slide = dir => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.7, behavior: 'smooth' });
  const edge = (side) => (
    <div className="absolute top-0 bottom-0 flex items-center z-10" style={{
      [side]: 0, width: 84, justifyContent: side === 'left' ? 'flex-start' : 'flex-end', pointerEvents: 'none',
      background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, var(--bg) 35%, transparent)`,
    }}>
      <button onClick={() => slide(side === 'left' ? -1 : 1)} aria-label={side === 'left' ? 'More categories to the left' : 'More categories'}
        className="rounded-full flex items-center justify-center"
        style={{ width: 38, height: 38, pointerEvents: 'auto', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--accent)', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{side === 'left' ? 'chevron_left' : 'chevron_right'}</span>
      </button>
    </div>
  );
  return (
    <div className="relative">
      {more.left && edge('left')}
      <div ref={rowRef} onScroll={check} className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {groups.map(g => {
          const on = activeCat === g.cat;
          return (
            <button key={g.cat} data-cat={g.cat} onClick={() => onPick(g.cat)}
              className="shrink-0 rounded-full font-semibold transition-all"
              style={{
                padding: '9px 18px', fontSize: 14, cursor: 'pointer',
                background: on ? 'var(--accent)' : 'var(--surface)',
                color: on ? 'var(--accent-contrast)' : 'var(--text-muted)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              }}>
              {g.label} <span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 4 }}>{g.items.length}</span>
            </button>
          );
        })}
      </div>
      {more.right && edge('right')}
    </div>
  );
}

export default function OrderFoodTab({ roomId, onOrderPlaced }) {
  const [menu, setMenu] = useState({ items: [], pos: false });
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [confirmed, setConfirmed] = useState(null);   // { status, total }
  const [error, setError] = useState(null);
  const [activeCat, setActiveCat] = useState(null);
  const [askPay, setAskPay] = useState(false);       // the "How would you like to pay?" step
  const [payment, setPayment] = useState('room');
  const [detail, setDetail] = useState(null);         // the dish whose details are open
  const ref = useRef(newRef());   // same id on a retry, so an order is never sent twice
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});

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

  useEffect(() => {
    loadMenu();
    const t = setInterval(loadMenu, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') loadMenu(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [loadMenu]);

  const closed = menu.pos && menu.status !== 'open';

  // Categories in menu order (POS) or Food / Drinks (PMS menu).
  const groups = useMemo(() => {
    const cats = menu.pos ? [...new Set(menu.items.map(p => p.category))] : ['food', 'drinks'];
    return cats.map(cat => ({ cat, label: menu.pos ? cat : LEGACY_LABELS[cat], items: menu.items.filter(p => p.category === cat) }))
      .filter(g => g.items.length > 0);
  }, [menu]);
  useEffect(() => { if (groups.length && !activeCat) setActiveCat(groups[0].cat); }, [groups, activeCat]);

  function onScroll() {
    const box = scrollRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top + 90;
    let current = groups[0]?.cat;
    for (const g of groups) {
      const el = sectionRefs.current[g.cat];
      if (el && el.getBoundingClientRect().top <= top) current = g.cat;
    }
    setActiveCat(current);
  }
  function jumpTo(cat) {
    const box = scrollRef.current, el = sectionRefs.current[cat];
    if (!box || !el) return;
    box.scrollTo({ top: el.offsetTop - 76, behavior: 'smooth' });
    setActiveCat(cat);
  }

  const qtyOf = id => cart.find(i => i.product_id === id)?.quantity || 0;
  function changeCart(fn) { ref.current = newRef(); setCart(fn); }
  function addToCart(product) {
    if (closed) return;
    changeCart(c => {
      const existing = c.find(i => i.product_id === product.id);
      if (existing) return c.map(i => i.product_id === product.id ? { ...i, quantity: Math.min(MAX_QTY, i.quantity + 1) } : i);
      return [...c, { product_id: product.id, name: product.name, emoji: product.emoji, price: product.price, nett: !!product.nett, quantity: 1 }];
    });
  }
  function setQty(productId, qty) {
    if (qty < 1) { changeCart(c => c.filter(i => i.product_id !== productId)); return; }
    changeCart(c => c.map(i => i.product_id === productId ? { ...i, quantity: Math.min(MAX_QTY, qty) } : i));
  }

  const payOptions = (menu.pos && Array.isArray(menu.payments) ? menu.payments : ['room']).filter(k => PAY_OPTIONS[k]);
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  const sum = totals(cart.map(i => ({ amount: i.price * i.quantity, nett: !!i.nett })), menu.pos ? menu.prices : null);

  // Send order: ask how they'll pay first when there's a choice.
  function onSend() {
    if (cart.length === 0 || placing || closed) return;
    if (payOptions.length > 1) { setPayment(p => (payOptions.includes(p) ? p : 'room')); setAskPay(true); return; }
    placeOrder('room');
  }

  async function placeOrder(pay = 'room') {
    if (cart.length === 0 || placing || closed) return;
    setPlacing(true);
    setError(null);
    try {
      const { data } = await api.post(`/display/room/${roomId}/order`, {
        items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
        ...(menu.pos ? { note: note.trim(), client_ref: ref.current, payment: pay } : {}),
      });
      setAskPay(false);
      setConfirmed({ status: data?.status === 'accepted' ? 'accepted' : 'pending', total: sum.total, count, payment: data?.payment || pay });
      setCart([]);
      setNote('');
      ref.current = newRef();
      onOrderPlaced?.();
      setTimeout(() => setConfirmed(null), CONFIRMATION_MS);
    } catch (err) {
      const data = err.response?.data;
      setAskPay(false);
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

  if (confirmed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-app gap-5 px-10">
        <div className="rounded-full flex items-center justify-center accent-tint" style={{ width: 132, height: 132 }}>
          <span className="material-symbols-outlined text-accent" style={{ fontSize: 72 }}>room_service</span>
        </div>
        <h2 className="text-4xl font-extralight text-ink">Order sent</h2>
        <p className="text-muted text-center" style={{ maxWidth: 480, fontSize: 15, lineHeight: 1.6 }}>
          {confirmed.status === 'accepted'
            ? 'The kitchen has your order and will bring it to your room.'
            : 'The restaurant will confirm it in a moment — you can follow it under Your Orders.'}
        </p>
        <div className="text-dim" style={{ fontSize: 13 }}>
          {confirmed.count} item{confirmed.count === 1 ? '' : 's'} · {fmtIDR(confirmed.total)} · {confirmed.payment === 'cash' ? 'pay in cash when it arrives'
            : confirmed.payment === 'card' ? 'pay by card when it arrives' : `charged to your room${confirmed.status === 'accepted' ? '' : ' once confirmed'}`}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden" style={{ position: 'relative' }}>
      {askPay && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-10" style={{ background: 'var(--scrim)' }} onClick={() => !placing && setAskPay(false)}>
          <div className="rounded-3xl p-8 bg-pane w-full" style={{ maxWidth: 560, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-accent mb-2">Almost done</div>
            <h3 className="text-ink font-light mb-6" style={{ fontSize: 28 }}>How would you like to pay?</h3>
            <div className="flex flex-col gap-3 mb-6">
              {payOptions.map(k => {
                const o = PAY_OPTIONS[k], on = payment === k;
                return (
                  <button key={k} onClick={() => setPayment(k)} className="rounded-2xl p-4 flex items-center gap-4 text-left"
                    style={{ cursor: 'pointer', background: on ? 'rgb(var(--accent-rgb) / 0.1)' : 'var(--surface)',
                      border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}` }}>
                    <div className="shrink-0 rounded-xl flex items-center justify-center" style={{ width: 48, height: 48,
                      background: on ? 'var(--accent)' : 'var(--surface-2)', color: on ? 'var(--accent-contrast)' : 'var(--text-muted)' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 26 }}>{o.icon}</span>
                    </div>
                    <div className="flex-1">
                      <div className="text-ink font-semibold" style={{ fontSize: 16 }}>{o.title}</div>
                      <div className="text-dim" style={{ fontSize: 13 }}>{o.sub}</div>
                    </div>
                    <span className="material-symbols-outlined" style={{ fontSize: 24, color: on ? 'var(--accent)' : 'var(--text-ghost)' }}>
                      {on ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-baseline justify-between mb-5">
              <span className="text-muted" style={{ fontSize: 14 }}>{count} item{count === 1 ? '' : 's'}</span>
              <span className="text-ink font-light" style={{ fontSize: 26 }}>{fmtIDR(sum.total)}</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAskPay(false)} disabled={placing} className="rounded-2xl font-semibold bg-surface-2 text-ink"
                style={{ padding: '15px 22px', fontSize: 14, border: 'none', cursor: 'pointer' }}>Back</button>
              <button onClick={() => placeOrder(payment)} disabled={placing} className="flex-1 rounded-2xl font-bold uppercase tracking-widest"
                style={{ padding: '15px 0', fontSize: 14, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-contrast)' }}>
                {placing ? 'Sending…' : 'Send order'}
              </button>
            </div>
          </div>
        </div>
      )}
      {detail && (
        <DishDetails item={detail.item} qty={qtyOf(detail.item.id)} closed={closed}
          category={detail.group.label} legacyIcon={menu.pos ? null : LEGACY_ICONS[detail.group.cat]}
          onAdd={() => addToCart(detail.item)} onQty={q => setQty(detail.item.id, q)} onClose={() => setDetail(null)} />
      )}
      {/* Menu */}
      <section ref={scrollRef} onScroll={onScroll} className="flex-1 bg-app overflow-y-auto" style={{ position: 'relative' }}>
        <div className="px-10 pt-9 pb-2 flex items-end justify-between gap-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-accent mb-2">In-room dining</div>
            <h2 className="text-ink font-extralight" style={{ fontSize: 34, lineHeight: 1.1 }}>What would you like?</h2>
            <p className="text-dim mt-2" style={{ fontSize: 14 }}>We'll bring it right to your room — charged to your room bill.</p>
          </div>
          {menu.pos && !loading && (
            <div className="shrink-0 flex items-center gap-2 rounded-full px-4 py-2"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: closed ? 'var(--danger-text)' : 'var(--ok)' }} />
              <span className="text-ink font-semibold">{closed ? (menu.status === 'paused' ? 'Paused' : 'Closed') : 'Open now'}</span>
              {menu.hours && <span className="text-dim">· {menu.hours.from} – {menu.hours.to}</span>}
            </div>
          )}
        </div>

        {/* Category bar — stays at the top while scrolling */}
        {groups.length > 1 && (
          <div className="sticky top-0 z-10 px-10 py-4 bg-app" style={{ borderBottom: '1px solid var(--border-soft)' }}>
            <CategoryBar groups={groups} activeCat={activeCat} onPick={jumpTo} />
          </div>
        )}

        <div className="px-10 pb-12 pt-5">
          {closed && (
            <div className="rounded-3xl p-5 mb-7 flex items-center gap-4" style={{ background: 'var(--danger-soft)', border: '1px solid var(--border)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 30, color: 'var(--danger-text)' }}>schedule</span>
              <div>
                <div className="text-ink font-semibold" style={{ fontSize: 15 }}>{menu.status === 'paused' ? 'Room service is paused' : 'Room service is closed'}</div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  {menu.status === 'closed' && menu.hours ? `Room service hours are ${menu.hours.from} – ${menu.hours.to}. ` : ''}Please call the front desk and we'll help you.
                </div>
              </div>
            </div>
          )}

          {loading && <p className="text-dim text-sm">Loading menu…</p>}
          {!loading && error && !menu.items.length && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm" style={{ color: 'var(--danger-text)' }}>{error}</p>
              <button onClick={() => { setLoading(true); loadMenu(); }} className="rounded-full px-5 py-2 text-sm font-semibold bg-surface-2 text-ink" style={{ border: 'none', cursor: 'pointer' }}>Try again</button>
            </div>
          )}
          {!loading && !error && menu.items.length === 0 && !closed && <p className="text-dim text-sm">Nothing on the menu right now.</p>}

          {groups.map(g => (
            <div key={g.cat} ref={el => { sectionRefs.current[g.cat] = el; }} className="mb-10">
              <h3 className="text-ink font-light mb-4" style={{ fontSize: 22 }}>{g.label}</h3>
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(205px, 1fr))' }}>
                {g.items.map(p => (
                  <DishCard key={p.id} item={p} qty={qtyOf(p.id)} closed={closed}
                    legacyIcon={menu.pos ? null : LEGACY_ICONS[g.cat]}
                    onAdd={() => addToCart(p)} onQty={q => setQty(p.id, q)} onOpen={() => setDetail({ item: p, group: g })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tray */}
      <aside className="w-[330px] xl:w-[380px] shrink-0 border-l border-app-soft flex flex-col bg-pane">
        <div className="px-7 pt-8 pb-4 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-accent">Your order</h3>
          {count > 0 && (
            <span className="rounded-full px-3 py-1 font-semibold" style={{ fontSize: 12, background: 'var(--accent)', color: 'var(--accent-contrast)' }}>
              {count} item{count === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-10 gap-3">
            <div className="rounded-full flex items-center justify-center bg-surface-2" style={{ width: 88, height: 88 }}>
              <span className="material-symbols-outlined text-faint" style={{ fontSize: 44 }}>room_service</span>
            </div>
            <div className="text-ink font-semibold" style={{ fontSize: 15 }}>Your tray is empty</div>
            <div className="text-dim" style={{ fontSize: 13, lineHeight: 1.5 }}>Tap <b>Add</b> on a dish to start your order.</div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-7 flex flex-col gap-3">
            {cart.map(i => (
              <div key={i.product_id} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)' }}>
                <div className="shrink-0 rounded-xl flex items-center justify-center accent-tint" style={{ width: 42, height: 42 }}>
                  {i.emoji ? <span style={{ fontSize: 22 }}>{i.emoji}</span> : <span className="material-symbols-outlined text-accent" style={{ fontSize: 20 }}>restaurant</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-ink leading-snug" style={{ fontSize: 14, fontWeight: 600 }}>{i.name}</div>
                  <div className="text-dim" style={{ fontSize: 12 }}>{fmtIDR(i.price * i.quantity)}</div>
                </div>
                <Stepper qty={i.quantity} onChange={q => setQty(i.product_id, q)} size={30} />
              </div>
            ))}
            {menu.pos && (
              <label className="rounded-2xl p-4 flex gap-3 items-start mt-1" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
                <span className="material-symbols-outlined text-dim" style={{ fontSize: 20, marginTop: 1 }}>edit_note</span>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value.slice(0, 200))}
                  placeholder="Note for the kitchen — e.g. no chili, extra ice"
                  rows={2}
                  className="flex-1 text-sm text-ink bg-transparent"
                  style={{ resize: 'none', border: 'none', outline: 'none' }}
                />
              </label>
            )}
          </div>
        )}

        <div className="px-7 pt-5 pb-7 mt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
          {error && menu.items.length > 0 && <p className="text-xs mb-3" style={{ color: 'var(--danger-text)' }}>{error}</p>}
          {sum.added && cart.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-3" style={{ fontSize: 13 }}>
              <div className="flex justify-between text-muted"><span>Subtotal</span><span>{fmtIDR(sum.subtotal)}</span></div>
              {sum.service > 0 && <div className="flex justify-between text-muted"><span>Service</span><span>{fmtIDR(sum.service)}</span></div>}
              {sum.tax > 0 && <div className="flex justify-between text-muted"><span>Tax</span><span>{fmtIDR(sum.tax)}</span></div>}
            </div>
          )}
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-muted" style={{ fontSize: 14 }}>Total</span>
            <span className="text-ink font-light" style={{ fontSize: 28 }}>{fmtIDR(sum.total)}</span>
          </div>
          <p className="text-dim mb-4 flex items-center gap-1" style={{ fontSize: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>bed</span>
            {payOptions.length > 1 ? 'Charge to your room, or pay cash / card on delivery' : `Charged to your room${menu.pos ? ' once the restaurant confirms' : ''}`}
          </p>
          <button
            onClick={onSend}
            disabled={cart.length === 0 || placing || closed}
            className="w-full rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-2"
            style={{
              padding: '16px 0', fontSize: 14, border: 'none',
              background: cart.length === 0 || placing || closed ? 'var(--surface-2)' : 'var(--accent)',
              color: cart.length === 0 || placing || closed ? 'var(--text-faint)' : 'var(--accent-contrast)',
              cursor: cart.length === 0 || placing || closed ? 'default' : 'pointer',
            }}
          >
            {placing ? 'Sending…' : <>Send order{cart.length > 0 && <span style={{ fontWeight: 600, letterSpacing: 0 }}>· {fmtIDR(sum.total)}</span>}</>}
          </button>
        </div>
      </aside>
    </div>
  );
}
