import { Fragment, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { buildNav } from '../lib/navItems';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { propertyLogo } from '../lib/pwaBrand';
import { useOtaInbox } from './OtaInbox';

function SidebarLink({ to, end, icon, label, badge }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
      <span className="sidebar-link-icon">{icon}</span>
      <span className="sidebar-link-label">{label}</span>
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </NavLink>
  );
}

// A group's items cut into its sub-groups (lib/navItems.js withSubs): an item
// with `sub` or `divider` starts a new run. Exported for the phone drawer.
export function chunks(items) {
  const out = [];
  for (const item of items) {
    if (!out.length || item.sub || item.divider) out.push({ sub: item.sub || null, subIcon: item.subIcon || null, divider: !!item.divider, items: [] });
    out[out.length - 1].items.push(item);
  }
  return out;
}

// A sub-group inside a group (Insights → Stays, Money): a row like a page
// link that opens / closes its pages. Starts open only when the page you are
// on is inside it; then remembered on this device. Closed, it shows how many
// pages it holds and stands out when you are on one of them.
function SidebarSub({ label, icon, items }) {
  const location = useLocation();
  const here = items.some(i => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));
  const storageKey = `sidebar-sub-${label}`;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v ? v === 'open' : here; } catch { return here; }
  });
  function toggle() {
    setOpen(o => { try { localStorage.setItem(storageKey, !o ? 'open' : 'closed'); } catch { /* private window */ } return !o; });
  }
  return (
    <div className="sidebar-subgroup">
      <button className={`sidebar-link sidebar-subtoggle${!open && here ? ' here' : ''}`} onClick={toggle} aria-expanded={open}>
        <span className="sidebar-link-icon">{icon || '•'}</span>
        <span className="sidebar-link-label">{label}</span>
        {!open && <span className="sidebar-group-count">{items.length}</span>}
        <svg className={`sidebar-group-chevron${open ? ' open' : ''}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="sidebar-subitems">{items.map(item => <SidebarLink key={item.to} {...item} />)}</div>}
    </div>
  );
}

// A collapsible group (Front Desk, Services, …): the whole header row
// toggles it, a drawn chevron points right when closed and down when open,
// and the state is remembered on this device. Closed, the header still shows
// how many pages it holds, a new-OTA-bookings count, and stands out when the
// page you are on is inside it.
function SidebarSection({ id, label, items, defaultOpen = true }) {
  const location = useLocation();
  const storageKey = `sidebar-section-${id}`;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v ? v === 'open' : defaultOpen; } catch { return defaultOpen; }
  });
  function toggle() {
    setOpen(o => { try { localStorage.setItem(storageKey, !o ? 'open' : 'closed'); } catch { /* private window */ } return !o; });
  }
  if (!items.length) return null;
  const badge = items.reduce((n, i) => n + (i.badge || 0), 0);
  const here = items.some(i => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));
  return (
    <div className="sidebar-group">
      <button className={`sidebar-group-header${!open && here ? ' here' : ''}`} onClick={toggle} aria-expanded={open}>
        <span className="sidebar-group-title">{label}</span>
        {!open && <span className="sidebar-group-count">{items.length}</span>}
        {!open && badge > 0 && <span className="nav-badge">{badge}</span>}
        <svg className={`sidebar-group-chevron${open ? ' open' : ''}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="sidebar-group-items">
          {chunks(items).map((c, i) => (
            <Fragment key={i}>
              {c.divider && <div className="sidebar-subdivider" />}
              {c.sub ? <SidebarSub label={c.sub} icon={c.subIcon} items={c.items} />
                : c.items.map(item => <SidebarLink key={item.to} {...item} />)}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { user, logout, can, hasModule } = useAuth();
  const { branding } = useSettings();
  const location = useLocation();
  const { badge: otaBadge } = useOtaInbox();
  const nav = buildNav({ user, can, hasModule, otaBadge });
  // Settings is one link to the Settings page (pages/SettingsHub.jsx) — it is
  // visited rarely and used to take most of the sidebar when expanded.
  const inSettings = location.pathname === '/settings' || nav.settingsPaths.some(p => location.pathname.startsWith(p));

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src={propertyLogo(branding)} alt={branding?.name || 'ZHP PMS'} />
        <span className="sidebar-logo-name">{branding?.name || 'ZHP PMS'}</span>
      </div>

      <nav className="sidebar-nav">
        {nav.overview && <SidebarLink {...nav.overview} />}
        {nav.groups.map(g => <SidebarSection key={g.id} id={g.id} label={g.label} items={g.items} />)}
        {/* How to use the PMS — every signed-in user (pages/Guide.jsx) */}
        <div className="sidebar-navgroup sidebar-help"><SidebarLink {...nav.guide} /></div>
      </nav>

      {nav.settingsGroups.length > 0 && (
        <div className="sidebar-settings">
          <NavLink to="/settings" className={`sidebar-link${inSettings ? ' active' : ''}`}>
            <span className="sidebar-link-icon">⚙️</span>
            <span className="sidebar-link-label">Settings</span>
          </NavLink>
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
