import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

const ORDERED_PATHS = [
  { key: 'dashboard',     path: '/' },
  { key: 'quick_checkin', path: '/quick-checkin' },
  { key: 'reservations',  path: '/reservations' },
  { key: 'checkin_full',  path: '/checkin' },
  { key: 'guests',        path: '/guests' },
  { key: 'operations',    path: '/operations' },
  { key: 'sales',         path: '/sales' },
  { key: 'loyalty',       path: '/loyalty' },
  { key: 'allotments',    path: '/allotment' },
];

export function firstAllowedPath(user) {
  if (!user) return '/login';
  if (user.role === 'owner') return '/';
  const menus = user.allowed_menus || [];
  const found = ORDERED_PATHS.find(p => menus.includes(p.key));
  return found ? found.path : '/';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const stored = localStorage.getItem('user');
    if (token && stored) {
      setUser(JSON.parse(stored));
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setLoading(false);
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/api/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  }

  // Owner always has full access; others check allowed_menus from login response
  function can(menuKey) {
    if (!user) return false;
    if (user.role === 'owner') return true;
    return Array.isArray(user.allowed_menus) && user.allowed_menus.includes(menuKey);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, can, firstAllowedPath }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
