// Maps each module to its route file names. Used by middleware/moduleGuard.js
// and the GET /api/settings/modules endpoint (frontend nav visibility).
module.exports = {
  reservations:    { label: 'Reservations',    routes: ['bookings', 'checkin', 'allotments', 'pricing'] },
  front_desk:      { label: 'Front Desk',      routes: ['checkin'] },
  guest_crm:       { label: 'Guest CRM',       routes: ['guests', 'loyalty'] },
  financial:       { label: 'Financial',       routes: ['payments', 'reports', 'nightAudit'] },
  operations:      { label: 'Operations',      routes: ['tasks'] },
  sales:           { label: 'Sales',           routes: ['products', 'sales'] },
  in_room_media:   { label: 'In-Room Media',   routes: ['board', 'display'] },
  room_controller: { label: 'Room Controller', routes: ['iot', 'calls'] },
  insights:        { label: 'Insights',        routes: ['insights'] },
};

// Core routes — always on, no module guard:
// auth, dashboard, settings, units, users
