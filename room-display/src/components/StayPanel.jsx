
function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function StayPanel({ unit, booking, relays, controller }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn  = new Date(booking.check_in_date);
  const checkOut = new Date(booking.check_out_date);
  const totalNights   = Math.round((checkOut - checkIn)  / 86_400_000);
  const nightsLeft    = Math.round((checkOut - today)    / 86_400_000);

  const activeRelays = relays.filter(r => r.state === true && r.enabled !== false);

  return (
    <section
      className="w-[420px] shrink-0 flex flex-col border-r border-white/5 p-10"
      style={{ background: 'rgba(14,17,23,0.5)' }}
    >
      <header className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.3em] mb-1" style={{ color: '#c5a358' }}>Reservation</p>
        <h2 className="text-3xl font-extralight text-white leading-tight">Your Stay</h2>
        <p className="text-slate-400 mt-1 text-sm">Welcome, {booking.guest_name}</p>
      </header>

      {/* Unit card */}
      <div className="relative h-40 rounded-3xl overflow-hidden mb-5 flex items-end" style={{ background: 'rgba(255,255,255,0.03)' }}>
        <div className="absolute inset-0 flex items-center justify-center opacity-10">
          <span className="material-symbols-outlined" style={{ fontSize: '9rem', color: '#c5a358' }}>home</span>
        </div>
        <div
          className="absolute inset-0 flex flex-col justify-end p-6"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)' }}
        >
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest text-black mb-3 w-fit"
            style={{ background: 'rgba(197,163,88,0.9)' }}
          >
            {unit.name}
          </span>
          <h3 className="text-xl font-semibold text-white">Birdnest Glamping</h3>
          <p className="text-xs text-slate-400 mt-0.5">Kintamani · Bali</p>
        </div>
      </div>

      {/* Check-in / Check-out */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="glass-card p-5 rounded-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">Check-in</p>
          <p className="text-3xl font-light text-white">{fmt(booking.check_in_date)}</p>
          <p className="text-[11px] mt-2" style={{ color: '#c5a358' }}>After 14:00</p>
        </div>
        <div className="glass-card p-5 rounded-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">Check-out</p>
          <p className="text-3xl font-light text-white">{fmt(booking.check_out_date)}</p>
          <p className="text-[11px] mt-2" style={{ color: '#c5a358' }}>Before 12:00</p>
        </div>
      </div>

      {/* Stay duration */}
      <div className="glass-card rounded-2xl px-5 py-3 flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-xl" style={{ color: '#c5a358' }}>nights_stay</span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Duration</p>
            <p className="text-white text-sm">{totalNights} night{totalNights !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Remaining</p>
          <p className="font-bold" style={{ color: '#c5a358' }}>{nightsLeft} night{nightsLeft !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Active devices */}
      <div className="mt-auto">
        <div className="flex items-center justify-between text-[10px] text-slate-600 mb-3 uppercase tracking-widest font-bold">
          <span>Active Devices</span>
          {controller?.connected && (
            <span style={{ color: '#c5a358' }}>{activeRelays.length} On</span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {!controller?.connected ? (
            <div className="flex items-center gap-2 text-slate-700">
              <span className="material-symbols-outlined text-sm">wifi_off</span>
              <span className="text-[10px] uppercase tracking-wider">Controller offline</span>
            </div>
          ) : activeRelays.length === 0 ? (
            <span className="text-[10px] uppercase tracking-wider text-slate-700">All off</span>
          ) : (
            activeRelays.map(r => (
              <div
                key={r.relay_num}
                className="w-10 h-10 glass-card rounded-lg flex items-center justify-center text-slate-300"
                title={r.label || `Relay ${r.relay_num}`}
              >
                <span className="material-symbols-outlined text-lg">
                  {r.icon || 'power'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
