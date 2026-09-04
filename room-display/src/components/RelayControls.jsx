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
              background: 'rgb(var(--accent-rgb) / 0.12)',
              border: '1px solid rgb(var(--accent-rgb) / 0.4)',
            } : {
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div
              className={`rounded-xl flex items-center justify-center ${large ? 'w-14 h-14' : 'w-11 h-11'}`}
              style={{ background: relay.state ? 'rgb(var(--accent-rgb) / 0.2)' : 'var(--surface-2)' }}
            >
              <span
                className={`material-symbols-outlined ${large ? 'text-3xl' : 'text-2xl'}${relay.state && !isPending ? ' filled' : ''} ${isPending ? 'animate-spin' : ''}`}
                style={{ color: isPending ? 'var(--accent)' : relay.state ? 'var(--accent)' : 'var(--text-dim)' }}
              >
                {isPending ? 'progress_activity' : relay.icon}
              </span>
            </div>
            <div className="text-center px-1">
              <p className={`font-semibold ${large ? 'text-sm' : 'text-xs'} ${relay.state ? 'text-ink' : 'text-muted'}`}>
                {relay.label}
              </p>
              <p
                className="text-[9px] font-bold uppercase tracking-widest mt-0.5"
                style={{ color: isPending ? 'var(--accent)' : relay.state ? 'var(--accent)' : 'var(--text-ghost)' }}
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
