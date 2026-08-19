import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import CallRoomModal from './CallRoomModal';

function SidebarLink({ to, end, icon, label }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
      <span className="sidebar-link-icon">{icon}</span>
      <span className="sidebar-link-label">{label}</span>
    </NavLink>
  );
}

function SidebarSection({ id, label, defaultOpen = false, children }) {
  const storageKey = `sidebar-section-${id}`;
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored ? stored === 'open' : defaultOpen;
  });

  function toggle() {
    setOpen(o => {
      localStorage.setItem(storageKey, !o ? 'open' : 'closed');
      return !o;
    });
  }

  return (
    <div className="sidebar-group">
      <button className="sidebar-group-header" onClick={toggle}>
        <span>{label}</span>
        <span className={`sidebar-group-chevron${open ? ' open' : ''}`}>▸</span>
      </button>
      {open && <div className="sidebar-group-items">{children}</div>}
    </div>
  );
}

export default function Sidebar() {
  const { user, logout, can, hasModule } = useAuth();
  const { branding } = useSettings();
  const [showCallModal, setShowCallModal] = useState(false);

  const showRatesSection = (can('allotments') || can('pricing')) && hasModule('reservations');

  const generalItems = [
    can('units')            && { to: '/units',                     icon: '🏕', label: 'Units' },
    user?.role === 'owner'  && { to: '/settings/property',         icon: '🏢', label: 'Property Details' },
    can('room_controllers') && hasModule('room_controller') && { to: '/settings/room-controllers', icon: '⚡', label: 'Room Controllers' },
  ].filter(Boolean);

  const guestBookingItems = [
    user?.role === 'owner'  && { to: '/settings', end: true,       icon: '🔧', label: 'Sources & Methods' },
    user?.role === 'owner'  && { to: '/settings/communications',   icon: '✉️', label: 'Email & Communication' },
    user?.role === 'owner'  && hasModule('in_room_media')    && { to: '/settings/board',            icon: '📋', label: 'Guest Board' },
  ].filter(Boolean);

  const adminItems = [
    can('users')            && { to: '/users',                     icon: '👥', label: 'Users' },
    user?.role === 'owner'  && { to: '/settings/roles',            icon: '🔑', label: 'Roles & Permissions' },
  ].filter(Boolean);

  const hasSettings = generalItems.length > 0 || guestBookingItems.length > 0 || adminItems.length > 0;

  return (
    <>
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src={branding?.logo_url || '/logo.png'} alt={branding?.name || 'ZHP PMS'} />
        <span className="sidebar-logo-name">{branding?.name || 'ZHP PMS'}</span>
      </div>

      <nav className="sidebar-nav">
        {can('dashboard')     && <SidebarLink to="/" end icon="📊" label="Dashboard" />}
        {can('reservations')  && hasModule('reservations') && <SidebarLink to="/reservations" icon="📅" label="Reservations" />}
        {can('quick_checkin') && hasModule('reservations') && hasModule('front_desk') && <SidebarLink to="/quick-checkin" icon="⚡" label="Quick Check-in" />}
        {can('checkin_full')  && hasModule('reservations') && hasModule('front_desk') && <SidebarLink to="/checkin" icon="✅" label="Check-in/out" />}
        {can('operations') && hasModule('operations') && <SidebarLink to="/operations" icon="🔧" label="Operations" />}
        {can('guests') && hasModule('guest_crm')       && <SidebarLink to="/guests" icon="👤" label="Guests" />}
        {can('loyalty') && hasModule('guest_crm')      && <SidebarLink to="/loyalty" icon="⭐" label="Loyalty" />}
        {can('sales') && hasModule('sales')            && <SidebarLink to="/sales" icon="🛍" label="Sales" />}
        {can('activities') && hasModule('activities')  && <SidebarLink to="/activities" icon="🥾" label="Activities" />}
        {user?.role === 'owner' && hasModule('financial') && <SidebarLink to="/night-audit" icon="🌙" label="Night Audit" />}

        {showRatesSection && (
          <SidebarSection id="rates" label="Rates & Channels" defaultOpen>
            {can('allotments') && <SidebarLink to="/allotment" icon="📡" label="Channel" />}
            {can('pricing')    && <SidebarLink to="/pricing"   icon="💰" label="Pricing" />}
          </SidebarSection>
        )}

        {hasModule('calling') && (
          <button
            className="sidebar-link"
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setShowCallModal(true)}
          >
            <span className="sidebar-link-icon">📞</span>
            <span className="sidebar-link-label">Call a Room</span>
          </button>
        )}
      </nav>

      {hasSettings && (
        <div className="sidebar-settings">
          <div className="sidebar-section-label">⚙ Settings</div>
          {generalItems.length > 0 && (
            <SidebarSection id="settings-general" label="General">
              {generalItems.map(item => <SidebarLink key={item.to} {...item} />)}
            </SidebarSection>
          )}
          {guestBookingItems.length > 0 && (
            <SidebarSection id="settings-guest-booking" label="Guest & Booking">
              {guestBookingItems.map(item => <SidebarLink key={item.to} {...item} />)}
            </SidebarSection>
          )}
          {adminItems.length > 0 && (
            <SidebarSection id="settings-admin" label="Admin">
              {adminItems.map(item => <SidebarLink key={item.to} {...item} />)}
            </SidebarSection>
          )}
        </div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar avatar-sm" style={{ background: 'rgba(255,255,255,0.15)' }}>
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name}</div>
            <div className="sidebar-user-role">{user?.role}</div>
          </div>
        </div>
        <button className="sidebar-signout" onClick={logout}>Sign out</button>
        <div className="sidebar-build">{__APP_COMMIT__}</div>
      </div>
    </aside>
    {showCallModal && <CallRoomModal onClose={() => setShowCallModal(false)} />}
    </>
  );
}
