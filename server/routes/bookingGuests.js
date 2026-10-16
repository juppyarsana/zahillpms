const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Other guests in the room (booking_guests, migration 112): optional, added on
// the booking page or at check-in. The booking stays under its main guest
// (bookings.guest_id); these are only who else sleeps in the room — for the
// Registration Card, the police guest report, Guest Lists and their own guest
// profile. Mounted at /api/bookings (reservations module), before
// routes/bookings.js.

const { otherGuestsFor } = require('../services/otherGuests');

const clean = v => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();

async function loadBooking(client, id, propertyId) {
  const { rows: [b] } = await client.query(
    `SELECT b.id, b.status, b.guest_id FROM bookings b WHERE b.id = $1 AND b.property_id = $2`, [id, propertyId]);
  return b;
}

// GET /api/bookings/:id/guests — the other guests in the room.
router.get('/:id/guests', auth, async (req, res) => {
  try {
    const b = await loadBooking(db, req.params.id, req.propertyId);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    res.json((await otherGuestsFor(db, [b.id])).get(b.id) || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/guests — { guest_id } or { new_guest: { name, nationality, id_number, whatsapp, email } }
router.post('/:id/guests', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const b = await loadBooking(client, req.params.id, req.propertyId);
    if (!b) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    if (['cancelled', 'no_show'].includes(b.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot add a guest — booking is ${b.status.replace('_', ' ')}` });
    }
    let guest;
    const ng = req.body.new_guest;
    if (ng) {
      const name = clean(ng.name);
      if (!name) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Guest name is required' }); }
      ({ rows: [guest] } = await client.query(
        `INSERT INTO guests (name, nationality, id_number, whatsapp, email, property_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name`,
        [name, clean(ng.nationality), clean(ng.id_number), clean(ng.whatsapp), clean(ng.email), req.propertyId]));
    } else if (req.body.guest_id) {
      ({ rows: [guest] } = await client.query('SELECT id, name FROM guests WHERE id = $1 AND property_id = $2', [req.body.guest_id, req.propertyId]));
      if (!guest) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Guest not found' }); }
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'guest_id or new_guest is required' });
    }
    if (guest.id === b.guest_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `${guest.name} is already the main guest of this booking` });
    }
    const { rowCount } = await client.query(
      `INSERT INTO booking_guests (property_id, booking_id, guest_id, created_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (booking_id, guest_id) DO NOTHING`, [req.propertyId, b.id, guest.id, req.user.id]);
    if (!rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: `${guest.name} is already on this booking` }); }
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [b.id, `Other guest added: ${guest.name}`, req.user.id]);
    await client.query('COMMIT');
    res.status(201).json({ guest, guests: (await otherGuestsFor(db, [b.id])).get(b.id) || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/bookings/:id/guests/:guestId — take a guest off the room (the
// guest profile itself is kept).
router.delete('/:id/guests/:guestId', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const b = await loadBooking(client, req.params.id, req.propertyId);
    if (!b) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const { rows: [gone] } = await client.query(
      `DELETE FROM booking_guests bg USING guests g
       WHERE bg.booking_id = $1 AND bg.guest_id = $2 AND bg.property_id = $3 AND g.id = bg.guest_id
       RETURNING g.name`, [b.id, req.params.guestId, req.propertyId]);
    if (!gone) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Guest is not on this booking' }); }
    await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [b.id, `Other guest removed: ${gone.name}`, req.user.id]);
    await client.query('COMMIT');
    res.json({ guests: (await otherGuestsFor(db, [b.id])).get(b.id) || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
