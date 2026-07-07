export default function RelayControls({ relays, onToggle, large, pendingNums = new Set() }) {
  const displayRelays = relays
    .filter(relay => relay.enabled !== false)
    .map(relay => ({
      relay_num: relay.relay_num,
      label: relay.label || 'Relay ' + relay.relay_num,
      icon: relay.icon || 'electrical_services',
      state: relay.state === true,
    }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.min(displayRelays.length, 4))}, minmax(0, 1fr))`, gap: '0.75rem' }}>
      {displayRelays.map(relay => {
        const isPending = pendingNums.has(relay.relay_num);
        return (
          <button
            key={relay.relay_num}
            onClick={() => !isPending && onToggle(relay.relay_num, !relay.state)}
            disabled={isPending}
            className={`flex flex-col items-center justify-center gap-3 rounded-3xl transition-all duration-250 select-none ${!isPending ? 'active:scale-95' : 'opacity-70'} ${large ? 'h-44' : 'h-36'}`}
            style={relay.state ? {
              background: 'rgba(201,162,39,0.12)',
              border: '1px solid rgba(201,162,39,0.4)',
            } : {
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div
              className={`rounded-xl flex items-center justify-center ${large ? 'w-14 h-14' : 'w-11 h-11'}`}
              style={{ background: relay.state ? 'rgba(201,162,39,0.2)' : 'rgba(255,255,255,0.05)' }}
            >
              <span
                className={`material-symbols-outlined ${large ? 'text-3xl' : 'text-2xl'}${relay.state && !isPending ? ' filled' : ''} ${isPending ? 'animate-spin' : ''}`}
                style={{ color: isPending ? '#c9a227' : relay.state ? '#c9a227' : '#64748b' }}
              >
                {isPending ? 'progress_activity' : relay.icon}
              </span>
            </div>
            <div className="text-center px-1">
              <p className={`font-semibold ${large ? 'text-sm' : 'text-xs'} ${relay.state ? 'text-white' : 'text-slate-400'}`}>
                {relay.label}
              </p>
              <p
                className="text-[9px] font-bold uppercase tracking-widest mt-0.5"
                style={{ color: isPending ? '#c9a227' : relay.state ? '#c9a227' : '#334155' }}
              >
                {isPending ? 'Pending…' : relay.state ? 'On' : 'Off'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
