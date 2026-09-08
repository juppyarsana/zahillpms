import { Routes, Route, Navigate } from 'react-router-dom';
import { getUser, can, firstAllowedPath, MENUS } from './auth';
import GuestOrderScreen from './screens/GuestOrderScreen';
import LoginScreen from './screens/LoginScreen';
import TakeOrderScreen from './screens/TakeOrderScreen';
import ConfirmQueueScreen from './screens/ConfirmQueueScreen';
import TablesScreen from './screens/TablesScreen';
import TableQrSheet from './screens/TableQrSheet';
import MenuManagementScreen from './screens/MenuManagementScreen';
import StaffShell from './components/StaffShell';

// Local RequireMenu equivalent — this is a separate app/router from the PMS
// client, can't import its AuthContext, so it reads the same allowed_menus
// shape directly (see auth.js). Note the honest limit: this gating is
// client-side only, same as the PMS's own allowed_menus enforcement today —
// the server requires a valid property-scoped JWT + module gate on every
// /api/resto/* route, not per-menu-key enforcement.
function RequireMenu({ menu, children }) {
  if (!getUser()) return <Navigate to="/login" replace />;
  if (!can(menu)) return <Navigate to={firstAllowedPath()} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public guest surface — no auth, credential is the path token */}
      <Route path="/t/:qrToken" element={<GuestOrderScreen />} />

      {/* Staff surface */}
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/staff" element={<Navigate to={firstAllowedPath()} replace />} />
      <Route path="/staff/take-order" element={
        <RequireMenu menu={MENUS.TAKE_ORDER}><StaffShell><TakeOrderScreen /></StaffShell></RequireMenu>
      } />
      <Route path="/staff/queue" element={
        <RequireMenu menu={MENUS.CONFIRM_QUEUE}><StaffShell><ConfirmQueueScreen /></StaffShell></RequireMenu>
      } />
      <Route path="/staff/tables" element={
        <RequireMenu menu={MENUS.TABLES}><StaffShell><TablesScreen /></StaffShell></RequireMenu>
      } />
      <Route path="/staff/tables/qr" element={
        <RequireMenu menu={MENUS.TABLES}><TableQrSheet /></RequireMenu>
      } />
      <Route path="/staff/menu" element={
        <RequireMenu menu={MENUS.MENU}><StaffShell><MenuManagementScreen /></StaffShell></RequireMenu>
      } />

      <Route path="*" element={<Navigate to={getUser() ? '/staff' : '/login'} replace />} />
    </Routes>
  );
}
