// Maps each module to its route file names. Used by middleware/moduleGuard.js
// and the GET /api/settings/modules endpoint (frontend nav visibility).
module.exports = {
  reservations:    { label: 'Reservations',    routes: ['bookings', 'checkin', 'allotments', 'pricing', 'ratePlans'] },
  front_desk:      { label: 'Front Desk',      routes: ['checkin'] },
  guest_crm:       { label: 'Guest CRM',       routes: ['guests', 'loyalty'] },
  financial:       { label: 'Financial',       routes: ['payments', 'reports', 'nightAudit', 'folio'] },
  operations:      { label: 'Operations',      routes: ['tasks'] },
  sales:           { label: 'Sales',           routes: ['products', 'sales', 'tables'] },
  in_room_media:   { label: 'In-Room Media',   routes: ['board', 'display'] },
  room_controller: { label: 'Room Controller', routes: ['iot'] },
  insights:        { label: 'Insights',        routes: ['insights'] },
  activities:      { label: 'Activities',      routes: ['activities'] },
  calling:         { label: 'Calling',         routes: ['calls'] },
  // Default OFF (paid add-on tier, same philosophy as the planned back_office
  // module) — see seedPropertyDefaults.js's DEFAULT_OFF list. Assumes `sales`
  // is also on for the property (reads products/restaurant_tables, writes
  // sales) — not enforced in code, just a real dependency to be aware of.
  resto_ordering:  { label: 'Resto Ordering',  routes: ['resto', 'restoGuest'] },
};

// Core routes — always on, no module guard:
// auth, dashboard, settings, units, users
