import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, firstAllowedPath } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import UpdatePrompt from './components/UpdatePrompt';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Reservations from './pages/Reservations';
import NewBooking from './pages/NewBooking';
import BookingDetail from './pages/BookingDetail';
import CheckIn from './pages/CheckIn';
import QuickCheckIn from './pages/QuickCheckIn';
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
import SettingsRoles from './pages/SettingsRoles';
import SettingsBoardCards from './pages/SettingsBoardCards';
import NightAudit from './pages/NightAudit';

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
  const { user, logout, can } = useAuth();

  const settingsItems = [
    can('units')            && { to: '/units',                     icon: '🏕', label: 'Units' },
    can('users')            && { to: '/users',                     icon: '👥', label: 'Users' },
    can('settings')         && { to: '/settings',                  icon: '🔧', label: 'Sources & Methods' },
    can('room_controllers') && { to: '/settings/room-controllers', icon: '⚡', label: 'Room Controllers' },
    user?.role === 'owner'  && { to: '/settings/board',            icon: '📋', label: 'Guest Board' },
    user?.role === 'owner'  && { to: '/settings/roles',            icon: '🔑', label: 'Roles & Permissions' },
    user?.role === 'owner'  && { to: '/night-audit',               icon: '🌙', label: 'Night Audit' },
  ].filter(Boolean);

  return (
    <nav className="nav-bar">
      <div className="nav-logo"><img src="/logo.png" alt="Birdnest" style={{ height: 44, objectFit: 'contain' }} /></div>
      <div className="nav-tabs">
        {can('dashboard') && <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>📊 Dashboard</NavLink>}
        {can('reservations')  && <NavLink to="/reservations"  className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>📅 Reservations</NavLink>}
        {can('quick_checkin') && <NavLink to="/quick-checkin" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>⚡ Quick CI</NavLink>}
        {can('checkin_full')  && <NavLink to="/checkin"       className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>✅ Check-in/out</NavLink>}
        {can('operations')    && <NavLink to="/operations"    className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>🔧 Operations</NavLink>}
        {can('guests')        && <NavLink to="/guests"        className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>👤 Guests</NavLink>}
        {can('sales')         && <NavLink to="/sales"         className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>🛍 Sales</NavLink>}
        {can('loyalty')       && <NavLink to="/loyalty"       className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>⭐ Loyalty</NavLink>}
        {(can('allotments') || can('pricing')) && (
          <NavDropdown icon="🏠" label="Allotments" items={[
            can('allotments') && { to: '/allotment', icon: '📡', label: 'Channel' },
            can('pricing')    && { to: '/pricing',   icon: '💰', label: 'Pricing' },
          ].filter(Boolean)} />
        )}
        {settingsItems.length > 0 && (
          <NavDropdown icon="⚙️" label="Settings" items={settingsItems} />
        )}
      </div>
      <div className="nav-end">
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
          {__APP_COMMIT__}
        </span>
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
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const mainItems = [
    can('dashboard')     && { to: '/',               icon: '📊', label: 'Dashboard', end: true },
    can('reservations')  && { to: '/reservations',  icon: '📅', label: 'Bookings' },
    can('quick_checkin') && { to: '/quick-checkin', icon: '⚡', label: 'Quick CI' },
    can('guests')        && { to: '/guests',         icon: '👤', label: 'Guests' },
  ].filter(Boolean);

  const moreItems = [
    can('checkin_full')     && { to: '/checkin',                     icon: '✅', label: 'Check-in/out (Full)' },
    can('operations')       && { to: '/operations',                  icon: '🔧', label: 'Operations' },
    can('sales')            && { to: '/sales',                       icon: '🛍', label: 'Sales' },
    can('loyalty')          && { to: '/loyalty',                     icon: '⭐', label: 'Loyalty' },
    can('allotments')       && { to: '/allotment',                   icon: '📡', label: 'Channel' },
    can('pricing')          && { to: '/pricing',                     icon: '💰', label: 'Pricing' },
    can('units')            && { to: '/units',                       icon: '🏕', label: 'Units' },
    can('users')            && { to: '/users',                       icon: '👥', label: 'Users' },
    can('settings')         && { to: '/settings',                    icon: '🔧', label: 'Sources & Methods' },
    user?.role === 'owner'  && { to: '/settings/roles',              icon: '🔑', label: 'Roles & Permissions' },
  ].filter(Boolean);

  function isActive(to, end) {
    return end ? location.pathname === to : location.pathname.startsWith(to);
  }

  const moreActive = moreItems.some(item => location.pathname.startsWith(item.to));

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
        {moreItems.length > 0 && (
          <button
            className={`bottom-nav-item${moreActive || drawerOpen ? ' active' : ''}`}
            onClick={() => setDrawerOpen(true)}
          >
            <span className="bottom-nav-icon">☰</span>
            <span className="bottom-nav-label">More</span>
          </button>
        )}
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
              <div style={{ fontSize: 10, color: '#d1d5db', fontFamily: 'monospace', textAlign: 'center', marginTop: 12 }}>
                build {__APP_COMMIT__}
              </div>
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
      <UpdatePrompt />
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireMenu({ menuKey, children }) {
  const { can, user } = useAuth();
  if (!can(menuKey)) return <Navigate to={firstAllowedPath(user)} replace />;
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
                  <Route path="/"                 element={<RequireMenu menuKey="dashboard"><Dashboard /></RequireMenu>} />
                  <Route path="/reservations"     element={<RequireMenu menuKey="reservations"><Reservations /></RequireMenu>} />
                  <Route path="/reservations/new" element={<RequireMenu menuKey="reservations"><NewBooking /></RequireMenu>} />
                  <Route path="/reservations/:id" element={<RequireMenu menuKey="reservations"><BookingDetail /></RequireMenu>} />
                  <Route path="/checkin"          element={<RequireMenu menuKey="checkin_full"><CheckIn /></RequireMenu>} />
                  <Route path="/quick-checkin"    element={<RequireMenu menuKey="quick_checkin"><QuickCheckIn /></RequireMenu>} />
                  <Route path="/guests"           element={<RequireMenu menuKey="guests"><Guests /></RequireMenu>} />
                  <Route path="/guests/:id"       element={<RequireMenu menuKey="guests"><GuestProfile /></RequireMenu>} />
                  <Route path="/operations"       element={<RequireMenu menuKey="operations"><Operations /></RequireMenu>} />
                  <Route path="/allotment"        element={<RequireMenu menuKey="allotments"><Allotment /></RequireMenu>} />
                  <Route path="/loyalty"          element={<RequireMenu menuKey="loyalty"><Loyalty /></RequireMenu>} />
                  <Route path="/sales"            element={<RequireMenu menuKey="sales"><Sales /></RequireMenu>} />
                  <Route path="/units"            element={<RequireMenu menuKey="units"><UnitSettings /></RequireMenu>} />
                  <Route path="/pricing"          element={<RequireMenu menuKey="pricing"><Pricing /></RequireMenu>} />
                  <Route path="/users"            element={<RequireMenu menuKey="users"><Users /></RequireMenu>} />
                  <Route path="/settings"         element={<RequireMenu menuKey="settings"><Settings /></RequireMenu>} />
                  <Route path="/settings/room-controllers" element={<RequireMenu menuKey="room_controllers"><SettingsRoomControllers /></RequireMenu>} />
                  <Route path="/settings/board"   element={<SettingsBoardCards />} />
                  <Route path="/settings/roles"   element={<SettingsRoles />} />
                  <Route path="/night-audit"      element={<NightAudit />} />
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
