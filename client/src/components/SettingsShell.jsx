import { NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { buildNav } from '../lib/navItems';
import Icon from './Icon';

// Every settings page (the paths listed under Settings in lib/navItems.js)
// sits in one frame: the "Settings" header and a settings menu on the left,
// so moving from one setting to the next keeps the same width and place. The
// page inside keeps its own header, shown smaller. On a phone the menu is the
// Settings page itself (SettingsHub), so only a back link is shown.
export default function SettingsShell({ children }) {
  const { user, can, hasModule } = useAuth();
  const { pathname } = useLocation();
  const { settingsGroups, settingsPaths } = buildNav({ user, can, hasModule });
  if (!settingsPaths.includes(pathname)) return children;

  return (
    <div className="settings-shell">
      <div className="page-header settings-shell-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Set up the hotel — things you change once in a while</div>
        </div>
      </div>
      <Link to="/settings" className="settings-back"><Icon name="chevronLeft" size={14} />Settings</Link>
      <div className="settings-cols">
        <nav className="settings-subnav" aria-label="Settings">
          {settingsGroups.map(g => (
            <div key={g.id}>
              <div className="settings-subnav-label">{g.label}</div>
              {g.items.map(i => (
                <NavLink key={i.to} to={i.to} className={({ isActive }) => `settings-subnav-item${isActive ? ' active' : ''}`}>{i.label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-body">{children}</div>
      </div>
    </div>
  );
}
