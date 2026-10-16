import { propertyToday } from './propertyTime';

// The detail header card's left edge (components/PageHeader.jsx `tone`) for a
// stay = the colour the Dashboard's Live Unit Status board shows for it
// (pages/Dashboard.jsx TILE_BG): not arrived yet = Arriving (blue), in house =
// Occupied (red), in house and due out today or overdue = Departing (purple),
// checked out / cancelled / no-show = grey. The status badge keeps the
// booking's own colours (owner, 2026-10-16: edge only).
export function stayTone(status, checkOutDate) {
  if (status === 'checked_in') {
    return String(checkOutDate || '').slice(0, 10) <= propertyToday() ? 'departing' : 'occupied';
  }
  if (['pending', 'deposit_paid', 'confirmed'].includes(status)) return 'arriving';
  return 'gray';
}
