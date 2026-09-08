import { useState } from 'react';

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// Persistent order/checkout panel — used by both the guest QR screen (below
// the menu, mobile) and the staff Take Order screen (a sticky sidebar next
// to the menu, POS-style). cart is a Map<product_id, quantity>, menuById a
// Map<product_id, product>.
export default function CartPanel({ cart, menuById, paymentMethods, onSubmit, submitting, error }) {
  const [paymentMethod, setPaymentMethod] = useState('');

  const lines = [...cart.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ product: menuById.get(id), qty }))
    .filter(l => l.product);
  const total = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);

  return (
    <div className="h-full flex flex-col bg-surface border border-app rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-app-soft">
        <div className="text-xs font-bold uppercase tracking-[0.15em] text-dim">Current Order</div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {lines.length === 0 && <p className="text-sm text-dim">Add items from the menu to get started.</p>}
        <div className="flex flex-col gap-3">
          {lines.map(l => (
            <div key={l.product.id} className="flex justify-between items-start gap-2 text-sm">
              <span className="text-ink">{l.qty}× {l.product.name}</span>
              <span className="text-muted flex-shrink-0">{fmtIDR(l.product.price * l.qty)}</span>
            </div>
          ))}
        </div>
      </div>

      {lines.length > 0 && (
        <div className="border-t border-app-soft px-5 py-4 flex flex-col gap-3">
          <div className="flex justify-between items-baseline">
            <span className="text-sm font-bold text-ink">Total</span>
            <span className="text-lg font-bold text-accent">{fmtIDR(total)}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-dim">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none"
            >
              <option value="" style={{ color: '#000' }}>Select…</option>
              {paymentMethods.map(pm => <option key={pm.id} value={pm.id} style={{ color: '#000' }}>{pm.label}</option>)}
            </select>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <button
            disabled={!paymentMethod || submitting}
            onClick={() => onSubmit(lines, paymentMethod)}
            className={
              'w-full rounded-xl py-3.5 text-sm font-bold uppercase tracking-wide transition-colors ' +
              (!paymentMethod || submitting
                ? 'bg-accent-dim text-muted cursor-not-allowed'
                : 'bg-accent text-[color:var(--accent-contrast)] cursor-pointer')
            }
          >
            {submitting ? 'Sending…' : 'Place Order'}
          </button>
        </div>
      )}
    </div>
  );
}
