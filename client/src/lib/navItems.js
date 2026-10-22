// The one menu definition (regrouped 2026-10-22): the desktop sidebar
// (components/Sidebar.jsx), the phone "More" drawer (App.jsx BottomNav) and
// the Settings page (pages/SettingsHub.jsx) all read it, so they can't drift
// apart. Each item is shown only when the user's role and the property's
// modules allow it — the same checks as the routes in App.jsx (keep both in
// step when adding a page). Settings items carry a one-line description for
// the Settings page.

export function buildNav({ user, can, hasModule, otaBadge = 0 }) {
  const isOwner = user?.role === 'owner';
  const res = hasModule('reservations');
  const groups = [
    { id: 'front-desk', label: 'Front Desk', items: [
      can('reservations') && res && { to: '/availability', icon: '🔎', label: 'Availability' },
      can('reservations') && res && { to: '/reservations', icon: '📅', label: 'Reservations' },
      can('reservations') && hasModule('channel_manager') && { to: '/ota-bookings', icon: '🌐', label: 'OTA bookings', badge: otaBadge },
      // Quick Check-in is reached from Check-in / out (⚡ Quick Mode); only staff
      // who can't open Check-in / out get it as its own menu item.
      can('quick_checkin') && !can('checkin_full') && res && hasModule('front_desk') && { to: '/quick-checkin', icon: '⚡', label: 'Quick Check-in' },
      can('checkin_full') && res && hasModule('front_desk') && { to: '/checkin', icon: '✅', label: 'Check-in / out' },
      can('guest_lists') && res && { to: '/guest-lists', icon: '🗂', label: 'Guest Lists' },
      can('guests') && hasModule('guest_crm') && { to: '/guests', icon: '👤', label: 'Guests' },
      can('cashier_closing') && hasModule('financial') && { to: '/cashier-closing', icon: '🧾', label: 'Cashier Closing' },
      // Front desk recording the OTAs' weekly withdrawals (migration 126) — only the OTA accounts.
      !can('accounting') && can('ota_payouts') && hasModule('financial') && { to: '/agents', icon: '🏦', label: 'OTA payouts' },
      can('night_audit') && hasModule('financial') && { to: '/night-audit', icon: '🌙', label: 'Night Audit' },
    ] },
    { id: 'services', label: 'Services', items: [
      can('sales') && hasModule('sales') && { to: '/sales', icon: '🛍', label: 'Sales (extras)' },
      can('activities') && hasModule('activities') && { to: '/activities', icon: '🥾', label: 'Activities' },
      can('events') && hasModule('events') && { to: '/events', icon: '🗓', label: 'Events' },
      can('restaurant') && hasModule('pos_integration') && { to: '/restaurant', icon: '🍽', label: 'Restaurant' },
    ] },
    { id: 'operations', label: 'Operations', items: [
      can('operations') && hasModule('operations') && { to: '/operations', icon: '🧰', label: 'Operations' },
      can('guest_board') && hasModule('in_room_media') && { to: '/settings/board', icon: '📋', label: 'Guest Board' },
      isOwner && hasModule('back_office') && { to: '/purchasing', icon: '📦', label: 'Purchasing & Stock' },
    ] },
    { id: 'revenue', label: 'Revenue', items: [
      can('forecast') && res && { to: '/forecast', icon: '🔭', label: 'Forecast' },
      can('pricing') && res && { to: '/pricing', icon: '💰', label: 'Pricing' },
      isOwner && hasModule('financial') && { to: '/reports', icon: '📈', label: 'Reports' },
    ] },
    { id: 'finance', label: 'Finance', items: [
      // In the money's order: what is owed to the hotel, what it spends, the books.
      can('accounting') && hasModule('financial') && { to: '/agents', icon: '🧾', label: 'Receivables' },   // agents, companies, OTAs (owner or the accountant)
      can('accounting') && hasModule('back_office') && { to: '/expenses', icon: '💸', label: 'Expenses' },
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
    { id: 'devices', label: 'Devices', items: [
      can('room_tablets') && { to: '/settings/room-tablets', icon: '📶', label: 'Room Tablets', hint: 'WiFi, battery and connection history per room' },
      can('room_controllers') && hasModule('room_controller') && { to: '/settings/room-controllers', icon: '🎛️', label: 'Room Controllers', hint: 'Lights, AC and relays per room' },
    ] },
    { id: 'access', label: 'Access', items: [
      can('users') && { to: '/users', icon: '👥', label: 'Users', hint: 'Staff logins' },
      isOwner && { to: '/settings/roles', icon: '🔑', label: 'Roles & Permissions', hint: 'What each role can see and do' },
    ] },
  ].map(g => ({ ...g, items: g.items.filter(Boolean) })).filter(g => g.items.length);

  return {
    dashboard: can('dashboard') ? { to: '/', end: true, icon: '📊', label: 'Dashboard' } : null,
    groups,
    settingsGroups,
    settingsPaths: settingsGroups.flatMap(g => g.items.map(i => i.to)),
    guide: { to: '/guide', icon: '📘', label: 'Guide / Panduan' },
  };
}
