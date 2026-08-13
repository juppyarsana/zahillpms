import { useState, useEffect } from 'react';

const COLUMNS = [
  { status: 'new', label: 'New', advanceTo: 'preparing', actionLabel: 'Start Preparing' },
  { status: 'preparing', label: 'Preparing', advanceTo: 'ready', actionLabel: 'Mark Ready' },
  { status: 'ready', label: 'Ready', advanceTo: 'served', actionLabel: 'Mark Served' },
];

const ORDER_TYPE_LABELS = { dine_in: 'Dine-in', room_service: 'Room Service', takeaway: 'Takeaway' };

function elapsedLabel(createdAt) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  return mins < 1 ? 'just now' : `${mins} min ago`;
}

function TicketCard({ ticket, onAdvance }) {
  const column = COLUMNS.find(c => c.status === ticket.kitchen_status);
  const destination = ticket.order_type === 'room_service' && ticket.unit_name
    ? `${ticket.unit_name}${ticket.guest_name ? ' · ' + ticket.guest_name : ''}`
    : ticket.order_type === 'dine_in' && ticket.table_number
    ? `Table ${ticket.table_number}`
    : ORDER_TYPE_LABELS[ticket.order_type] || ticket.order_type;
  const stale = Date.now() - new Date(ticket.created_at).getTime() > 20 * 60_000;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: `1px solid ${stale ? 'rgba(220,80,80,0.5)' : 'rgba(255,255,255,0.1)'}`,
      borderRadius: 16, padding: 18, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
          color: '#c9a227', background: 'rgba(201,162,39,0.12)', padding: '4px 10px', borderRadius: 999,
        }}>
          {ORDER_TYPE_LABELS[ticket.order_type] || ticket.order_type}
        </span>
        <span style={{ fontSize: 12, color: stale ? '#e08080' : '#8b8378' }}>{elapsedLabel(ticket.created_at)}</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{destination}</div>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 1.6, color: '#e8e2d8' }}>
        {ticket.items.map((item, i) => (
          <li key={i}>{item.quantity}× {item.name}</li>
        ))}
      </ul>
      {column && (
        <button
          onClick={() => onAdvance(ticket.id, column.advanceTo)}
          style={{
            width: '100%', marginTop: 14, padding: '12px', borderRadius: 10, border: 'none',
            background: '#c9a227', color: '#000', fontWeight: 700, fontSize: 13,
            textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
          }}
        >
          {column.actionLabel}
        </button>
      )}
    </div>
  );
}

export default function TicketBoard({ tickets, onAdvance, onDebugClick }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '20px 28px', height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }} onClick={onDebugClick}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>🍳 Kitchen Display</h1>
        <span style={{ fontSize: 12, color: '#8b8378' }}>{tickets.length} active ticket{tickets.length === 1 ? '' : 's'}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, flex: 1, minHeight: 0 }}>
        {COLUMNS.map(col => {
          const colTickets = tickets.filter(t => t.kitchen_status === col.status);
          return (
            <div key={col.status} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em',
                color: '#8b8378', marginBottom: 12, flexShrink: 0,
              }}>
                {col.label} ({colTickets.length})
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {colTickets.length === 0 && (
                  <div style={{ color: '#5c564e', textAlign: 'center', padding: 32, fontSize: 13 }}>No tickets</div>
                )}
                {colTickets.map(ticket => (
                  <TicketCard key={ticket.id} ticket={ticket} onAdvance={onAdvance} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
