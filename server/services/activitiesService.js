const db = require('../db');

// Single write path for creating a catalog row in `activities` — used by both
// routes/activities.js's own POST / (staff entry point) and routes/board.js
// (Guest Board "Paid" toggle entry point), so a card and a catalog row never
// diverge on how they were inserted. `activities` stays the sole owner of
// commerce fields — see CLAUDE.md.
async function createActivity(propertyId, { name, category, price, description, duration_minutes, capacity_per_slot }) {
  const { rows: [activity] } = await db.query(
    `INSERT INTO activities (name, category, price, description, duration_minutes, capacity_per_slot, property_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, category || 'tour', price, description || null, duration_minutes || null, capacity_per_slot || null, propertyId]
  );
  return activity;
}

// Unlink path for a Guest Board card going from Paid back to Free — the
// linked activities row is never deleted (activity_bookings has an
// ON DELETE RESTRICT FK to it), just marked unavailable.
async function setAvailability(propertyId, activityId, isAvailable) {
  const { rows: [activity] } = await db.query(
    'UPDATE activities SET is_available = $1 WHERE id = $2 AND property_id = $3 RETURNING *',
    [isAvailable, activityId, propertyId]
  );
  return activity;
}

module.exports = { createActivity, setAvailability };
