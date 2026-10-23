import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, firstAllowedPath } from './context/AuthContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { propertyLogo } from './lib/pwaBrand';
import { CallProvider } from './context/CallContext';
import Sidebar from './components/Sidebar';
import UpdatePrompt from './components/UpdatePrompt';
import InstallPrompt from './components/InstallPrompt';
import CallBanner from './components/CallBanner';
import CallRoomFab from './components/CallRoomFab';
import AskFab from './components/AskFab';
import { AskProvider } from './context/AskContext';
import Login from './pages/Login';
import RoomCheckPublic from './pages/RoomCheckPublic';
import Dashboard from './pages/Dashboard';
import Reservations from './pages/Reservations';
import NewBooking from './pages/NewBooking';
import Availability from './pages/Availability';
import Ask from './pages/Ask';
import Events from './pages/Events';
import EventDetail from './pages/EventDetail';
import BookingDetail from './pages/BookingDetail';
import GroupDetail from './pages/GroupDetail';
import CheckIn from './pages/CheckIn';
import GuestLists from './pages/GuestLists';
import Forecast from './pages/Forecast';
import Guide from './pages/Guide';
import Restaurant from './pages/Restaurant';
import QuickCheckIn from './pages/QuickCheckIn';
import Guests from './pages/Guests';
import GuestProfile from './pages/GuestProfile';
import Operations from './pages/Operations';
import Housekeeping from './pages/Housekeeping';
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
import SettingsReports from './pages/SettingsReports';
import RoomTablets from './pages/RoomTablets';
import SettingsChannelManager from './pages/SettingsChannelManager';
import SettingsRoomControllers from './pages/SettingsRoomControllers';
import SettingsRoles from './pages/SettingsRoles';
import SettingsRatePlans from './pages/SettingsRatePlans';
import SettingsBoardCards from './pages/SettingsBoardCards';
import NightAudit from './pages/NightAudit';
import CashierClosing from './pages/CashierClosing';
import Agents from './pages/Agents';
import Reports from './pages/Reports';
import BackOffice from './pages/BackOffice';

import Stock from './pages/Stock';
import Expenses from './pages/Expenses';
import Payables from './pages/Payables';
import Accounting from './pages/Accounting';
import OtaBookings from './pages/OtaBookings';
import SettingsHub from './pages/SettingsHub';
import { buildNav } from './lib/navItems';
import SettingsShell from './components/SettingsShell';
import { OtaInboxProvider, OtaPopup, useOtaInbox } from './components/OtaInbox';
import AdminLayout from './pages/admin/AdminLayout';
import AdminProperties from './pages/admin/Properties';
import AdminPropertyDetail from './pages/admin/PropertyDetail';

