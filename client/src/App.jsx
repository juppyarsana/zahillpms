import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Reservations from './pages/Reservations';
import NewBooking from './pages/NewBooking';
import BookingDetail from './pages/BookingDetail';
import CheckIn from './pages/CheckIn';
import Guests from './pages/Guests';
import GuestProfile from './pages/GuestProfile';
import Operations from './pages/Operations';
import Allotment from './pages/Allotment';
import Loyalty from './pages/Loyalty';
import Sales from './pages/Sales';
import UnitSettings from './pages/UnitSettings';
import Pricing from './pages/Pricing';
import Users from './pages/Users';
import Settings from './pages/Settings';
import SettingsRoomControllers from './pages/SettingsRoomControllers';

function NavDropdown({ icon, label, items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const location = useLocation();
  const nav = useNavigate();

  const isActive = items.some(c => location.pathname.startsWith(c.to));

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      const inBtn = btnRef.current && btnRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inBtn && !inMenu) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Close on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <>
      <button
        ref={btnRef}
        className={`nav-tab${isActive ? ' active' : ''}`}
        onClick={toggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        {icon} {label} <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 1 }}>▾</span>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            minWidth: 160,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {items.map(item => (
            <button
              key={item.to}
              onClick={() => { nav(item.to); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '11px 16px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontFamily: 'inherit',
                color: location.pathname.startsWith(item.to) ? '#2D5016' : '#374151',
                fontWeight: location.pathname.startsWith(item.to) ? 700 : 400,
                borderLeft: location.pathname.startsWith(item.to) ? '3px solid #2D5016' : '3px solid transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function TopNav() {
  const { user, logout } = useAuth();

  return (
    <nav className="nav-bar">
      <div className="nav-logo">Bird<span>nest</span></div>
      <div className="nav-tabs">
        <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>📊 Dashboard</NavLink>
        <NavLink to="/reservations" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>📅 Reservations</NavLink>
        <NavLink to="/checkin" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>✅ Check-in/out</NavLink>
        <NavLink to="/operations" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>🔧 Operations</NavLink>
        <NavLink to="/guests" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>👤 Guests</NavLink>
        {user?.role === 'owner' && (
          <NavLink to="/sales" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>🛍 Sales</NavLink>
        )}
        <NavLink to="/loyalty" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>⭐ Loyalty</NavLink>
        <NavDropdown icon="🏠" label="Allotments" items={[
          { to: '/allotment', icon: '📡', label: 'Channel' },
          { to: '/pricing',   icon: '💰', label: 'Pricing' },
        ]} />
        {user?.role === 'owner' && (
          <NavDropdown icon="⚙️" label="Settings" items={[
            { to: '/units',                    icon: '🏕', label: 'Units' },
            { to: '/users',                    icon: '👥', label: 'Users' },
            { to: '/settings',                 icon: '🔧', label: 'Sources & Methods' },
            { to: '/settings/room-controllers', icon: '⚡', label: 'Room Controllers' },
          ]} />
        )}
      </div>
      <div className="nav-end">
        <div
          className="avatar avatar-md"
          style={{ background: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: 13 }}
          title={`${user?.name} · ${user?.role}`}
        >
          {user?.name?.[0]?.toUpperCase()}
        </div>
        <button className="nav-signout" onClick={logout}>Sign out</button>
      </div>
    </nav>
  );
}

function BottomNav() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const mainItems = [
    { to: '/', icon: '📊', label: 'Dashboard', end: true },
    { to: '/reservations', icon: '📅', label: 'Bookings' },
    { to: '/checkin', icon: '✅', label: 'Check-in' },
    { to: '/guests', icon: '👤', label: 'Guests' },
  ];

  const moreItems = [
    { to: '/operations', icon: '🔧', label: 'Operations' },
    ...(user?.role === 'owner' ? [{ to: '/sales', icon: '🛍', label: 'Sales' }] : []),
    { to: '/loyalty', icon: '⭐', label: 'Loyalty' },
    { to: '/allotment', icon: '📡', label: 'Channel' },
    { to: '/pricing', icon: '💰', label: 'Pricing' },
    ...(user?.role === 'owner' ? [
      { to: '/units',    icon: '🏕', label: 'Units' },
      { to: '/users',    icon: '👥', label: 'Users' },
      { to: '/settings', icon: '🔧', label: 'Sources & Methods' },
    ] : []),
  ];

  function isActive(to, end) {
    return end ? location.pathname === to : location.pathname.startsWith(to);
  }

  const moreActive = moreItems.some(item => location.pathname.startsWith(item.to));

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <>
      <nav className="bottom-nav">
        {mainItems.map(item => (
          <button
            key={item.to}
            className={`bottom-nav-item${isActive(item.to, item.end) ? ' active' : ''}`}
            onClick={() => nav(item.to)}
          >
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}
        <button
          className={`bottom-nav-item${moreActive || drawerOpen ? ' active' : ''}`}
          onClick={() => setDrawerOpen(true)}
        >
          <span className="bottom-nav-icon">☰</span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>

      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <span style={{ fontWeight: 700, fontSize: 15 }}>Menu</span>
              <button className="btn btn-icon" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            {moreItems.map(item => (
              <button
                key={item.to}
                className="drawer-item"
                onClick={() => { nav(item.to); setDrawerOpen(false); }}
              >
                <span style={{ fontSize: 20 }}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
            <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 4, padding: '12px 20px 4px' }}>
              <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 10 }}>
                {user?.name} · {user?.role}
              </div>
              <button
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={logout}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Layout({ children }) {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="main-content">
        <div className="page-wrap">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <RequireAuth>
            <SettingsProvider>
              <Layout>
                <Routes>
                  <Route path="/"                 element={<Dashboard />} />
                  <Route path="/reservations"     element={<Reservations />} />
                  <Route path="/reservations/new" element={<NewBooking />} />
                  <Route path="/reservations/:id" element={<BookingDetail />} />
                  <Route path="/checkin"          element={<CheckIn />} />
                  <Route path="/guests"           element={<Guests />} />
                  <Route path="/guests/:id"       element={<GuestProfile />} />
                  <Route path="/operations"       element={<Operations />} />
                  <Route path="/allotment"        element={<Allotment />} />
                  <Route path="/loyalty"          element={<Loyalty />} />
                  <Route path="/sales"            element={<Sales />} />
                  <Route path="/units"            element={<UnitSettings />} />
                  <Route path="/pricing"          element={<Pricing />} />
                  <Route path="/users"            element={<Users />} />
                  <Route path="/settings"         element={<Settings />} />
                  <Route path="/settings/room-controllers" element={<SettingsRoomControllers />} />
                </Routes>
              </Layout>
            </SettingsProvider>
            </RequireAuth>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
