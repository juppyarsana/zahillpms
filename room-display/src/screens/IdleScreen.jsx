import { useState, useEffect } from 'react';
import api from '../api';
import RelayControls from '../components/RelayControls';
import RGBPicker from '../components/RGBPicker';
import IRControls from '../components/IRControls';
import Clock from '../components/Clock';

export default function IdleScreen({ unit, controller, relays = [], roomId, onRefresh, onDebugClick }) {
  const [activeTab, setActiveTab] = useState('idle');
  const [localRelays, setLocalRelays] = useState(relays);

  const handleRelayToggle = async (relayNum, newState) => {
    setLocalRelays(prev =>
      prev.map(r => r.relay_num === relayNum ? { ...r, state: newState } : r)
    );
    try {
      await api.post(`/room/${roomId}/relay`, { relay_num: relayNum, state: newState });
    } catch {
      setLocalRelays(relays);
    }
  };

  const handleRGB = async (r, g, b) => {
    try { await api.post(`/room/${roomId}/rgb`, { r, g, b }); } catch {}
  };

  const handleIR = async (slot) => {
    try { await api.post(`/room/${roomId}/ir`, { slot }); } catch {}
  };

  const navItems = [
    { id: 'idle',     icon: 'home',         label: 'Home'     },
    { id: 'controls', icon: 'auto_fix_high', label: 'Controls' },
  ];

  return (
    <div className="w-screen h-screen bg-bg-dark flex overflow-hidden relative">
      {/* Ambient glows */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(197,163,88,0.05)' }} />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(197,163,88,0.05)' }} />

      {/* Sidebar */}
      <aside className="w-20 bg-sidebar-dark border-r border-white/5 flex flex-col items-center py-8 z-20 shrink-0">
        <div className="mb-10" onClick={onDebugClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <img src="/logo.png" alt="Zahill" style={{ width: 52, height: 52, objectFit: 'contain' }} />
        </div>
        <nav className="flex flex-col gap-8 flex-1">
          {navItems.map(item => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="flex flex-col items-center gap-1.5 w-full relative transition-colors"
                style={{ color: active ? '#c5a358' : '#64748b' }}
              >
                <span className={`material-symbols-outlined text-2xl${active ? ' filled' : ''}`}>
                  {item.icon}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider">{item.label}</span>
                {active && (
                  <span
                    className="absolute right-0 rounded-l"
                    style={{ background: '#c5a358', top: '20%', bottom: '20%', width: '3px' }}
                  />
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto">
          <Clock compact />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'idle' ? (
          <IdleView unit={unit} controller={controller} />
        ) : (
          <ControlsView
            relays={localRelays}
            controller={controller}
            onToggle={handleRelayToggle}
            onRGB={handleRGB}
            onIR={handleIR}
          />
        )}
      </main>
    </div>
  );
}

function IdleView({ unit, controller }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h     = time.getHours().toString().padStart(2, '0');
  const m     = time.getMinutes().toString().padStart(2, '0');
  const ampm  = time.getHours() >= 12 ? 'PM' : 'AM';
  const dateStr = time.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 text-center">
        <img src="/logo.png" alt="Zahill" style={{ width: 180, height: 180, objectFit: 'contain' }} />

        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-slate-700">{dateStr}</p>

        <div className="flex items-end gap-3 leading-none">
          <span className="text-9xl font-extralight text-white tracking-tighter">{h}:{m}</span>
          <span className="text-3xl font-bold mb-2" style={{ color: '#c5a358' }}>{ampm}</span>
        </div>

        <div className="flex flex-col items-center gap-2 mt-2">
          <h1 className="text-4xl font-extralight text-white">{unit?.name || 'Zahill Glamping'}</h1>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-600">Kintamani · Bali</p>
        </div>

        <div className="glass-card rounded-2xl px-8 py-4 flex items-center gap-3 mt-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Ready for Guests</span>
        </div>

        {controller && !controller.connected && (
          <p className="text-[10px] uppercase tracking-widest text-slate-700 mt-2">Room controller offline</p>
        )}
      </div>
    </div>
  );
}

function ControlsView({ relays, controller, onToggle, onRGB, onIR }) {
  return (
    <div className="h-full p-10 overflow-y-auto flex flex-col gap-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-extralight text-white mb-1">Room Controls</h2>
          <p className="text-slate-500 text-sm">Prepare the room before guest arrival.</p>
        </div>
        {controller && (
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: controller.connected ? '#22c55e' : '#475569' }}
            />
            <span className="text-[10px] uppercase tracking-widest text-slate-600">
              {controller.connected ? 'Controller online' : 'Controller offline'}
            </span>
          </div>
        )}
      </div>
      <RelayControls relays={relays} onToggle={onToggle} />
      <div className="grid grid-cols-2 gap-5">
        <RGBPicker onSet={onRGB} currentRgb={controller?.rgb} />
        <IRControls onSend={onIR} large />
      </div>
    </div>
  );
}
