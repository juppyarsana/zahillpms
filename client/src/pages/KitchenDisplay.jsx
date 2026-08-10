import { useState, useEffect } from 'react';
import api from '../services/api';
import { useKitchenTickets } from '../context/KitchenTicketsContext';

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

  return (
    <div className="card mb-3">
      <div className="flex-between">
        <span className="badge badge-gray">{ORDER_TYPE_LABELS[ticket.order_type] || ticket.order_type}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{elapsedLabel(ticket.created_at)}</span>
      </div>
      <div style={{ fontWeight: 700, margin: '6px 0' }}>{destination}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {ticket.items.map((item, i) => (
          <li key={i}>{item.quantity}× {item.name}</li>
        ))}
      </ul>
      {column && (
        <button className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
          onClick={() => onAdvance(ticket.id, column.advanceTo)}>
          {column.actionLabel}
        </button>
      )}
    </div>
  );
}

export default function KitchenDisplay() {
  const { tickets, refetch } = useKitchenTickets();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  async function advance(id, status) {
    await api.patch(`/api/kitchen/${id}/status`, { status });
    refetch();
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">🍳 Kitchen Display</div>
      </div>

      <div className="grid-3" style={{ gap: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {COLUMNS.map(col => {
          const colTickets = tickets.filter(t => t.kitchen_status === col.status);
          return (
            <div key={col.status}>
              <div className="card-title" style={{ marginBottom: 8 }}>{col.label} ({colTickets.length})</div>
              {colTickets.length === 0 && (
                <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>No tickets</div>
              )}
              {colTickets.map(ticket => (
                <TicketCard key={ticket.id} ticket={ticket} onAdvance={advance} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
