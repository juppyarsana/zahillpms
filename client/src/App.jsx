import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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

function TopNav() {
  const { user, logout } = useAuth();

  const tabs = [
    { to: '/',            icon: '📊', label: 'Dashboard' },
    { to: '/reservations',icon: '📅', label: 'Reservations' },
    { to: '/checkin',     icon: '✅', label: 'Check-in/out' },
    { to: '/allotment',   icon: '🏠', label: 'Allotment' },
    { to: '/operations',  icon: '🔧', label: 'Operations' },
    { to: '/guests',      icon: '👤', label: 'Guests' },
    { to: '/loyalty',     icon: '⭐', label: 'Loyalty' },
    ...(user?.role === 'owner' ? [
      { to: '/sales',   icon: '🛍', label: 'Sales' },
      { to: '/units',   icon: '⚙️', label: 'Units' },
      { to: '/pricing', icon: '💰', label: 'Pricing' },
      { to: '/users',   icon: '👥', label: 'Users' },
    ] : []),
  ];

  return (
    <nav className="nav-bar">
      <div className="nav-logo">Bird<span>nest</span></div>
      <div className="nav-tabs">
        {tabs.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
          >
            {t.icon} {t.label}
          </NavLink>
        ))}
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

function Layout({ children }) {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="main-content">
        <div className="page-wrap">{children}</div>
      </main>
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
              <Layout>
                <Routes>
                  <Route path="/"               element={<Dashboard />} />
                  <Route path="/reservations"   element={<Reservations />} />
                  <Route path="/reservations/new" element={<NewBooking />} />
                  <Route path="/reservations/:id" element={<BookingDetail />} />
                  <Route path="/checkin"        element={<CheckIn />} />
                  <Route path="/guests"         element={<Guests />} />
                  <Route path="/guests/:id"     element={<GuestProfile />} />
                  <Route path="/operations"     element={<Operations />} />
                  <Route path="/allotment"      element={<Allotment />} />
                  <Route path="/loyalty"        element={<Loyalty />} />
                  <Route path="/sales"          element={<Sales />} />
                  <Route path="/units"          element={<UnitSettings />} />
                  <Route path="/pricing"        element={<Pricing />} />
                  <Route path="/users"          element={<Users />} />
                </Routes>
              </Layout>
            </RequireAuth>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
