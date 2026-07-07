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
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(201,162,39,0.1)' }}>
          <span className="material-symbols-outlined text-xl" style={{ color: '#c9a227' }}>ac_unit</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Air Conditioning</h3>
          <p className="text-[10px] text-slate-500">IR remote control</p>
        </div>
        {lastAction && (
          <span
            className="ml-auto text-[10px] font-bold uppercase tracking-widest"
            style={{ color: lastAction === 'on' ? '#c9a227' : '#475569' }}
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
            background: 'rgba(201,162,39,0.18)',
            border: '1px solid rgba(201,162,39,0.45)',
            color: '#c9a227',
          } : {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#64748b',
          }}
        >
          <span className="material-symbols-outlined text-xl">power</span>
          AC On
        </button>
        <button
          onClick={() => handleSend(1, 'off')}
          className="flex items-center justify-center gap-2 rounded-2xl font-semibold text-sm transition-all active:scale-95"
          style={lastAction === 'off' ? {
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#cbd5e1',
          } : {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#64748b',
          }}
        >
          <span className="material-symbols-outlined text-xl">power_off</span>
          AC Off
        </button>
      </div>
    </div>
  );
}
