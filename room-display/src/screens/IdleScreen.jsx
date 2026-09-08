import { useState, useEffect } from 'react';
import api from '../api';
import RelayControls from '../components/RelayControls';
import RGBPicker from '../components/RGBPicker';
import IRControls from '../components/IRControls';
import CallButton from '../components/CallButton';

export default function IdleScreen({ unit, controller, relays = [], property, roomId, online = true, roomControllerEnabled, callingEnabled, operationsEnabled, housekeepingStatus, onMarkClean, onRefresh, onDebugClick, onCallFrontDesk, callActive }) {
  const [activeTab, setActiveTab] = useState('idle');
  const [localRelays, setLocalRelays] = useState(relays);

  const handleRelayToggle = async (relayNum, newState) => {
    setLocalRelays(prev =>
      prev.map(r => r.relay_num === relayNum ? { ...r, state: newState } : r)
    );
    try {
      await api.post(`/display/room/${roomId}/relay`, { relay_num: relayNum, state: newState });
    } catch {
      setLocalRelays(relays);
    }
  };

  const handleRGB = async (r, g, b) => {
    try { await api.post(`/display/room/${roomId}/rgb`, { r, g, b }); } catch {}
  };

  const handleIR = async (slot) => {
    try { await api.post(`/display/room/${roomId}/ir`, { slot }); } catch {}
  };

  const navItems = [
    { id: 'idle', icon: 'home', label: 'Home' },
    ...(roomControllerEnabled ? [{ id: 'controls', icon: 'auto_fix_high', label: 'Controls' }] : []),
  ];

  return (
    <div className="w-screen h-dvh bg-app flex overflow-hidden relative">
      {/* Ambient glows */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgb(var(--accent-rgb) / 0.05)' }} />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgb(var(--accent-rgb) / 0.05)' }} />

      {/* Sidebar */}
      <aside className="w-24 bg-sidebar border-r border-app-soft flex flex-col items-center py-7 z-20 shrink-0">
        <div className="shrink-0" onClick={onDebugClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <img src={property?.logo_url || '/logo.png'} alt={property?.name || ''} style={{ width: 50, height: 50, objectFit: 'contain' }} />
        </div>
        <nav className="flex-1 min-h-0 w-full flex flex-col justify-center gap-1" style={{ padding: '0 8px' }}>
          {navItems.map(item => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="flex flex-col items-center gap-1.5 w-full relative transition-all"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-dim)',
                  background: active ? 'rgb(var(--accent-rgb) / 0.14)' : 'none',
                  borderRadius: 14, padding: '12px 4px',
                  boxShadow: active ? 'inset 0 0 0 1px rgb(var(--accent-rgb) / 0.28), 0 4px 14px rgb(var(--accent-rgb) / 0.12)' : 'none',
                }}
              >
                <span className={`material-symbols-outlined text-2xl${active ? ' filled' : ''}`}>
                  {item.icon}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider">{item.label}</span>
                {active && (
                  <span
                    className="absolute rounded-l"
                    style={{ background: 'var(--accent)', right: -8, top: '25%', bottom: '25%', width: '3px' }}
                  />
                )}
              </button>
            );
          })}
        </nav>
        <div className="shrink-0 w-full flex flex-col items-center gap-3" style={{ padding: '0 8px' }}>
          {callingEnabled && <CallButton onClick={onCallFrontDesk} disabled={callActive} />}
          <p className="text-ghost text-xs font-mono">{__APP_COMMIT__}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'idle' ? (
          <IdleView
            unit={unit} controller={controller} property={property} online={online}
            roomControllerEnabled={roomControllerEnabled}
            housekeepingDirty={operationsEnabled && housekeepingStatus === 'dirty'}
            onMarkClean={onMarkClean}
          />
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

function IdleView({ unit, controller, property, online, roomControllerEnabled, housekeepingDirty, onMarkClean }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours24 = time.getHours();
  const h     = (hours24 % 12 || 12).toString().padStart(2, '0');
  const m     = time.getMinutes().toString().padStart(2, '0');
  const ampm  = hours24 >= 12 ? 'PM' : 'AM';
  const dateStr = time.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 text-center">
        <img src={property?.logo_url || '/logo.png'} alt={property?.name || ''} style={{ width: 180, height: 180, objectFit: 'contain' }} />

        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-ghost">{dateStr}</p>

        <div className="flex items-end gap-3 leading-none">
          <span className="text-9xl font-extralight text-ink tracking-tighter">{h}:{m}</span>
          <span className="text-3xl font-bold mb-2 text-accent">{ampm}</span>
        </div>

        <div className="flex flex-col items-center gap-2 mt-2">
          <h1 className="text-4xl text-ink" style={{ fontFamily: 'var(--font-brand)', fontWeight: 700 }}>{unit?.name || property?.name || ''}</h1>
          {property?.location && (
            <p className="text-xs uppercase tracking-[0.35em] text-faint">{property.location}</p>
          )}
        </div>

        {housekeepingDirty ? (
          <HousekeepingCard onMarkClean={onMarkClean} />
        ) : (
          <div className="glass-card rounded-2xl px-8 py-4 flex items-center gap-3 mt-2">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: online ? 'var(--ok)' : 'var(--text-faint)' }} />
            <span className="text-xs font-bold uppercase tracking-widest text-muted">
              {online ? 'Ready for Guests' : 'Reconnecting…'}
            </span>
          </div>
        )}

        {roomControllerEnabled && controller && !controller.connected && (
          <p className="text-[10px] uppercase tracking-widest text-ghost mt-2">Room controller offline</p>
        )}
      </div>
    </div>
  );
}

