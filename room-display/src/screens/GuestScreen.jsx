import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import StayPanel from '../components/StayPanel';
import RelayControls from '../components/RelayControls';
import RGBPicker from '../components/RGBPicker';
import IRControls from '../components/IRControls';
import ExploreTab from '../components/ExploreTab';
import OrderFoodTab from '../components/OrderFoodTab';
import BookActivityTab from '../components/BookActivityTab';
import YourOrdersTab from '../components/YourOrdersTab';

const ORDERS_POLL_MS = 15000;

const EXPLORE_TABS = [
  { key: 'activity', icon: 'hiking',      label: 'Activities' },
  { key: 'dining',   icon: 'restaurant',  label: 'Venues'     },
  { key: 'property', icon: 'spa',         label: 'Resort'     },
];

export default function GuestScreen({ unit, booking, relays, controller, property, roomId, online = true, weather, cards = [], orderingEnabled, activitiesEnabled, roomControllerEnabled, callingEnabled, operationsEnabled, onRefresh, onDebugClick, onCallFrontDesk, callActive, alarmTime, alarmEnabled, onSetAlarm }) {
  // Only show explore tabs that have cards
  const visibleExploreTabs = EXPLORE_TABS.filter(t => cards.some(c => c.category === t.key));

  const [activeTab, setActiveTab] = useState('home');
  const [localRelays, setLocalRelays] = useState(relays);
  const [pendingRelays, setPendingRelays] = useState(new Set());
  const [preselectedActivityId, setPreselectedActivityId] = useState(null);
  const [orders, setOrders] = useState({ foodOrders: [], activityBookings: [] });

  const handleBookActivity = (activityId) => {
    setPreselectedActivityId(activityId);
  };

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await api.get(`/display/room/${roomId}/orders`);
      setOrders(data);
    } catch {}
  }, [roomId]);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, ORDERS_POLL_MS);
    return () => clearInterval(interval);
  }, [loadOrders]);

  useEffect(() => {
    setLocalRelays(relays);
    setPendingRelays(new Set());
  }, [relays]);

  const handleRelayToggle = async (relayNum, newState) => {
    setLocalRelays(prev => prev.map(r => r.relay_num === relayNum ? { ...r, state: newState } : r));
    setPendingRelays(prev => new Set([...prev, relayNum]));
    try {
      await api.post(`/display/room/${roomId}/relay`, { relay_num: relayNum, state: newState });
    } catch {
      setLocalRelays(relays);
      setPendingRelays(prev => { const next = new Set(prev); next.delete(relayNum); return next; });
    }
  };

  const handleRGB = async (r, g, b) => {
    try { await api.post(`/display/room/${roomId}/rgb`, { r, g, b }); } catch {}
  };

  const handleIR = async (slot) => {
    try { await api.post(`/display/room/${roomId}/ir`, { slot }); } catch {}
  };

  const hasOrders = orders.foodOrders.length > 0 || orders.activityBookings.length > 0;
  const hasActiveOrder =
    orders.foodOrders.some(o => o.kitchen_status && o.kitchen_status !== 'served') ||
    orders.activityBookings.some(b => ['requested', 'confirmed'].includes(b.status));

  return (
    <div className="w-screen h-dvh bg-app flex overflow-hidden relative">
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgb(var(--accent-rgb) / 0.05)' }} />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgb(var(--accent-rgb) / 0.05)' }} />

      {/* Sidebar */}
      <aside className="w-24 bg-sidebar border-r border-app-soft flex flex-col items-center py-7 z-20 shrink-0">
        <div className="shrink-0" onClick={onDebugClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <img src={property?.logo_url || '/logo.png'} alt={property?.name || ''} style={{ width: 50, height: 50, objectFit: 'contain' }} />
        </div>

        {/* Nav — vertically centered in the rail */}
        <nav className="flex-1 min-h-0 w-full flex flex-col justify-center gap-1 overflow-y-auto" style={{ padding: '0 8px' }}>
          <NavBtn id="home" active={activeTab === 'home'} icon="king_bed" label="Stay" onClick={() => setActiveTab('home')} />
          {roomControllerEnabled && (
            <NavBtn id="controls" active={activeTab === 'controls'} icon="tune" label="Controls" onClick={() => setActiveTab('controls')} />
          )}
          {orderingEnabled && (
            <NavBtn id="order" active={activeTab === 'order'} icon="restaurant_menu" label="Dining" onClick={() => setActiveTab('order')} />
          )}

          {visibleExploreTabs.length > 0 && (
            <div style={{ width: 32, height: 1, background: 'var(--border)', margin: '10px auto' }} />
          )}
          {visibleExploreTabs.map(t => (
            <NavBtn key={t.key} id={t.key} active={activeTab === t.key} icon={t.icon} label={t.label} onClick={() => setActiveTab(t.key)} />
          ))}

          {hasOrders && (
            <>
              <div style={{ width: 32, height: 1, background: 'var(--border)', margin: '10px auto' }} />
              <NavBtn id="orders" active={activeTab === 'orders'} icon="receipt_long" label="Your Orders" badge={hasActiveOrder} onClick={() => setActiveTab('orders')} />
            </>
          )}
        </nav>

        <div className="shrink-0 w-full flex flex-col items-center gap-3" style={{ padding: '0 8px' }}>
          <p className="text-ghost text-xs font-mono">{__APP_COMMIT__}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <TopBar booking={booking} online={online} weather={weather} />
        <div className="flex-1 flex overflow-hidden">
        {preselectedActivityId ? (
          <BookActivityTab roomId={roomId} activityId={preselectedActivityId} onBack={() => setPreselectedActivityId(null)} onBooked={loadOrders} />
        ) : activeTab === 'home' ? (
          <>
            <StayPanel
              unit={unit} booking={booking} relays={localRelays} controller={controller} property={property}
              roomControllerEnabled={roomControllerEnabled}
              roomId={roomId}
              operationsEnabled={operationsEnabled}
              callingEnabled={callingEnabled} onCallFrontDesk={onCallFrontDesk} callActive={callActive}
              alarmTime={alarmTime} alarmEnabled={alarmEnabled} onSetAlarm={onSetAlarm}
            />
            <HomeWelcome booking={booking} weather={weather} property={property} />
            <EveningHighlight cards={cards} activitiesEnabled={activitiesEnabled} onBook={handleBookActivity} />
          </>
        ) : activeTab === 'controls' && roomControllerEnabled ? (
          <section className="flex-1 p-10 bg-app overflow-y-auto">
            <div className="h-full flex flex-col gap-6">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-3xl font-extralight text-ink mb-1">Room Controls</h2>
                  <p className="text-dim text-sm">Manage lighting, ambiance, and climate.</p>
                </div>
                <div className="flex items-center gap-2">
                  {controller && (
                    <>
                      <span className="w-2 h-2 rounded-full" style={{ background: controller.connected ? 'var(--ok)' : 'var(--text-faint)' }} />
                      <span className="text-[10px] uppercase tracking-widest text-faint">
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
        ) : activeTab === 'order' ? (
          <OrderFoodTab roomId={roomId} onOrderPlaced={loadOrders} />
        ) : activeTab === 'orders' ? (
          <YourOrdersTab foodOrders={orders.foodOrders} activityBookings={orders.activityBookings} onRefresh={loadOrders} />
        ) : (
          <ExploreTab
            cards={cards}
            activeCategory={activeTab}
            activitiesEnabled={activitiesEnabled}
            onBookActivity={handleBookActivity}
          />
        )}
        </div>
      </main>
    </div>
  );
}

function TopBar({ online, weather }) {
  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="shrink-0 flex items-center justify-between px-10 py-4 border-b border-app-soft gap-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-dim flex items-center gap-2 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        {dateStr}
      </p>
      {weather?.today && weather?.tomorrow && (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--text-ghost)' }}>Today</span>
            <span className="material-symbols-outlined text-accent" style={{ fontSize: 20 }}>{weather.today.icon || 'partly_cloudy_day'}</span>
            <span style={{ fontSize: 16, fontWeight: 300 }}>{weather.today.temp}°C</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{weather.today.desc}</span>
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 20px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--text-ghost)' }}>Tomorrow</span>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--text-dim)' }}>{weather.tomorrow.icon || 'partly_cloudy_day'}</span>
            <span style={{ fontSize: 16, fontWeight: 300, color: 'var(--text-muted)' }}>{weather.tomorrow.temp}°C</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{weather.tomorrow.desc}</span>
          </div>
        </div>
      )}
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center glass-card shrink-0"
        title={online ? 'Connected to PMS' : 'Reconnecting to PMS…'}
      >
        <span className="material-symbols-outlined text-lg" style={{ color: online ? 'var(--text-muted)' : 'var(--text-ghost)' }}>
          {online ? 'cloud_done' : 'cloud_off'}
        </span>
      </span>
    </div>
  );
}

