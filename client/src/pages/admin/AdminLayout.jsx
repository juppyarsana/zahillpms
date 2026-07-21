import { useAuth } from '../../context/AuthContext';

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <nav className="nav-bar">
        <div className="nav-logo" style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>
          Platform Admin
        </div>
        <div className="nav-end">
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{user?.name}</span>
          <button className="nav-signout" onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="main-content">
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}
