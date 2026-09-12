import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

function SidebarLink({ to, end, icon, label }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
      <span className="sidebar-link-icon">{icon}</span>
      <span className="sidebar-link-label">{label}</span>
    </NavLink>
  );
}

// Non-collapsible label + its links. Renders nothing when the current
// user/property has none of the links — keeps empty headers from showing.
function NavGroup({ label, items }) {
  if (!items.length) return null;
  return (
    <div className="sidebar-navgroup">
      <div className="sidebar-navgroup-label">{label}</div>
      {items.map(item => <SidebarLink key={item.to} {...item} />)}
    </div>
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
  const isOwner = user?.role === 'owner';

  // ── daily nav ──────────────────────────────────────────
  const frontDeskItems = [
    can('reservations')  && hasModule('reservations') && { to: '/reservations',  icon: '📅', label: 'Reservations' },
    can('quick_checkin') && hasModule('reservations') && hasModule('front_desk') && { to: '/quick-checkin', icon: '⚡', label: 'Quick Check-in' },
    can('checkin_full')  && hasModule('reservations') && hasModule('front_desk') && { to: '/checkin', icon: '✅', label: 'Check-in / out' },
    can('guests')        && hasModule('guest_crm')    && { to: '/guests',  icon: '👤', label: 'Guests' },
    can('loyalty')       && hasModule('guest_crm')    && { to: '/loyalty', icon: '⭐', label: 'Loyalty' },
    can('sales')         && hasModule('sales')        && { to: '/sales',   icon: '🛍', label: 'Sales' },
  ].filter(Boolean);

  const guestExperienceItems = [
    can('activities')   && hasModule('activities')    && { to: '/activities',     icon: '🥾', label: 'Activities' },
    can('guest_board')  && hasModule('in_room_media') && { to: '/settings/board', icon: '📋', label: 'Guest Board' },
  ].filter(Boolean);

  const operationsItems = [
    can('operations') && hasModule('operations') && { to: '/operations', icon: '🧰', label: 'Operations' },
    isOwner && hasModule('financial')            && { to: '/night-audit', icon: '🌙', label: 'Night Audit' },
  ].filter(Boolean);

  const revenueItems = [
    can('pricing')    && hasModule('reservations') && { to: '/pricing',   icon: '💰', label: 'Pricing' },
    can('allotments') && hasModule('reservations') && { to: '/allotment', icon: '📡', label: 'Channels' },
    isOwner && hasModule('reservations')           && { to: '/settings/rate-plans', icon: '🍳', label: 'Rate Plans' },
    isOwner && hasModule('financial')              && { to: '/agents',    icon: '🧾', label: 'Agent Billing' },
    isOwner && hasModule('financial')              && { to: '/reports',   icon: '📈', label: 'Reports' },
  ].filter(Boolean);

  // ── settings (pinned, collapsed) ───────────────────────
  const propertyItems = [
    isOwner && { to: '/settings/property',       icon: '🏢', label: 'Property Details' },
    can('units') && { to: '/units',              icon: '🏕', label: 'Units' },
    isOwner && { to: '/settings', end: true,     icon: '💳', label: 'Sources & Methods' },
    isOwner && { to: '/settings/communications', icon: '✉️', label: 'Email & Communication' },
    can('room_controllers') && hasModule('room_controller') && { to: '/settings/room-controllers', icon: '🎛️', label: 'Room Controllers' },
  ].filter(Boolean);

  const accessItems = [
    can('users') && { to: '/users',       icon: '👥', label: 'Users' },
    isOwner && { to: '/settings/roles',   icon: '🔑', label: 'Roles & Permissions' },
  ].filter(Boolean);

  const hasSettings = propertyItems.length > 0 || accessItems.length > 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src={branding?.logo_url || '/logo.png'} alt={branding?.name || 'ZHP PMS'} />
        <span className="sidebar-logo-name">{branding?.name || 'ZHP PMS'}</span>
      </div>

      <nav className="sidebar-nav">
        {can('dashboard') && <SidebarLink to="/" end icon="📊" label="Dashboard" />}

        <NavGroup label="Front Desk" items={frontDeskItems} />
        <NavGroup label="Guest Experience" items={guestExperienceItems} />
        <NavGroup label="Operations" items={operationsItems} />

        {revenueItems.length > 0 && (
          <SidebarSection id="revenue" label="Revenue & Billing" defaultOpen>
            {revenueItems.map(item => <SidebarLink key={item.to} {...item} />)}
          </SidebarSection>
        )}

        {isOwner && hasModule('back_office') && (
          <SidebarLink to="/back-office" icon="🏭" label="Back Office" />
        )}
      </nav>

      {hasSettings && (
        <div className="sidebar-settings">
          <div className="sidebar-section-label">⚙ Settings</div>
          {propertyItems.length > 0 && (
            <SidebarSection id="settings-property" label="Property">
              {propertyItems.map(item => <SidebarLink key={item.to} {...item} />)}
            </SidebarSection>
          )}
          {accessItems.length > 0 && (
            <SidebarSection id="settings-access" label="Access">
              {accessItems.map(item => <SidebarLink key={item.to} {...item} />)}
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
  );
}
