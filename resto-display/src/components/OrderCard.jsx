import { useState } from 'react';

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function fmtAge(createdAt) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

// One order/ticket card — used by the Confirm Queue (with Confirm/Decline
// actions).
export default function OrderCard({ order, onConfirm, onReject }) {
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try { await onConfirm(order.id); } finally { setBusy(false); }
  }

  async function handleReject() {
    setBusy(true);
    try { await onReject(order.id, reason); } finally { setBusy(false); setShowReject(false); }
  }

  return (
    <div className="rounded-2xl border border-app bg-surface p-4 flex flex-col gap-2.5">
      <div className="flex justify-between items-baseline">
        <div className="text-sm font-bold text-ink">
          {order.unit_name ? `Room ${order.unit_name}` : (order.guest_name || 'Guest')}
        </div>
        <div className="text-xs text-dim flex-shrink-0">{fmtAge(order.created_at)}</div>
      </div>
      {order.guest_name && order.unit_name && (
        <div className="text-xs text-dim -mt-1.5">{order.guest_name}</div>
      )}
      <div className="text-sm text-muted">
        {(order.items || []).map(i => `${i.quantity}× ${i.name}`).join(', ')}
      </div>
      <div className="text-sm font-bold text-accent">{fmtIDR(order.total_amount)}</div>

      {(onConfirm || onReject) && !showReject && (
        <div className="flex gap-2 mt-1">
          {onConfirm && (
            <button disabled={busy} onClick={handleConfirm} className="flex-1 rounded-lg bg-ok text-[#0a0d12] text-xs font-bold py-2.5 disabled:opacity-50">
              Confirm
            </button>
          )}
          {onReject && (
            <button disabled={busy} onClick={() => setShowReject(true)} className="flex-1 rounded-lg bg-danger-soft border border-danger-soft text-danger text-xs font-bold py-2.5">
              Decline
            </button>
          )}
        </div>
      )}

      {showReject && (
        <div className="flex flex-col gap-2">
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="bg-surface-2 border border-app rounded-lg px-2.5 py-2 text-xs text-ink outline-none"
          />
          <div className="flex gap-2">
            <button disabled={busy} onClick={handleReject} className="flex-1 rounded-lg bg-danger text-[#1a0605] text-xs font-bold py-2.5 disabled:opacity-50">
              Confirm Decline
            </button>
            <button disabled={busy} onClick={() => setShowReject(false)} className="flex-1 rounded-lg border border-app text-dim text-xs font-bold py-2.5">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
