import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import StayPanel from '../components/StayPanel';
import RelayControls from '../components/RelayControls';
import RGBPicker from '../components/RGBPicker';
import IRControls from '../components/IRControls';
import Clock from '../components/Clock';
import ExploreTab from '../components/ExploreTab';
import OrderFoodTab from '../components/OrderFoodTab';
import BookActivityTab from '../components/BookActivityTab';
import YourOrdersTab from '../components/YourOrdersTab';
import CallButton from '../components/CallButton';

const ORDERS_POLL_MS = 15000;

const EXPLORE_TABS = [
  { key: 'activity', icon: 'hiking',      label: 'Activities' },
  { key: 'dining',   icon: 'restaurant',  label: 'Dining'     },
  { key: 'property', icon: 'home',        label: 'Property'   },
];

export default function GuestScreen({ unit, booking, relays, controller, property, roomId, weather, cards = [], orderingEnabled, activitiesEnabled, roomControllerEnabled, callingEnabled, onRefresh, onDebugClick, onCallFrontDesk, callActive }) {
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
    <div className="w-screen h-dvh bg-bg-dark flex overflow-hidden relative">
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(201,162,39,0.05)' }} />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'rgba(201,162,39,0.05)' }} />

      {/* Sidebar */}
      <aside className="w-20 bg-sidebar-dark border-r border-white/5 flex flex-col items-center py-8 z-20 shrink-0">
        <div className="mb-6" onClick={onDebugClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <img src={property?.logo_url || '/logo.png'} alt={property?.name || 'ZHP PMS'} style={{ width: 52, height: 52, objectFit: 'contain' }} />
        </div>

        {/* Controls — top zone */}
        <div style={{ width: '100%', padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <NavBtn id="home" active={activeTab === 'home'} icon="home" label="Home" onClick={() => setActiveTab('home')} />
          {roomControllerEnabled && (
            <NavBtn id="controls" active={activeTab === 'controls'} icon="auto_fix_high" label="Controls" onClick={() => setActiveTab('controls')} />
          )}
          {orderingEnabled && (
            <NavBtn id="order" active={activeTab === 'order'} icon="restaurant_menu" label="Order Food" onClick={() => setActiveTab('order')} />
          )}
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

        {/* Your Orders — own section, separated from the display/explore menu above it */}
        {hasOrders && (
          <>
            <div style={{ width: 32, height: 1, background: 'rgba(255,255,255,0.07)', margin: '12px auto' }} />
            <div style={{ width: '100%', padding: '0 8px' }}>
              <NavBtn id="orders" active={activeTab === 'orders'} icon="receipt_long" label="Your Orders" badge={hasActiveOrder} onClick={() => setActiveTab('orders')} />
            </div>
          </>
        )}

        <div className="mt-auto w-full flex flex-col items-center gap-3" style={{ padding: '0 8px' }}>
          {callingEnabled && <CallButton onClick={onCallFrontDesk} disabled={callActive} />}
          <Clock compact />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {preselectedActivityId ? (
          <BookActivityTab roomId={roomId} activityId={preselectedActivityId} onBack={() => setPreselectedActivityId(null)} onBooked={loadOrders} />
        ) : activeTab === 'home' ? (
          <>
            <StayPanel unit={unit} booking={booking} relays={localRelays} controller={controller} property={property} roomControllerEnabled={roomControllerEnabled} />
            <HomeWelcome booking={booking} weather={weather} />
          </>
        ) : activeTab === 'controls' && roomControllerEnabled ? (
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
        ) : activeTab === 'order' ? (
          <OrderFoodTab roomId={roomId} onOrderPlaced={loadOrders} />
        ) : activeTab === 'orders' ? (
          <YourOrdersTab foodOrders={orders.foodOrders} activityBookings={orders.activityBookings} onRefresh={loadOrders} />
        ) : (
          <ExploreTab
            weather={weather}
            cards={cards}
            activeCategory={activeTab}
            activitiesEnabled={activitiesEnabled}
            onBookActivity={handleBookActivity}
          />
        )}
      </main>
    </div>
  );
}

function HomeWelcome({ booking, weather }) {
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
    <section className="flex-1 p-10 bg-bg-dark overflow-y-auto flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-slate-700">{dateStr}</p>
        <div className="flex items-end gap-3 leading-none">
          <span className="text-8xl font-extralight text-white tracking-tighter">{h}:{m}</span>
          <span className="text-2xl font-bold mb-2" style={{ color: '#c9a227' }}>{ampm}</span>
        </div>
        <h1 className="text-3xl text-white" style={{ fontFamily: 'var(--font-brand)', fontWeight: 700 }}>
          Welcome, {firstName}
        </h1>
        {weather?.today && (
          <div className="glass-card rounded-2xl px-6 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#c9a227' }}>{weather.today.icon || 'partly_cloudy_day'}</span>
            <span className="text-2xl font-light text-white">{weather.today.temp}°C</span>
            <span className="text-xs uppercase tracking-widest text-slate-500">{weather.today.desc}</span>
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
        background: active ? 'rgba(201,162,39,0.12)' : 'none',
        border: 'none', cursor: 'pointer',
        color: active ? '#c9a227' : '#64748b',
        fontFamily: 'inherit', fontSize: 9, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        padding: '10px 4px', width: '100%', position: 'relative',
        borderRadius: 10, transition: 'color 0.2s, background 0.2s',
      }}
    >
      <span style={{ position: 'relative' }}>
        <span className={`material-symbols-outlined text-xl${active ? ' filled' : ''}`}>{icon}</span>
        {badge && (
          <span style={{
            position: 'absolute', top: -2, right: -4, width: 7, height: 7,
            borderRadius: '50%', background: '#fb923c',
            animation: 'zahill-pulse 1.6s ease-in-out infinite',
          }} />
        )}
      </span>
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
