import { useState } from 'react';

// IR slot mapping: 0 = AC On, 1 = AC Off
export default function IRControls({ onSend, large }) {
  const [lastAction, setLastAction] = useState(null);

  const handleSend = async (slot, action) => {
    setLastAction(action);
    await onSend(slot);
  };

  return (
    <div className="glass-card rounded-3xl p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center accent-tint">
          <span className="material-symbols-outlined text-xl text-accent">ac_unit</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink">Air Conditioning</h3>
          <p className="text-[10px] text-dim">IR remote control</p>
        </div>
        {lastAction && (
          <span
            className="ml-auto text-[10px] font-bold uppercase tracking-widest"
            style={{ color: lastAction === 'on' ? 'var(--accent)' : 'var(--text-faint)' }}
          >
            AC {lastAction === 'on' ? 'On' : 'Off'}
          </span>
        )}
      </div>

      <div className={`grid grid-cols-2 gap-3 ${large ? 'h-28' : 'h-16'}`}>
        <button
          onClick={() => handleSend(0, 'on')}
          className="flex items-center justify-center gap-2 rounded-2xl font-semibold text-sm transition-all active:scale-95"
          style={lastAction === 'on' ? {
            background: 'rgb(var(--accent-rgb) / 0.18)',
            border: '1px solid rgb(var(--accent-rgb) / 0.45)',
            color: 'var(--accent)',
          } : {
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
          }}
        >
          <span className="material-symbols-outlined text-xl">power</span>
          AC On
        </button>
        <button
          onClick={() => handleSend(1, 'off')}
          className="flex items-center justify-center gap-2 rounded-2xl font-semibold text-sm transition-all active:scale-95"
          style={lastAction === 'off' ? {
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          } : {
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
          }}
        >
          <span className="material-symbols-outlined text-xl">power_off</span>
          AC Off
        </button>
      </div>
    </div>
  );
}
