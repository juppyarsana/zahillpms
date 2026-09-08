import { useNavigate, useLocation } from 'react-router-dom';
import { can, MENUS, getUser, logout } from '../auth';
import { RestoProvider, useRestoContext } from '../context/RestoContext';

const NAV = [
  { path: '/staff/take-order', label: 'Take Order', icon: '🧾', menu: MENUS.TAKE_ORDER },
  { path: '/staff/queue', label: 'Confirm Queue', icon: '⏳', menu: MENUS.CONFIRM_QUEUE },
  { path: '/staff/tables', label: 'Tables', icon: '🍽', menu: MENUS.TABLES },
  { path: '/staff/menu', label: 'Menu', icon: '📋', menu: MENUS.MENU },
];

// Left-rail nav styled to match the PMS client's own Sidebar.jsx (maroon/
// accent rail, white logo+name block, plain emoji icons — not a Material
// Symbols web font, which is one less thing that can silently fail to load
// and show raw icon names as text instead of a glyph) — this is a staff
// back-office tool, so it should read as the same product family as the
// PMS, not the dark guest-facing kiosk aesthetic. Frees up full width for
// Take Order's side-by-side menu+cart layout by using a rail, not a bottom bar.
export default function StaffShell({ children }) {
  return (
    <RestoProvider>
      <ShellInner>{children}</ShellInner>
    </RestoProvider>
  );
}

function ShellInner({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();
  const context = useRestoContext();
  const items = NAV.filter(t => can(t.menu));

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="w-screen h-dvh flex bg-app text-ink overflow-hidden">
      <aside className="w-[76px] lg:w-60 flex-shrink-0 bg-accent flex flex-col">
        <div className="flex items-center gap-2.5 px-3 lg:px-4 py-4 border-b border-white/10">
          <img
            src={context?.property?.logo_url || '/logo.png'}
            alt={context?.property?.name || 'Resto'}
            className="w-9 h-9 object-contain flex-shrink-0"
          />
          <span className="hidden lg:block text-white text-sm font-bold truncate">
            {context?.property?.name || 'Resto'}
          </span>
        </div>

        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
          {items.map(item => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ' +
                  (active ? 'bg-white/15 text-white font-bold' : 'text-white/65 hover:text-white hover:bg-white/5')
                }
              >
                <span className="text-lg w-[18px] text-center flex-shrink-0">{item.icon}</span>
                <span className="hidden lg:inline text-sm">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="hidden lg:block text-xs text-white/50 mb-2 truncate px-1">{user?.name}</div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center lg:justify-start gap-2 rounded-lg px-3 py-2 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span className="text-base">↩</span>
            <span className="hidden lg:inline text-xs font-semibold">Log out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
