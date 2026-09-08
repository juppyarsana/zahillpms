import { useState, useMemo } from 'react';

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// POS-style category tabs + product tile grid — used by both the guest QR
// screen and the staff Take Order screen. cart is a Map<product_id, quantity>.
export default function MenuGrid({ menu, cart, onAdd, onRemove }) {
  const categories = useMemo(() => [...new Set(menu.map(p => p.category))], [menu]);
  const [active, setActive] = useState(categories[0] || null);
  const currentCat = categories.includes(active) ? active : categories[0];
  const items = menu.filter(p => p.category === currentCat);

  if (menu.length === 0) return <p className="text-dim text-sm">Nothing available right now.</p>;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4 border-b border-app-soft">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActive(cat)}
            className={
              'flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ' +
              (cat === currentCat ? 'bg-accent text-[color:var(--accent-contrast)]' : 'bg-surface text-muted hover:text-ink')
            }
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {items.map(p => {
          const qty = cart.get(p.id) || 0;
          return (
            <div
              key={p.id}
              className={
                'relative rounded-2xl border p-4 flex flex-col gap-2 transition-colors ' +
                (qty > 0 ? 'border-accent bg-surface-2' : 'border-app bg-surface')
              }
            >
              <div className="text-sm font-semibold text-ink leading-snug">{p.name}</div>
              {p.description && <div className="text-xs text-dim line-clamp-2">{p.description}</div>}
              <div className="text-sm text-accent font-bold mt-auto">{fmtIDR(p.price)}</div>

              {qty === 0 ? (
                <button
                  onClick={() => onAdd(p.id)}
                  className="mt-1 w-full rounded-xl bg-surface-2 hover:bg-accent hover:text-[color:var(--accent-contrast)] text-ink text-xs font-bold uppercase tracking-wide py-2 transition-colors"
                >
                  Add
                </button>
              ) : (
                <div className="mt-1 flex items-center justify-between rounded-xl bg-accent text-[color:var(--accent-contrast)] px-2 py-1">
                  <button onClick={() => onRemove(p.id)} className="w-7 h-7 flex items-center justify-center font-bold text-lg">−</button>
                  <span className="font-bold text-sm">{qty}</span>
                  <button onClick={() => onAdd(p.id)} className="w-7 h-7 flex items-center justify-center font-bold text-lg">+</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
