const db = require('../db');
const sse = require('../sse');

// Sends a guest-facing message to a room's Room Display. Single write path so
// a future automated trigger (checkout reminder, order-ready) can reuse it
// alongside the manual send in routes/bookings.js.
async function sendMessage(propertyId, { unitId, bookingId, body, sentBy }) {
  const { rows } = await db.query(
    `INSERT INTO guest_messages (property_id, unit_id, booking_id, body, sent_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [propertyId, unitId, bookingId || null, body, sentBy || null]
  );
  const message = rows[0];

  const { rows: unitRows } = await db.query('SELECT controller_id FROM units WHERE id = $1', [unitId]);
  const controllerId = unitRows[0]?.controller_id;
  if (controllerId) sse.notify(controllerId, { type: 'message' });

  return message;
}

module.exports = { sendMessage };
