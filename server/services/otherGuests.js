// Other guests in a room (booking_guests, migration 112) — shared by the
// booking page, Registration Card, police guest report and Guest Lists.
const OTHER_GUESTS_SQL = `
  SELECT bg.booking_id, g.id, g.name, g.nationality, g.id_number, g.whatsapp, g.email, g.address,
         (g.id_document_url IS NOT NULL) AS has_id_document
  FROM booking_guests bg JOIN guests g ON g.id = bg.guest_id
  WHERE bg.booking_id = ANY($1::uuid[])
  ORDER BY bg.created_at`;

// booking id → [other guests], for a list of bookings.
async function otherGuestsFor(client, bookingIds) {
  const map = new Map();
  const ids = [...new Set(bookingIds.filter(Boolean))];
  if (!ids.length) return map;
  const { rows } = await client.query(OTHER_GUESTS_SQL, [ids]);
  for (const { booking_id, ...g } of rows) {
    if (!map.has(booking_id)) map.set(booking_id, []);
    map.get(booking_id).push(g);
  }
  return map;
}

module.exports = { otherGuestsFor };
