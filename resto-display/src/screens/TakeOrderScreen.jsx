import { useState, useEffect } from 'react';
import api from '../api';
import { useRestoContext } from '../context/RestoContext';
import MenuGrid from '../components/MenuGrid';
import CartPanel from '../components/CartPanel';

export default function TakeOrderScreen() {
  const context = useRestoContext();
  const [menu, setMenu] = useState([]);
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState(''); // '' = takeaway
  const [cart, setCart] = useState(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: t }] = await Promise.all([
        api.get('/resto/menu'),
        api.get('/resto/tables'),
      ]);
      setMenu(m);
      setTables(t);
    })();
  }, []);

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
      await api.post('/resto/orders', {
        table_id: tableId || null,
        order_type: tableId ? 'dine_in' : 'takeaway',
        payment_method: paymentMethod,
        items: lines.map(l => ({ product_id: l.product.id, quantity: l.qty })),
      });
      setCart(new Map());
      setPlaced(true);
      setTimeout(() => setPlaced(false), 2500);
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Could not place the order.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!context) return <p className="p-6 text-dim text-sm">Loading…</p>;

  const menuById = new Map(menu.map(p => [p.id, p]));

  return (
    <div className="h-full flex flex-col lg:flex-row gap-5 p-5">
      {/* Menu — main area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h1 className="text-xl font-light text-ink">Take Order</h1>
          <select
            value={tableId}
            onChange={e => setTableId(e.target.value)}
            className="bg-surface border border-app rounded-lg px-3 py-2 text-sm text-ink outline-none min-w-[160px]"
          >
            <option value="" style={{ color: '#000' }}>Takeaway</option>
            {tables.map(t => (
              <option key={t.id} value={t.id} style={{ color: '#000' }}>{t.name}{t.session ? ' (open tab)' : ''}</option>
            ))}
          </select>
        </div>

        {placed && (
          <div className="mb-4 rounded-xl bg-ok-soft border border-ok-soft px-4 py-2.5 text-sm text-ok font-semibold">
            Order sent to the kitchen.
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1">
          <MenuGrid menu={menu} cart={cart} onAdd={addItem} onRemove={removeItem} />
        </div>
      </div>

      {/* Cart — persistent sidebar on wide screens, stacked below on narrow */}
      <div className="w-full lg:w-[340px] flex-shrink-0 lg:sticky lg:top-5 lg:h-[calc(100vh-40px)]">
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
