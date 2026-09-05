import QuickActions from './QuickActions';

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function StayPanel({
  unit, booking, relays, controller, property, roomControllerEnabled,
  roomId, operationsEnabled, callingEnabled, onCallFrontDesk, callActive,
  alarmTime, alarmEnabled, onSetAlarm,
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn  = new Date(booking.check_in_date);
  const checkOut = new Date(booking.check_out_date);
  const totalNights   = Math.round((checkOut - checkIn)  / 86_400_000);
  const nightsLeft    = Math.round((checkOut - today)    / 86_400_000);

  const activeRelays = relays.filter(r => r.state === true && r.enabled !== false);

  return (
    <section
      className="w-[420px] shrink-0 flex flex-col border-r border-app-soft p-4 bg-pane overflow-y-auto"
    >
      <header className="mb-2">
        <p className="text-xs font-bold uppercase tracking-[0.3em] mb-0.5 text-accent">Reservation</p>
        <h2 className="text-xl font-extralight text-ink leading-tight">Your Stay</h2>
        <p className="text-muted mt-0.5 text-sm">Welcome, {booking.guest_name}</p>
      </header>

      <div className="flex-1 flex flex-col gap-1.5">
        {/* Unit card */}
        <div
          className="relative h-20 rounded-3xl overflow-hidden flex items-end"
          style={{
            background: 'linear-gradient(135deg, rgb(var(--accent-rgb) / 0.18), var(--pane) 65%)',
            border: '1px solid rgb(var(--accent-rgb) / 0.16)',
            boxShadow: '0 12px 28px -8px rgb(var(--accent-rgb) / 0.18)',
          }}
        >
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-2xl pointer-events-none" style={{ background: 'rgb(var(--accent-rgb) / 0.22)' }} />
          <span
            className="material-symbols-outlined text-accent absolute pointer-events-none"
            style={{ top: 2, right: 8, fontSize: '3.75rem', opacity: 0.16, transform: 'rotate(-8deg)' }}
          >
            villa
          </span>
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center p-2"
            style={{ background: 'radial-gradient(ellipse at center, var(--scrim) 0%, transparent 72%)' }}
          >
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-extrabold uppercase tracking-widest mb-1 w-fit bg-accent"
              style={{ color: 'var(--accent-contrast)', boxShadow: '0 4px 14px rgb(var(--accent-rgb) / 0.4)' }}
            >
              {unit.name}
            </span>
            <h3 className="text-base text-ink" style={{ fontFamily: 'var(--font-brand)', fontWeight: 700 }}>{property?.name || ''}</h3>
            {property?.location && (
              <p className="text-[11px] text-muted mt-0.5 flex items-center justify-center gap-1">
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>location_on</span>
                {property.location}
              </p>
            )}
          </div>
        </div>

        {/* Check-in / Check-out */}
        <div className="grid grid-cols-2 gap-2">
          <div className="glass-card p-3 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-dim mb-1.5">Check-in</p>
            <p className="text-xl font-light text-ink">{fmt(booking.check_in_date)}</p>
            <p className="text-[11px] mt-1 text-accent">After 14:00</p>
          </div>
          <div className="glass-card p-3 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-dim mb-1.5">Check-out</p>
            <p className="text-xl font-light text-ink">{fmt(booking.check_out_date)}</p>
            <p className="text-[11px] mt-1 text-accent">Before 12:00</p>
          </div>
        </div>

        {/* Stay duration */}
        <div className="glass-card rounded-2xl px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-xl text-accent">nights_stay</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-dim">Duration</p>
              <p className="text-ink text-sm">{totalNights} night{totalNights !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-dim">Remaining</p>
            <p className="font-bold text-accent">{nightsLeft} night{nightsLeft !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Active devices — only relevant when the property actually has room_controller hardware */}
        {roomControllerEnabled && (
          <div className="glass-card rounded-2xl px-4 py-2">
            <div className="flex items-center justify-between text-[10px] text-faint mb-1.5 uppercase tracking-widest font-bold">
              <span>Active Devices</span>
              {controller?.connected && (
                <span className="text-accent">{activeRelays.length} On</span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {!controller?.connected ? (
                <div className="flex items-center gap-2 text-ghost">
                  <span className="material-symbols-outlined text-sm">wifi_off</span>
                  <span className="text-[10px] uppercase tracking-wider">Controller offline</span>
                </div>
              ) : activeRelays.length === 0 ? (
                <span className="text-[10px] uppercase tracking-wider text-ghost">All off</span>
              ) : (
                activeRelays.map(r => (
                  <div
                    key={r.relay_num}
                    className="w-10 h-10 glass-card rounded-lg flex items-center justify-center text-muted"
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
        )}

        <QuickActions
          roomId={roomId}
          operationsEnabled={operationsEnabled}
          callingEnabled={callingEnabled}
          onCallFrontDesk={onCallFrontDesk}
          callActive={callActive}
          alarmTime={alarmTime}
          alarmEnabled={alarmEnabled}
          onSetAlarm={onSetAlarm}
        />
      </div>
    </section>
  );
}
