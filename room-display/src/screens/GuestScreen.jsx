import { useState, useEffect } from 'react';
import api from '../api';
import StayPanel from '../components/StayPanel';
import RelayControls from '../components/RelayControls';
import RGBPicker from '../components/RGBPicker';
import IRControls from '../components/IRControls';
import Clock from '../components/Clock';
import ExploreTab from '../components/ExploreTab';

const EXPLORE_TABS = [
  { key: 'activity', icon: 'hiking',      label: 'Activities' },
  { key: 'dining',   icon: 'restaurant',  label: 'Dining'     },
  { key: 'property', icon: 'home',        label: 'Property'   },
];

export default function GuestScreen({ unit, booking, relays, controller, roomId, weather, cards = [], onRefresh, onDebugClick }) {
  const [activeTab, setActiveTab] = useState('controls');
  const [localRelays, setLocalRelays] = useState(relays);
  const [pendingRelays, setPendingRelays] = useState(new Set());

  useEffect(() => {
    setLocalRelays(relays);
    setPendingRelays(new Set());
  }, [relays]);

  const handleRelayToggle = async (relayNum, newState) => {
    setLocalRelays(prev => prev.map(r => r.relay_num === relayNum ? { ...r, state: newState } : r));
    setPendingRelays(prev => new Set([...prev, relayNum]));
    try {
      await api.post(`/room/${roomId}/relay`, { relay_num: relayNum, state: newState });
    } catch {
      setLocalRelays(relays);
      setPendingRelays(prev => { const next = new Set(prev); next.delete(relayNum); return next; });
    }
  };

  const handleRGB = async (r, g, b) => {
    try { await api.post(`/room/${roomId}/rgb`, { r, g, b }); } catch {}
  };

  const handleIR = async (slot) => {
    try { await api.post(`/room/${roomId}/ir`, { slot }); } catch {}
  };

  // Only show explore tabs that have cards
  const visibleExploreTabs = EXPLORE_TABS.filter(t => cards.some(c => c.category === t.key));

  return (
    <div className="w-screen h-screen bg-bg-dark flex overflow-hidden relative">
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(201,162,39,0.05)' }} />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(201,162,39,0.05)' }} />

      {/* Sidebar */}
      <aside className="w-20 bg-sidebar-dark border-r border-white/5 flex flex-col items-center py-8 z-20 shrink-0">
        <div className="mb-6" onClick={onDebugClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <img src="/logo.png" alt="Zahill" style={{ width: 52, height: 52, objectFit: 'contain' }} />
        </div>

        {/* Controls — top zone */}
        <div style={{ width: '100%', padding: '0 8px' }}>
          <NavBtn id="controls" active={activeTab === 'controls'} icon="auto_fix_high" label="Controls" onClick={() => setActiveTab('controls')} />
        </div>

        {/* Separator */}
        <div style={{ width: 32, height: 1, background: 'rgba(255,255,255,0.07)', margin: '12px auto' }} />

        {/* Explore tabs — bottom zone, grows to fill space */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', padding: '0 8px', flex: 1 }}>
          {visibleExploreTabs.map(t => (
            <NavBtn key={t.key} id={t.key} active={activeTab === t.key} icon={t.icon} label={t.label} onClick={() => setActiveTab(t.key)} />
          ))}
          {visibleExploreTabs.length === 0 && (
            <div style={{ fontSize: 9, color: '#2a3441', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '8px 0' }}>
              No content
            </div>
          )}
        </div>

        <div className="mt-auto">
          <Clock compact />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'controls' ? (
          <>
            <StayPanel unit={unit} booking={booking} relays={localRelays} controller={controller} />
            <section className="flex-1 p-10 bg-bg-dark overflow-y-auto">
              <div className="h-full flex flex-col gap-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-3xl font-extralight text-white mb-1">Room Controls</h2>
                    <p className="text-slate-500 text-sm">Manage lighting, ambiance, and climate.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {controller && (
                      <>
                        <span className="w-2 h-2 rounded-full" style={{ background: controller.connected ? '#22c55e' : '#475569' }} />
                        <span className="text-[10px] uppercase tracking-widest text-slate-600">
                          {controller.connected ? 'Online' : 'Offline'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <RelayControls relays={localRelays} onToggle={handleRelayToggle} pendingNums={pendingRelays} large />
                <div className="grid grid-cols-2 gap-5">
                  <RGBPicker onSet={handleRGB} currentRgb={controller?.rgb} />
                  <IRControls onSend={handleIR} large />
                </div>
              </div>
            </section>
          </>
        ) : (
          <ExploreTab
            weather={weather}
            cards={cards}
            activeCategory={activeTab}
          />
        )}
      </main>
    </div>
  );
}

function NavBtn({ active, icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        background: active ? 'rgba(201,162,39,0.12)' : 'none',
        border: 'none', cursor: 'pointer',
        color: active ? '#c9a227' : '#64748b',
        fontFamily: 'inherit', fontSize: 9, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        padding: '10px 4px', width: '100%', position: 'relative',
        borderRadius: 10, transition: 'color 0.2s, background 0.2s',
      }}
    >
      <span className={`material-symbols-outlined text-xl${active ? ' filled' : ''}`}>{icon}</span>
      {label}
      {active && (
        <span style={{
          position: 'absolute', right: -8, top: '25%', bottom: '25%',
          width: 3, background: '#c9a227', borderRadius: '2px 0 0 2px',
        }} />
      )}
    </button>
  );
}
