// Room types in the owner's order — set in Settings → Units (↑ ↓ on each room
// type, room_types.sort_order). Unit rows from /api/units and the Dashboard
// carry it as `type_order`; a type without one goes last, then by name.

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// (typeA, typeB) => number, for a list of room type names.
export function typeComparator(units) {
  const order = new Map();
  for (const u of units) {
    const t = u.type || 'Other';
    if (u.type_order != null && !order.has(t)) order.set(t, u.type_order);
  }
  return (a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999) || byName(a, b);
}

// [{ type, list }] — rooms grouped by type, types in the owner's order, rooms by number.
export function groupUnitsByType(units) {
  const m = new Map();
  for (const u of units) {
    const k = u.type || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(u);
  }
  const cmp = typeComparator(units);
  return [...m.entries()]
    .map(([type, list]) => ({ type, list: list.slice().sort((a, b) => byName(a.name, b.name)) }))
    .sort((a, b) => cmp(a.type, b.type));
}
