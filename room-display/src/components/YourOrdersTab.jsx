function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

const FOOD_STATUS = {
  new:       { label: 'New',       color: '#818cf8' },
  preparing: { label: 'Preparing', color: '#fb923c' },
  ready:     { label: 'Ready',     color: '#4ade80' },
  served:    { label: 'Served',    color: '#64748b' },
};
const ACTIVITY_STATUS = {
  requested: { label: 'Requested', color: '#fb923c' },
  confirmed: { label: 'Confirmed', color: '#4ade80' },
  completed: { label: 'Completed', color: '#64748b' },
  cancelled: { label: 'Cancelled', color: '#f87171' },
  no_show:   { label: 'No-show',   color: '#f87171' },
};

function StatusBadge({ label, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
      color, border: `1px solid ${color}55`, background: `${color}18`,
      borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function fmtScheduled(date, time) {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return time ? `${dateStr}, ${time.slice(0, 5)}` : dateStr;
}

export default function YourOrdersTab({ foodOrders = [], activityBookings = [], onRefresh }) {
  const empty = foodOrders.length === 0 && activityBookings.length === 0;

  return (
    <section className="flex-1 p-10 bg-bg-dark overflow-y-auto">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-extralight text-white mb-1">Your Orders</h2>
          <p className="text-slate-500 text-sm">Food orders and activity bookings for this stay.</p>
        </div>
        <button
          onClick={onRefresh}
          className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400"
          style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', flexShrink: 0 }}
        >
          <span className="material-symbols-outlined text-lg">refresh</span>
        </button>
      </div>

      {empty && <p className="text-slate-500 text-sm">Nothing ordered or booked yet.</p>}

      {foodOrders.length > 0 && (
        <div className="mb-10">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-4">Food Orders</h3>
          <div className="flex flex-col gap-3">
            {foodOrders.map(o => {
              const status = FOOD_STATUS[o.kitchen_status] || { label: 'Placed', color: '#64748b' };
              return (
                <div key={o.id} className="glass-card rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <span className="text-white text-sm font-medium">
                      {o.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}
                    </span>
                    <StatusBadge {...status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 text-xs">
                      {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-slate-300 text-sm">{fmtIDR(o.total_amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activityBookings.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-4">Activity Bookings</h3>
          <div className="flex flex-col gap-3">
            {activityBookings.map(b => {
              const status = ACTIVITY_STATUS[b.status] || { label: b.status, color: '#64748b' };
              return (
                <div key={b.id} className="glass-card rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <span className="text-white text-sm font-medium">{b.activity_name}</span>
                    <StatusBadge {...status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 text-xs">
                      {fmtScheduled(b.scheduled_date, b.scheduled_time)} · {b.num_participants} {b.num_participants === 1 ? 'person' : 'people'}
                    </span>
                    <span className="text-slate-300 text-sm">{fmtIDR(b.total_amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