// Promotes the soonest bookable activity that's surfaced on a Guest Board
// card. No schedule-time data yet (see CLAUDE.md) — soft "this evening"
// label for now.
function EveningHighlight({ cards = [], activitiesEnabled, onBook }) {
  if (!activitiesEnabled) return null;
  const card = cards.find(c => c.category === 'activity' && c.activity_id);
  if (!card) return null;
  return (
    <div
      className="absolute glass-card rounded-2xl p-5 flex items-center gap-4"
      style={{ right: 24, bottom: 24, maxWidth: 520, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}
    >
      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 accent-tint">
        <span className="material-symbols-outlined text-accent">star</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent mb-0.5">Featured · This Evening</p>
        <p className="text-ink text-sm font-medium truncate">{card.title}</p>
        {card.body && <p className="text-dim text-xs line-clamp-2">{card.body}</p>}
      </div>
      <button
        onClick={() => onBook(card.activity_id)}
        className="shrink-0 rounded-xl px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest"
        style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
      >
        Reserve
      </button>
    </div>
  );
}

function HomeWelcome({ booking, weather, property }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours24 = time.getHours();
  const h = (hours24 % 12 || 12).toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const dateStr = time.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const firstName = booking.guest_name?.split(' ')[0] || 'Guest';

  return (
    <section className="flex-1 p-10 bg-app overflow-y-auto flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-ghost">{dateStr}</p>
        <div className="flex items-end gap-3 leading-none">
          <span className="text-8xl font-extralight text-ink tracking-tighter">{h}:{m}</span>
          <span className="text-2xl font-bold mb-2 text-accent">{ampm}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl text-ink" style={{ fontFamily: 'var(--font-brand)', fontWeight: 700 }}>
            {property?.name ? `Welcome to ${property.name}, ${firstName}` : `Welcome, ${firstName}`}
          </h1>
          {property?.location && <p className="text-xs uppercase tracking-[0.3em] text-faint">{property.location}</p>}
        </div>
        {weather?.today && (
          <div className="glass-card rounded-2xl px-6 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-accent" style={{ fontSize: 28 }}>{weather.today.icon || 'partly_cloudy_day'}</span>
            <span className="text-2xl font-light text-ink">{weather.today.temp}°C</span>
            <span className="text-xs uppercase tracking-widest text-dim">{weather.today.desc}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function NavBtn({ active, icon, label, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        background: active ? 'rgb(var(--accent-rgb) / 0.14)' : 'none',
        border: 'none', cursor: 'pointer',
        color: active ? 'var(--accent)' : 'var(--text-dim)',
        fontFamily: 'inherit', fontSize: 9, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        padding: '12px 4px', width: '100%', position: 'relative',
        borderRadius: 14, transition: 'color 0.2s, background 0.2s, box-shadow 0.2s',
        boxShadow: active ? 'inset 0 0 0 1px rgb(var(--accent-rgb) / 0.28), 0 4px 14px rgb(var(--accent-rgb) / 0.12)' : 'none',
      }}
    >
      <span style={{ position: 'relative' }}>
        <span className={`material-symbols-outlined text-xl${active ? ' filled' : ''}`}>{icon}</span>
        {badge && (
          <span style={{
            position: 'absolute', top: -2, right: -4, width: 7, height: 7,
            borderRadius: '50%', background: '#fb923c',
            animation: 'zahill-pulse 1.6s ease-in-out infinite',
          }} aria-hidden />
        )}
      </span>
      {label}
      {active && (
        <span style={{
          position: 'absolute', right: -8, top: '25%', bottom: '25%',
          width: 3, background: 'var(--accent)', borderRadius: '2px 0 0 2px',
        }} />
      )}
    </button>
  );
}
