const db = require('../db');
const { computeProforma } = require('./folioService');

// External POS integration (migration 070). The POS owns its menu, recipes,
// stock and cash/card payments; the PMS only hears about sales a guest charges
// to their room. Each one becomes a `sales` row (order_source 'external_pos',
// no sale_items — the POS menu is never mirrored into `products`) plus a
// folio_charges row, the same pair restoSettleService posts for a resto tab.
//
// `amount` is NET: after the POS's own discount, before service charge and
// tax — the folio adds the property's service/tax on top of every charge, so
// a gross amount would be taxed twice.

const IN_HOUSE_SQL = `
  SELECT b.id AS booking_id, u.name AS room, u.controller_id AS room_id,
         g.name AS guest_name, b.check_in_date, b.check_out_date, b.num_guests
    FROM bookings b
    JOIN units u ON u.id = b.unit_id
    LEFT JOIN guests g ON g.id = b.guest_id
   WHERE b.property_id = $1 AND b.status = 'checked_in'`;

async function listInHouseRooms(propertyId) {
  const { rows } = await db.query(`${IN_HOUSE_SQL} ORDER BY u.name`, [propertyId]);
  return rows;
}

// A till types a room number: match the room name or its Room ID, any case.
async function lookupRoom(propertyId, room) {
  const { rows } = await db.query(
    `${IN_HOUSE_SQL}
       AND (lower(u.name) = lower($2) OR lower(u.controller_id) = lower($2))
     ORDER BY b.check_in_date DESC LIMIT 1`,
    [propertyId, String(room).trim()]
  );
  return rows[0] || null;
}

// balance_due is the whole-stay estimate (all nights + extras + service/tax −
// payments), same figure as the Balance Due page — the posted ledger leaves
// out nights night audit hasn't posted yet, so it can read low or negative.
async function estimateFor(bookingId, propertyId) {
  return bookingId ? computeProforma(bookingId, propertyId) : null;
}

function saleResult(sale, folioChargeId, folio, replayed) {
  return {
    sale_id: sale.id,
    folio_charge_id: folioChargeId,
    booking_id: sale.booking_id,
    amount: parseFloat(sale.total_amount),
    balance_due: folio ? folio.balance_due : null,
    replayed,
  };
}

// Returns { error, status } or the posted sale. Safe to retry with the same
// externalRef: the original sale comes back with replayed: true.
async function postTransaction(propertyId, { bookingId, room, amount, description, externalRef }) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { error: 'amount must be a positive number', status: 400 };
  const desc = String(description || '').trim().slice(0, 500) || 'Restaurant bill';
  const ref = externalRef ? String(externalRef).trim().slice(0, 100) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    if (ref) {
      const { rows: [existing] } = await client.query(
        `SELECT s.*, fc.id AS folio_charge_id
           FROM sales s LEFT JOIN folio_charges fc ON fc.sale_id = s.id
          WHERE s.property_id = $1 AND s.external_ref = $2 LIMIT 1`,
        [propertyId, ref]
      );
      if (existing) {
        await client.query('ROLLBACK');
        const folio = await estimateFor(existing.booking_id, propertyId);
        return saleResult(existing, existing.folio_charge_id, folio, true);
      }
    }

    // Resolve the stay: an explicit booking_id (from the rooms list) or a
    // typed room number. Either way it must be checked in right now.
    let booking = null;
    if (bookingId) {
      const { rows } = await client.query(
        `SELECT id FROM bookings WHERE id = $1 AND property_id = $2 AND status = 'checked_in' FOR UPDATE`,
        [bookingId, propertyId]
      );
      booking = rows[0];
    } else if (room) {
      const found = await lookupRoom(propertyId, room);
      if (found) {
        const { rows } = await client.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [found.booking_id]);
        booking = rows[0];
      }
    } else {
      await client.query('ROLLBACK');
      return { error: 'room or booking_id is required', status: 400 };
    }
    if (!booking) {
      await client.query('ROLLBACK');
      return { error: 'No guest is checked in to that room', status: 404 };
    }

    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (property_id, booking_id, payment_method, total_amount, order_source, external_ref, description)
       VALUES ($1, $2, 'room_charge', $3, 'external_pos', $4, $5)
       RETURNING *`,
      [propertyId, booking.id, amt, ref, desc]
    );
    const { rows: [charge] } = await client.query(
      `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, sale_id)
       VALUES ($1, 'sale', $2, 1, $3, $3, $4) RETURNING id`,
      [booking.id, desc.slice(0, 200), amt, sale.id]
    );

    await client.query('COMMIT');
    const folio = await estimateFor(booking.id, propertyId);
    return saleResult(sale, charge.id, folio, false);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Two concurrent retries with the same ref: the loser hits the unique
    // index — return the winner's sale instead of an error.
    if (err.code === '23505' && ref) {
      return postTransaction(propertyId, { bookingId, room, amount, description, externalRef: ref });
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listInHouseRooms, lookupRoom, postTransaction };
