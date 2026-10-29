// The one menu definition (regrouped 2026-10-22): the desktop sidebar
// (components/Sidebar.jsx), the phone "More" drawer (App.jsx BottomNav) and
// the Settings page (pages/SettingsHub.jsx) all read it, so they can't drift
// apart. Each item is shown only when the user's role and the property's
// modules allow it — the same checks as the routes in App.jsx (keep both in
// step when adding a page). Settings items carry a one-line description for
// the Settings page.

import { reportsFor } from './reportLibrary';

// Sub-groups inside one menu group: the first visible item of each carries
// the small heading (`sub`), or a line above it (`divider`); a sub-group with
// nothing visible disappears with its heading.
function withSubs(subs) {
  const out = [];
  for (const [label, items, opts = {}] of subs) {
    const shown = items.filter(Boolean);
    if (shown.length) out.push({ ...shown[0], ...(label ? { sub: label } : {}), ...(opts.divider ? { divider: true } : {}) }, ...shown.slice(1));
  }
  return out;
}

export function buildNav({ user, can, hasModule, otaBadge = 0 }) {
  const isOwner = user?.role === 'owner';
  const res = hasModule('reservations');
  const hasCosts = hasModule('back_office') || hasModule('accounting');   // where costs are entered
  const groups = [
    { id: 'front-desk', label: 'Front Desk', items: [
      // Today: the day's figures, room board and arrivals / in house / departures with Check in / out.
      (can('checkin_full') || can('guest_lists') || can('dashboard')) && res && { to: '/today', icon: '☀', label: 'Today' },
      // Reservations: Calendar · List · Availability · OTA bookings (with the unseen count) · Groups · Booked on.
      can('reservations') && res && { to: '/reservations', icon: '📅', label: 'Reservations', badge: hasModule('channel_manager') ? otaBadge : 0 },
      // Quick Check-in is reached from Check-in / out (⚡ Quick Mode); only staff
      // who can't open Check-in / out get it as its own menu item.
      can('quick_checkin') && !can('checkin_full') && res && hasModule('front_desk') && { to: '/quick-checkin', icon: '⚡', label: 'Quick Check-in' },
      can('checkin_full') && res && hasModule('front_desk') && { to: '/checkin', icon: '✅', label: 'Check-in / out' },
      can('guest_lists') && res && { to: '/guest-lists', icon: '🗂', label: 'Guest Lists' },
      can('guests') && hasModule('guest_crm') && { to: '/guests', icon: '👤', label: 'Guests' },
      // Front desk recording the OTAs' weekly withdrawals (migration 126) — only the OTA accounts.
      !can('receivables') && can('ota_payouts') && hasModule('financial') && { to: '/agents', icon: '🏦', label: 'OTA payouts' },
      // End of day: Cashier closing + Night audit as tabs.
      (can('cashier_closing') || can('night_audit')) && hasModule('financial') && { to: '/end-of-day', icon: '🌙', label: 'End of day' },
    ] },
    // Guest services: what front desk sells or books for a guest during the stay.
    { id: 'services', label: 'Guest services', items: [
      can('sales') && hasModule('sales') && { to: '/sales', icon: '🛍', label: 'Extras' },
      can('activities') && hasModule('activities') && { to: '/activities', icon: '🥾', label: 'Activities' },
      can('restaurant') && hasModule('pos_integration') && { to: '/restaurant', icon: '🍽', label: 'Restaurant' },
    ] },
    // Sales: prices and the meeting room — selling rooms and events ahead.
    { id: 'sales', label: 'Sales', items: [
      can('pricing') && res && { to: '/pricing', icon: '💰', label: 'Pricing' },
      can('events') && hasModule('events') && { to: '/events', icon: '🗓', label: 'Events' },
    ] },
    { id: 'operations', label: 'Operations', items: [
      can('operations') && hasModule('operations') && { to: '/housekeeping', icon: '🧹', label: 'Housekeeping' },
      // Purchasing opens on Requests (the first step of buying); a department
      // head with only `purchase_request` sees the same page as "Purchase requests".
      (can('purchasing') || can('direct_purchase')) && hasModule('back_office') && { to: '/purchasing', icon: '📦', label: 'Purchasing' },
      !can('purchasing') && !can('direct_purchase') && can('purchase_request') && hasModule('back_office') && { to: '/purchasing', icon: '🛒', label: 'Purchase requests' },
      can('stock') && hasModule('back_office') && { to: '/stock', icon: '🗃', label: 'Stock' },
    ] },
    // Insights (owner's figures, one question per page): Summary · Forecast,
    // sub-groups Stays · Money, then Export / Print (every printable report).
    { id: 'revenue', label: 'Insights', items: withSubs([
      // Overall (every figure for any period) and the days ahead, then the
      // stays and the money (revenue − costs = profit), then the downloads.
      [null, [
        can('reports') && hasModule('financial') && { to: '/insights/summary', icon: '📊', label: 'Summary' },
        can('forecast') && res && { to: '/forecast', icon: '🔭', label: 'Forecast' },
      ]],
      ['Stays', [
        can('reports') && res && { to: '/insights/bookings', icon: '🧾', label: 'Bookings' },
        can('reports') && res && { to: '/insights/rooms', icon: '🛏', label: 'Rooms' },
        can('reports') && res && { to: '/insights/guests', icon: '🌏', label: 'Guests' },
      ]],
      ['Money', [
        can('reports') && hasModule('financial') && { to: '/revenue', icon: '💹', label: 'Revenue' },
        can('costs') && hasCosts && { to: '/costs', icon: '🏷', label: 'Costs' },
        can('profit') && hasModule('accounting') && { to: '/profit', icon: '⚖', label: 'Profit' },
      ]],
      [null, [reportsFor(can, hasModule).length > 0 && { to: '/reports', end: true, icon: '🖨', label: 'Export / Print' }], { divider: true }],
    ]) },
    { id: 'finance', label: 'Finance', items: [
      // In the money's order: owed to the hotel, owed by the hotel, spent, the books.
      can('receivables') && hasModule('financial') && { to: '/agents', icon: '🧾', label: 'Receivables' },   // agents, companies, OTAs (owner or the accountant)
      can('payables') && hasModule('accounting') && { to: '/payables', icon: '📥', label: 'Payables' },   // supplier bills, what the hotel owes
      can('vendors') && hasModule('activities') && { to: '/vendor-payouts', icon: '🚐', label: 'Vendor payouts' },   // tour / transport vendors (migration 140)
      can('expenses') && hasModule('back_office') && { to: '/expenses', icon: '💸', label: 'Expenses' },
      can('accounting') && hasModule('accounting') && { to: '/accounting', icon: '📒', label: 'Accounting' },
    ] },
  ].map(g => ({ ...g, items: g.items.filter(Boolean) })).filter(g => g.items.length);

  const settingsGroups = [
    { id: 'property', label: 'Property', items: [
      isOwner && { to: '/settings/property', icon: '🏢', label: 'Property Details', hint: 'Name, address, logo, tax & service, invoice and registration card texts, POS link' },
      isOwner && { to: '/settings/sources', icon: '💳', label: 'Sources & Payments', hint: 'Where bookings come from and how guests pay' },
      isOwner && { to: '/settings/communications', icon: '✉️', label: 'Email & Messages', hint: 'Guest emails, email account, WhatsApp texts' },
      isOwner && { to: '/settings/reports', icon: '📬', label: 'Notifications', hint: 'Telegram alerts and scheduled reports — who gets what' },
      can('loyalty') && hasModule('guest_crm') && { to: '/loyalty', icon: '⭐', label: 'Loyalty', hint: 'Guest tiers and their benefits' },
    ] },
    { id: 'rooms-rates', label: 'Rooms & Rates', items: [
      can('units') && { to: '/units', icon: '🏕', label: 'Units', hint: 'Room types, rooms, rates and capacity' },
      isOwner && res && { to: '/settings/rate-plans', icon: '🍳', label: 'Rate Plans', hint: 'Meal plans: Room Only, Bed & Breakfast…' },
      isOwner && hasModule('channel_manager') && { to: '/settings/channel-manager', icon: '🔗', label: 'Channel Manager', hint: 'Link rooms and meal plans to the OTAs, sending status' },
      // A note of which room each OTA gets — only for a property without the channel manager.
      can('allotments') && res && !hasModule('channel_manager') && { to: '/allotment', icon: '📡', label: 'Allotments', hint: 'Which rooms each OTA gets, month by month' },
    ] },
    { id: 'devices', label: 'Devices & guest screens', items: [
      // What guests see on the room tablets, room TVs and the lobby TV (moved from Operations).
      can('guest_board') && hasModule('in_room_media') && { to: '/settings/board', icon: '📋', label: 'Guest Board', hint: 'Cards, videos and music on the room tablets, room TVs and the lobby TV' },
      can('room_tablets') && { to: '/settings/room-tablets', icon: '📶', label: 'Room Tablets', hint: 'WiFi, battery and connection history per room' },
      can('room_controllers') && hasModule('room_controller') && { to: '/settings/room-controllers', icon: '🎛️', label: 'Room Controllers', hint: 'Lights, AC and relays per room' },
    ] },
    { id: 'access', label: 'Access', items: [
      isOwner && { to: '/users', icon: '👥', label: 'Users', hint: 'Staff logins' },
      isOwner && { to: '/settings/roles', icon: '🔑', label: 'Roles & Permissions', hint: 'What each role can see and do' },
    ] },
  ].map(g => ({ ...g, items: g.items.filter(Boolean) })).filter(g => g.items.length);

  return {
    // The owner's / manager's home (pages/Overview.jsx); front desk start on Today.
    overview: can('overview') ? { to: '/overview', icon: '🧭', label: 'Overview' } : null,
    groups,
    settingsGroups,
    settingsPaths: settingsGroups.flatMap(g => g.items.map(i => i.to)),
    guide: { to: '/guide', icon: '📘', label: 'Guide / Panduan' },
  };
}
