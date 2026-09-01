import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, firstAllowedPath } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { CallProvider } from './context/CallContext';
import Sidebar from './components/Sidebar';
import UpdatePrompt from './components/UpdatePrompt';
import CallBanner from './components/CallBanner';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Reservations from './pages/Reservations';
import NewBooking from './pages/NewBooking';
import BookingDetail from './pages/BookingDetail';
import GroupDetail from './pages/GroupDetail';
import CheckIn from './pages/CheckIn';
import QuickCheckIn from './pages/QuickCheckIn';
import Guests from './pages/Guests';
import GuestProfile from './pages/GuestProfile';
import Operations from './pages/Operations';
import Allotment from './pages/Allotment';
import Loyalty from './pages/Loyalty';
import Sales from './pages/Sales';
import Activities from './pages/Activities';
import UnitSettings from './pages/UnitSettings';
import Pricing from './pages/Pricing';
import Users from './pages/Users';
import Settings from './pages/Settings';
import SettingsProperty from './pages/SettingsProperty';
import SettingsCommunications from './pages/SettingsCommunications';
import SettingsRoomControllers from './pages/SettingsRoomControllers';
import SettingsRoles from './pages/SettingsRoles';
import SettingsRatePlans from './pages/SettingsRatePlans';
import SettingsBoardCards from './pages/SettingsBoardCards';
import NightAudit from './pages/NightAudit';
import Agents from './pages/Agents';
import AdminLayout from './pages/admin/AdminLayout';
import AdminProperties from './pages/admin/Properties';
import AdminPropertyDetail from './pages/admin/PropertyDetail';

