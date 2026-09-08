import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import guestApi from '../guestApi';
import MenuGrid from '../components/MenuGrid';
import CartPanel from '../components/CartPanel';

const POLL_MS = 15_000;

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

const FOOD_STATUS = {
  new: 'New', preparing: 'Preparing', ready: 'Ready', served: 'Served',
};
function resolveStatus(o) {
  if (o.confirmation_status === 'pending') return 'Awaiting confirmation';
  if (o.confirmation_status === 'rejected') return 'Declined';
  return FOOD_STATUS[o.kitchen_status] || 'Placed';
}

// Public guest QR surface — no login. authTableQR (server side) resolves the
// path token to one table; this screen never persists the qr_token itself,
// only the session_id it gets back after ordering, and only in
// sessionStorage (tab-scoped) so a guest's phone doesn't retain table access
// after they leave.
export default function GuestOrderScreen() {
  const { qrToken } = useParams();
  const storageKey = `resto:${qrToken}:session`;

  const [context, setContext] = useState(null);
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState(new Map());
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem(storageKey));
  const [orderState, setOrderState] = useState(null); // null | {status, orders, total}
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: ctx }, { data: m }] = await Promise.all([
          guestApi.get(`/${qrToken}/context`),
          guestApi.get(`/${qrToken}/menu`),
        ]);
        setContext(ctx);
        setMenu(m);
        if (ctx.session) { setSessionId(ctx.session.id); sessionStorage.setItem(storageKey, ctx.session.id); }
      } catch (err) {
        const status = err.response?.status;
        if (status === 401) setLoadError('This QR code is no longer valid — please ask a staff member.');
        else if (status === 403) setLoadError("Ordering isn't available right now.");
        else setLoadError('Could not load the menu. Please try again.');
      }
    })();
  }, [qrToken]);

  const pollOrders = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data } = await guestApi.get(`/${qrToken}/orders`, { params: { session_id: sessionId } });
      if (data.status === 'closed') {
        sessionStorage.removeItem(storageKey);
        setSessionId(null);
      }
      setOrderState(data);
    } catch { /* keep last known state */ }
  }, [qrToken, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    pollOrders();
    pollRef.current = setInterval(pollOrders, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [sessionId, pollOrders]);

  function addItem(id) { setCart(prev => new Map(prev).set(id, (prev.get(id) || 0) + 1)); }
  function removeItem(id) {
    setCart(prev => {
      const next = new Map(prev);
      const qty = (next.get(id) || 0) - 1;
      if (qty <= 0) next.delete(id); else next.set(id, qty);
      return next;
    });
  }

  async function handleSubmit(lines, paymentMethod) {
    setSubmitting(true);
    setSubmitError('');
    try {
      const { data } = await guestApi.post(`/${qrToken}/order`, {
        items: lines.map(l => ({ product_id: l.product.id, quantity: l.qty })),
        payment_method: paymentMethod,
      });
      sessionStorage.setItem(storageKey, data.session_id);
      setSessionId(data.session_id);
      setCart(new Map());
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Could not place your order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div style={{ width: '100vw', minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', background: '#0d0709', color: '#f5f1ea', fontFamily: "'Manrope', sans-serif" }}>
        <img src="/logo.png" alt="" style={{ width: 56, height: 56, objectFit: 'contain', opacity: 0.4 }} />
        <p style={{ fontSize: 13, color: '#8b8378' }}>{loadError}</p>
      </div>
    );
  }

  if (!context) {
    return <div style={{ width: '100vw', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0709' }}><p style={{ color: '#8b8378', fontSize: 13 }}>Loading…</p></div>;
  }

  const menuById = new Map(menu.map(p => [p.id, p]));

  return (
    <div style={{ width: '100vw', minHeight: '100dvh', padding: '24px 16px 48px', background: '#0d0709', color: '#f5f1ea', fontFamily: "'Manrope', sans-serif" }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        {context.property?.logo_url && (
          <img src={context.property.logo_url} alt="" style={{ width: 48, height: 48, objectFit: 'contain', marginBottom: 8 }} />
        )}
        <div style={{ fontSize: 13, color: '#8b8378' }}>{context.property?.name}</div>
        <h1 style={{ fontSize: 22, fontWeight: 300, margin: '4px 0 0' }}>{context.table.name}</h1>
      </div>

      {sessionId && orderState?.orders?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#8b8378', marginBottom: 10 }}>
            Your Order So Far
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orderState.orders.map(o => (
              <div key={o.id} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 13 }}>{o.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</span>
                <span style={{ fontSize: 11, color: '#c9a227', flexShrink: 0, marginLeft: 10 }}>{resolveStatus(o)}</span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'right', fontSize: 13, color: '#8b8378', marginTop: 8 }}>
            Running total: <span style={{ color: '#c9a227', fontWeight: 700 }}>{fmtIDR(orderState.total)}</span>
          </div>
        </div>
      )}

      <MenuGrid menu={menu} cart={cart} onAdd={addItem} onRemove={removeItem} />

      <div style={{ marginTop: 24 }}>
        <CartPanel
          cart={cart}
          menuById={menuById}
          paymentMethods={context.payment_methods}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={submitError}
        />
      </div>
    </div>
  );
}
