import api from './api';

// Reimplements client/src/context/AuthContext.jsx's can() + App.jsx's
// RequireMenu locally — this is a separate React app/router, so it can't
// import across the two apps. Reads the exact same allowed_menus array off
// the same POST /api/auth/login response shape the PMS client uses, so the
// same 'resto_staff'-style role created in the PMS's own Settings > Roles
// works here unmodified.
export const MENUS = {
  TAKE_ORDER: 'resto_take_order',
  CONFIRM_QUEUE: 'resto_confirm_queue',
  TABLES: 'resto_tables',
  MENU: 'resto_menu',
};

export function getUser() {
  try { return JSON.parse(localStorage.getItem('restoUser')); } catch { return null; }
}

export function getToken() {
  return localStorage.getItem('restoToken');
}

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  if (data.user.is_superadmin) throw new Error('Superadmin accounts cannot use the Resto app');
  localStorage.setItem('restoToken', data.token);
  localStorage.setItem('restoUser', JSON.stringify(data.user));
  return data.user;
}

export function logout() {
  localStorage.removeItem('restoToken');
  localStorage.removeItem('restoUser');
}

// Same rule as the PMS: owner always passes, everyone else checks
// allowed_menus from the login response. allowed_menus is cached at login and
// NOT re-fetched per navigation — a permission change needs re-login, same
// documented PMS behavior.
export function can(menuKey) {
  const user = getUser();
  if (!user) return false;
  if (user.role === 'owner') return true;
  return Array.isArray(user.allowed_menus) && user.allowed_menus.includes(menuKey);
}

export function firstAllowedPath() {
  if (can(MENUS.TAKE_ORDER)) return '/staff/take-order';
  if (can(MENUS.CONFIRM_QUEUE)) return '/staff/queue';
  if (can(MENUS.TABLES)) return '/staff/tables';
  if (can(MENUS.MENU)) return '/staff/menu';
  return '/login';
}