function BottomNav() {
  const { user, logout, can, hasModule } = useAuth();
  const { branding } = useSettings();
  const location = useLocation();
  const nav = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);


  const mainItems = [
    can('dashboard')     && { to: '/',               icon: '📊', label: 'Dashboard', end: true },
    can('reservations') && hasModule('reservations') && { to: '/reservations',  icon: '📅', label: 'Reservations' },
    // Check-in tab; Quick Check-in (⚡ Quick Mode inside it) only for staff
    // who can't open Check-in / out.
    can('checkin_full') && hasModule('reservations') && hasModule('front_desk') && { to: '/checkin', icon: '✅', label: 'Check-in' },
    can('quick_checkin') && !can('checkin_full') && hasModule('reservations') && hasModule('front_desk') && { to: '/quick-checkin', icon: '⚡', label: 'Quick CI' },
    can('guests') && hasModule('guest_crm') && { to: '/guests', icon: '👤', label: 'Guests' },
  ].filter(Boolean);

  // Grouped "More" drawer — the same groups as the desktop sidebar
  // (lib/navItems.js), then Guide and Settings (the Settings page).
  const { badge: otaBadge } = useOtaInbox();
  const navDef = buildNav({ user, can, hasModule, otaBadge });
  const moreGroups = [
    ...navDef.groups,
    { label: 'Help', items: [navDef.guide] },
    navDef.settingsGroups.length && { label: 'Setup', items: [{ to: '/settings', icon: '⚙️', label: 'Settings' }] },
  ].filter(Boolean);

  const moreItems = moreGroups.flatMap(g => g.items);

  function isActive(to, end) {
    return end ? location.pathname === to : location.pathname.startsWith(to);
  }

  const moreActive = moreItems.some(item => location.pathname.startsWith(item.to)) || navDef.settingsPaths.some(p => location.pathname.startsWith(p));

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
            <span className="bottom-nav-icon">☰{otaBadge > 0 && <span className="nav-badge nav-badge-dot">{otaBadge}</span>}</span>
            <span className="bottom-nav-label">More</span>
          </button>
        )}
      </nav>

      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              {/* the property's logo and name — the sidebar that shows them is hidden on phones */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <img src={propertyLogo(branding)} alt="" style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branding?.name || 'Menu'}</span>
              </span>
              <button className="btn btn-icon" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            {moreGroups.map((group, gi) => (
              <div key={group.label || `g${gi}`}>
                {group.label && (
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#9CA3AF', padding: '12px 20px 4px' }}>
                    {group.label}
                  </div>
                )}
                {group.items.map(item => (
                  <button
                    key={item.to}
                    className="drawer-item"
                    onClick={() => { nav(item.to); setDrawerOpen(false); }}
                  >
                    <span style={{ fontSize: 20 }}>{item.icon}</span>
                    <span>{item.label}</span>
                    {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
                  </button>
                ))}
              </div>
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
  const { branding } = useSettings();
  return (
    <AskProvider>
     <OtaInboxProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <main className="main-content">
            <div className="page-wrap"><SettingsShell>{children}</SettingsShell></div>
          </main>
          <BottomNav />
        </div>
        <UpdatePrompt />
        {/* after the property's branding is in, so the installed app takes its name and icon */}
        {branding && <InstallPrompt name={branding.name} />}
        <CallBanner />
        <AskFab />
        <CallRoomFab />
        <OtaPopup />
      </div>
     </OtaInboxProvider>
    </AskProvider>
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
  const keys = Array.isArray(menuKey) ? menuKey : [menuKey];   // any one of them
  if (!keys.some(can)) return <Navigate to={firstAllowedPath(user)} replace />;
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
          {/* Room check from housekeeping's phone — no login, the link is the key (migration 091) */}
          <Route path="/room-check/:token" element={<RoomCheckPublic />} />
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
                  <Route path="/ota-bookings"     element={<RequireMenu menuKey="reservations"><RequireModule moduleName="channel_manager"><OtaBookings /></RequireModule></RequireMenu>} />
                  <Route path="/reservations"     element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><Reservations /></RequireModule></RequireMenu>} />
                  <Route path="/availability"     element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><Availability /></RequireModule></RequireMenu>} />
                  <Route path="/events"           element={<RequireMenu menuKey="events"><RequireModule moduleName="events"><Events /></RequireModule></RequireMenu>} />
                  <Route path="/events/:id"       element={<RequireMenu menuKey="events"><RequireModule moduleName="events"><EventDetail /></RequireModule></RequireMenu>} />
                  <Route path="/ask"              element={<RequireMenu menuKey="assistant"><RequireModule moduleName="assistant"><Ask /></RequireModule></RequireMenu>} />
                  <Route path="/reservations/new"element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><NewBooking /></RequireModule></RequireMenu>} />
                  <Route path="/reservations/:id" element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><BookingDetail /></RequireModule></RequireMenu>} />
                  <Route path="/reservations/group/:groupId" element={<RequireMenu menuKey="reservations"><RequireModule moduleName="reservations"><GroupDetail /></RequireModule></RequireMenu>} />
                  <Route path="/checkin"          element={<RequireMenu menuKey="checkin_full"><RequireModule moduleName={['reservations', 'front_desk']}><CheckIn /></RequireModule></RequireMenu>} />
                  <Route path="/guest-lists"      element={<RequireMenu menuKey="guest_lists"><RequireModule moduleName="reservations"><GuestLists /></RequireModule></RequireMenu>} />
                  <Route path="/guide"            element={<Guide />} />
                  <Route path="/guide/:chapter"   element={<Guide />} />
                  <Route path="/forecast"         element={<RequireMenu menuKey="forecast"><RequireModule moduleName="reservations"><Forecast /></RequireModule></RequireMenu>} />
                  <Route path="/quick-checkin"    element={<RequireMenu menuKey="quick_checkin"><RequireModule moduleName={['reservations', 'front_desk']}><QuickCheckIn /></RequireModule></RequireMenu>} />
                  <Route path="/guests"           element={<RequireMenu menuKey="guests"><RequireModule moduleName="guest_crm"><Guests /></RequireModule></RequireMenu>} />
                  <Route path="/guests/:id"       element={<RequireMenu menuKey="guests"><RequireModule moduleName="guest_crm"><GuestProfile /></RequireModule></RequireMenu>} />
                  <Route path="/operations"       element={<RequireMenu menuKey="operations"><RequireModule moduleName="operations"><Operations /></RequireModule></RequireMenu>} />
                  <Route path="/housekeeping"     element={<RequireMenu menuKey="operations"><RequireModule moduleName="operations"><Housekeeping /></RequireModule></RequireMenu>} />
                  <Route path="/restaurant"       element={<RequireMenu menuKey="restaurant"><RequireModule moduleName="pos_integration"><Restaurant /></RequireModule></RequireMenu>} />
                  <Route path="/allotment"        element={<RequireMenu menuKey="allotments"><RequireModule moduleName="reservations"><Allotment /></RequireModule></RequireMenu>} />
                  <Route path="/loyalty"          element={<RequireMenu menuKey="loyalty"><RequireModule moduleName="guest_crm"><Loyalty /></RequireModule></RequireMenu>} />
                  <Route path="/sales"            element={<RequireMenu menuKey="sales"><RequireModule moduleName="sales"><Sales /></RequireModule></RequireMenu>} />
                  <Route path="/activities"       element={<RequireMenu menuKey="activities"><RequireModule moduleName="activities"><Activities /></RequireModule></RequireMenu>} />
                  <Route path="/units"            element={<RequireMenu menuKey="units"><UnitSettings /></RequireMenu>} />
                  <Route path="/pricing"          element={<RequireMenu menuKey="pricing"><RequireModule moduleName="reservations"><Pricing /></RequireModule></RequireMenu>} />
                  <Route path="/users"            element={<RequireOwner><Users /></RequireOwner>} />
                  <Route path="/settings"         element={<SettingsHub />} />
                  <Route path="/settings/sources" element={<RequireOwner><Settings /></RequireOwner>} />
                  <Route path="/settings/property" element={<RequireOwner><SettingsProperty /></RequireOwner>} />
                  <Route path="/settings/communications" element={<RequireOwner><SettingsCommunications /></RequireOwner>} />
                  <Route path="/settings/reports" element={<RequireOwner><SettingsReports /></RequireOwner>} />
                  <Route path="/settings/channel-manager" element={<RequireOwner><RequireModule moduleName="channel_manager"><SettingsChannelManager /></RequireModule></RequireOwner>} />
                  <Route path="/settings/room-tablets" element={<RequireMenu menuKey="room_tablets"><RoomTablets /></RequireMenu>} />
                  <Route path="/settings/room-controllers" element={<RequireMenu menuKey="room_controllers"><RequireModule moduleName="room_controller"><SettingsRoomControllers /></RequireModule></RequireMenu>} />
                  <Route path="/settings/board"   element={<RequireMenu menuKey="guest_board"><RequireModule moduleName="in_room_media"><SettingsBoardCards /></RequireModule></RequireMenu>} />
                  <Route path="/settings/roles"   element={<RequireOwner><SettingsRoles /></RequireOwner>} />
                  <Route path="/settings/rate-plans" element={<RequireOwner><RequireModule moduleName="reservations"><SettingsRatePlans /></RequireModule></RequireOwner>} />
                  <Route path="/cashier-closing"  element={<RequireMenu menuKey="cashier_closing"><RequireModule moduleName="financial"><CashierClosing /></RequireModule></RequireMenu>} />
                  <Route path="/night-audit"      element={<RequireMenu menuKey="night_audit"><RequireModule moduleName="financial"><NightAudit /></RequireModule></RequireMenu>} />
                  <Route path="/agents"          element={<RequireMenu menuKey={['receivables', 'ota_payouts']}><RequireModule moduleName="financial"><Agents /></RequireModule></RequireMenu>} />
                  <Route path="/agents/:agentId" element={<RequireMenu menuKey={['receivables', 'ota_payouts']}><RequireModule moduleName="financial"><Agents /></RequireModule></RequireMenu>} />
                  <Route path="/reports"         element={<RequireMenu menuKey="reports"><RequireModule moduleName="financial"><Reports /></RequireModule></RequireMenu>} />
                  <Route path="/purchasing"      element={<RequireMenu menuKey={['purchasing', 'direct_purchase']}><RequireModule moduleName="back_office"><BackOffice /></RequireModule></RequireMenu>} />
                  <Route path="/back-office"     element={<Navigate to="/purchasing" replace />} />
                  <Route path="/stock"           element={<RequireMenu menuKey="stock"><RequireModule moduleName="back_office"><Stock /></RequireModule></RequireMenu>} />
                  <Route path="/payables"        element={<RequireMenu menuKey="payables"><RequireModule moduleName="accounting"><Payables /></RequireModule></RequireMenu>} />
                  <Route path="/expenses"        element={<RequireMenu menuKey="expenses"><RequireModule moduleName="back_office"><Expenses /></RequireModule></RequireMenu>} />
                  <Route path="/accounting"      element={<RequireMenu menuKey="accounting"><RequireModule moduleName="accounting"><Accounting /></RequireModule></RequireMenu>} />
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