function BottomNav() {
  const { user, logout, can, hasModule } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const mainItems = [
    can('dashboard')     && { to: '/',               icon: '📊', label: 'Dashboard', end: true },
    can('reservations') && hasModule('reservations') && { to: '/reservations',  icon: '📅', label: 'Bookings' },
    can('quick_checkin') && hasModule('reservations') && hasModule('front_desk') && { to: '/quick-checkin', icon: '⚡', label: 'Quick CI' },
    can('guests') && hasModule('guest_crm') && { to: '/guests', icon: '👤', label: 'Guests' },
  ].filter(Boolean);

  const moreItems = [
    can('checkin_full') && hasModule('reservations') && hasModule('front_desk') && { to: '/checkin',                     icon: '✅', label: 'Check-in/out (Full)' },
    can('operations') && hasModule('operations')         && { to: '/operations',                  icon: '🔧', label: 'Operations' },
    can('sales') && hasModule('sales')                   && { to: '/sales',                       icon: '🛍', label: 'Sales' },
    can('activities') && hasModule('activities')         && { to: '/activities',                   icon: '🥾', label: 'Activities' },
    can('loyalty') && hasModule('guest_crm')              && { to: '/loyalty',                     icon: '⭐', label: 'Loyalty' },
    can('allotments') && hasModule('reservations')        && { to: '/allotment',                   icon: '📡', label: 'Channel' },
    can('pricing') && hasModule('reservations')           && { to: '/pricing',                     icon: '💰', label: 'Pricing' },
    user?.role === 'owner' && hasModule('reservations')   && { to: '/settings/rate-plans',          icon: '🍳', label: 'Rate Plans' },
    can('units')            && { to: '/units',                       icon: '🏕', label: 'Units' },
    can('users')            && { to: '/users',                       icon: '👥', label: 'Users' },
    user?.role === 'owner'  && { to: '/settings/property',           icon: '🏢', label: 'Property Details' },
    user?.role === 'owner'  && { to: '/settings',                    icon: '🔧', label: 'Sources & Methods' },
    user?.role === 'owner'  && { to: '/settings/communications',     icon: '✉️', label: 'Email & Communication' },
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
      <Sidebar />
      <div className="app-main">
        <main className="main-content">
          <div className="page-wrap">{children}</div>
        </main>
        <BottomNav />
      </div>
      <UpdatePrompt />
      <CallBanner />
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

function RequireModule({ moduleName, children }) {
  const { hasModule, user } = useAuth();
  const names = Array.isArray(moduleName) ? moduleName : [moduleName];
  if (!names.every(hasModule)) return <Navigate to={firstAllowedPath(user)} replace />;
  return children;
}

function RequireOwner({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading…</div>;
  if (user?.role !== 'owner') return <Navigate to={firstAllowedPath(user)} replace />;
  return children;
}

function RequireSuperAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_superadmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/login/:slug" element={<Login />} />
          <Route path="/admin" element={
            <RequireSuperAdmin>
              <AdminLayout>
                <AdminProperties />
              </AdminLayout>
            </RequireSuperAdmin>
          } />
          <Route path="/admin/properties/:id" element={
            <RequireSuperAdmin>
              <AdminLayout>
                <AdminPropertyDetail />
              </AdminLayout>
            </RequireSuperAdmin>
          } />
          <Route path="/*" element={
            <RequireAuth>
            <SettingsProvider>
            <CallProvider>
              <Layout>
                <Routes>
                  <Route path="/"                 element={<RequireMenu menuKey="dashboard"><Dashboard /></RequireMenu>} />
                  <Route path="/reservations"     element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><Reservations /></RequireModule></RequireMenu>} />
                  <Route path="/reservations/new" element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><NewBooking /></RequireModule></RequireMenu>} />
                  <Route path="/reservations/:id" element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><BookingDetail /></RequireModule></RequireMenu>} />
                  <Route path="/reservations/group/:groupId" element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><GroupDetail /></RequireModule></RequireMenu>} />
                  <Route path="/checkin"          element={<RequireMenu menuKey="checkin_full"><RequireModule moduleName={['reservations', 'front_desk']}><CheckIn /></RequireModule></RequireMenu>} />
                  <Route path="/quick-checkin"    element={<RequireMenu menuKey="quick_checkin"><RequireModule moduleName={['reservations', 'front_desk']}><QuickCheckIn /></RequireModule></RequireMenu>} />
                  <Route path="/guests"           element={<RequireMenu menuKey="guests"><RequireModule moduleName="guest_crm"><Guests /></RequireModule></RequireMenu>} />
                  <Route path="/guests/:id"       element={<RequireMenu menuKey="guests"><RequireModule moduleName="guest_crm"><GuestProfile /></RequireModule></RequireMenu>} />
                  <Route path="/operations"       element={<RequireMenu menuKey="operations"><RequireModule moduleName="operations"><Operations /></RequireModule></RequireMenu>} />
                  <Route path="/allotment"        element={<RequireMenu menuKey="allotments"><RequireModule moduleName="reservations"><Allotment /></RequireModule></RequireMenu>} />
                  <Route path="/loyalty"          element={<RequireMenu menuKey="loyalty"><RequireModule moduleName="guest_crm"><Loyalty /></RequireModule></RequireMenu>} />
                  <Route path="/sales"            element={<RequireMenu menuKey="sales"><RequireModule moduleName="sales"><Sales /></RequireModule></RequireMenu>} />
                  <Route path="/activities"       element={<RequireMenu menuKey="activities"><RequireModule moduleName="activities"><Activities /></RequireModule></RequireMenu>} />
                  <Route path="/units"            element={<RequireMenu menuKey="units"><UnitSettings /></RequireMenu>} />
                  <Route path="/pricing"          element={<RequireMenu menuKey="pricing"><RequireModule moduleName="reservations"><Pricing /></RequireModule></RequireMenu>} />
                  <Route path="/users"            element={<RequireMenu menuKey="users"><Users /></RequireMenu>} />
                  <Route path="/settings"         element={<RequireOwner><Settings /></RequireOwner>} />
                  <Route path="/settings/property" element={<RequireOwner><SettingsProperty /></RequireOwner>} />
                  <Route path="/settings/communications" element={<RequireOwner><SettingsCommunications /></RequireOwner>} />
                  <Route path="/settings/room-controllers" element={<RequireMenu menuKey="room_controllers"><RequireModule moduleName="room_controller"><SettingsRoomControllers /></RequireModule></RequireMenu>} />
                  <Route path="/settings/board"   element={<RequireOwner><RequireModule moduleName="in_room_media"><SettingsBoardCards /></RequireModule></RequireOwner>} />
                  <Route path="/settings/roles"   element={<RequireOwner><SettingsRoles /></RequireOwner>} />
                  <Route path="/settings/rate-plans" element={<RequireOwner><RequireModule moduleName="reservations"><SettingsRatePlans /></RequireModule></RequireOwner>} />
                  <Route path="/night-audit"      element={<RequireOwner><RequireModule moduleName="financial"><NightAudit /></RequireModule></RequireOwner>} />
                  <Route path="/agents"          element={<RequireOwner><RequireModule moduleName="financial"><Agents /></RequireModule></RequireOwner>} />
                  <Route path="/agents/:sourceId" element={<RequireOwner><RequireModule moduleName="financial"><Agents /></RequireModule></RequireOwner>} />
                </Routes>
              </Layout>
            </CallProvider>
            </SettingsProvider>
            </RequireAuth>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
