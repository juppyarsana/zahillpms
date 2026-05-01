import { useState } from 'react';
import api from '../api';
import StayPanel from '../components/StayPanel';
import RelayControls from '../components/RelayControls';
import RGBPicker from '../components/RGBPicker';
import IRControls from '../components/IRControls';
import Clock from '../components/Clock';

export default function GuestScreen({ unit, booking, relays, controller, roomId, onRefresh, onDebugClick }) {
  const [activeTab, setActiveTab] = useState('stay');
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
    { id: 'stay',     icon: 'calendar_month', label: 'Stay'     },
    { id: 'controls', icon: 'auto_fix_high',  label: 'Controls' },
  ];

  return (
    <div className="w-screen h-screen bg-bg-dark flex overflow-hidden relative">
      {/* Ambient glows */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(197,163,88,0.05)' }} />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(197,163,88,0.05)' }} />

      {/* Sidebar */}
      <aside className="w-20 bg-sidebar-dark border-r border-white/5 flex flex-col items-center py-8 z-20 shrink-0">
        <div className="mb-10" onClick={onDebugClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <span className="material-symbols-outlined text-3xl" style={{ color: '#c5a358' }}>token</span>
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
                    className="absolute right-0 top-1/5 bottom-1/5 w-0.5 rounded-l"
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
      <main className="flex-1 flex overflow-hidden">
        {/* Left panel — always visible */}
        <StayPanel unit={unit} booking={booking} relays={localRelays} controller={controller} />

        {/* Right panel */}
        <section className="flex-1 p-10 bg-bg-dark overflow-y-auto">
          {activeTab === 'stay' ? (
            <div className="h-full flex flex-col gap-6">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-3xl font-extralight text-white mb-1">Room Controls</h2>
                  <p className="text-slate-500 text-sm">Manage lighting, ambiance, and climate.</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Local Time</p>
                  <Clock large />
                </div>
              </div>
              <RelayControls relays={localRelays} onToggle={handleRelayToggle} />
              <IRControls onSend={handleIR} />
            </div>
          ) : (
            <div className="h-full flex flex-col gap-6">
              <div>
                <h2 className="text-3xl font-extralight text-white mb-1">All Controls</h2>
                <p className="text-slate-500 text-sm">Full room control — lighting, ambiance, climate.</p>
              </div>
              <RelayControls relays={localRelays} onToggle={handleRelayToggle} large />
              <div className="grid grid-cols-2 gap-5">
                <RGBPicker onSet={handleRGB} currentRgb={controller?.rgb} />
                <IRControls onSend={handleIR} large />
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
