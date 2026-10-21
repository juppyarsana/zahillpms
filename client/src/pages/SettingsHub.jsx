import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { buildNav } from '../lib/navItems';

// Settings — one page with every setup screen the user may open, grouped
// (Property · Rooms & Rates · Devices · Access), instead of a long expanded
// block in the sidebar. The list comes from lib/navItems.js (same as the
// sidebar and the phone menu).
export default function SettingsHub() {
  const { user, can, hasModule } = useAuth();
  const { settingsGroups } = buildNav({ user, can, hasModule });

  return (
    <div className="page-wrap" style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Set up the hotel — things you change once in a while</div>
        </div>
      </div>

      {!settingsGroups.length && (
        <div className="card" style={{ color: 'var(--text-muted)' }}>Your role has no settings to change. Ask the owner if you need access.</div>
      )}

      {settingsGroups.map(g => (
        <div key={g.id} className="settings-hub-group">
          <div className="settings-hub-label">{g.label}</div>
          <div className="settings-hub-grid">
            {g.items.map(i => (
              <Link key={i.to} to={i.to} className="settings-hub-item">
                <span className="settings-hub-icon">{i.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="settings-hub-title">{i.label}</span>
                  <span className="settings-hub-hint">{i.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