// Shown on a vacant room's idle screen after checkout, until housekeeping
// confirms the room is clean. Two-step (button -> confirm) so a stray touch
// on the tablet can't flip the room to "ready".
function HousekeepingCard({ onMarkClean }) {
  const [phase, setPhase] = useState('idle'); // idle | confirm | saving | done | error

  const handleConfirm = async () => {
    setPhase('saving');
    try {
      await onMarkClean();
      setPhase('done');
    } catch {
      setPhase('error');
    }
  };

  if (phase === 'done') {
    return (
      <div className="glass-card rounded-2xl px-8 py-5 flex items-center gap-3 mt-2" style={{ borderColor: 'var(--ok)' }}>
        <span className="material-symbols-outlined filled" style={{ fontSize: 24, color: 'var(--ok)' }}>check_circle</span>
        <span className="text-sm font-bold uppercase tracking-widest text-ink">Room marked clean</span>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl px-8 py-6 flex flex-col items-center gap-4 mt-2 max-w-md"
      style={{ background: 'rgb(217 119 6 / 0.12)', border: '1px solid rgb(217 119 6 / 0.4)' }}
    >
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#D97706' }}>cleaning_services</span>
        <span className="text-sm font-extrabold uppercase tracking-widest" style={{ color: '#B45309' }}>Housekeeping</span>
      </div>

      {phase === 'confirm' ? (
        <>
          <p className="text-sm text-center text-muted leading-relaxed">
            Confirm this room has been fully cleaned and is ready for the next guest?
          </p>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setPhase('idle')}
              className="flex-1 rounded-xl py-3 text-xs font-bold uppercase tracking-widest"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 rounded-xl py-3 text-xs font-extrabold uppercase tracking-widest"
              style={{ background: 'var(--ok)', color: '#fff', border: 'none' }}
            >
              Yes, mark clean
            </button>
          </div>
        </>
      ) : phase === 'saving' ? (
        <p className="text-xs uppercase tracking-widest text-muted">Saving…</p>
      ) : (
        <>
          <p className="text-sm text-center text-muted leading-relaxed">
            {phase === 'error'
              ? 'Could not save — please try again.'
              : 'This room needs cleaning before the next guest.'}
          </p>
          <button
            onClick={() => setPhase('confirm')}
            className="rounded-xl px-8 py-4 text-sm font-extrabold uppercase tracking-widest"
            style={{ background: '#D97706', color: '#fff', border: 'none' }}
          >
            Mark Room Clean
          </button>
        </>
      )}
    </div>
  );
}

function ControlsView({ relays, controller, onToggle, onRGB, onIR }) {
  return (
    <div className="h-full p-10 overflow-y-auto flex flex-col gap-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-extralight text-ink mb-1">Room Controls</h2>
          <p className="text-dim text-sm">Prepare the room before guest arrival.</p>
        </div>
        {controller && (
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: controller.connected ? 'var(--ok)' : 'var(--text-faint)' }}
            />
            <span className="text-[10px] uppercase tracking-widest text-faint">
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
