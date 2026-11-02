import { fmtQty } from '../lib/units';

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');

// What the kitchen said about each delivery of a restaurant line (migration 152).
export default function HandoverLines({ handovers, unit }) {
  return (handovers || []).map(h => {
    const sent = Number(h.sent_qty);
    if (h.accepted_qty == null) return <div key={h.id} style={{ fontSize: 11, color: '#B45309' }}>Waiting for the kitchen · {fmtQty(sent, unit)}</div>;
    const got = Number(h.accepted_qty);
    if (got >= sent) return <div key={h.id} style={{ fontSize: 11, color: '#16A34A' }}>Kitchen got all {fmtQty(sent, unit)}{h.note ? ` · ${h.note}` : ''}</div>;
    return (
      <div key={h.id} style={{ fontSize: 11, color: 'var(--danger-text)' }}>
        Kitchen got {fmtQty(got, unit)} of {fmtQty(sent, unit)}{h.note ? ` · ${h.note}` : ''} · short {fmtIDR((sent - got) * Number(h.unit_cost))}
      </div>
    );
  });
}
