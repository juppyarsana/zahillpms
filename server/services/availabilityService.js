// Availability search: which rooms are free for a date range, grouped by
// room type, with the normal price for the stay. Used by Check Availability
// (routes/bookings.js GET /availability-search) and meant to be reused by a
// public booking-engine widget later — call it with includeGuests: false so
// no guest names leave the building.
//
// A room is unavailable when:
//   - another booking overlaps (same rule as every availability check:
//     occupancySql.occupiedUntilSql — overdue guests still block their room)
//   - it's out of order and not expected back before check-in (out of order
//     is a current status, not dated; status_expected_back is the best hint)
// Price = the room's normal rate for each night (base rate + pricing periods,
// pricingService.nightlyRoomRates — same as New Booking) incl. service/tax,
// room only (meal plans are added on the booking).
const db = require('../db');
const { occupiedUntilSql, overdueSql } = require('./occupancySql');
const { nightlyRoomRates } = require('./pricingService');
const { computeFolioTotals, round2 } = require('./folioService');

async function searchAvailability(propertyId, { checkIn, checkOut, guestsPerRoom = 1, includeGuests = true }) {
  const [{ rows: units }, { rows: conflicts }, { rows: [settings] }] = await Promise.all([
    db.query(`
      SELECT u.id, u.name, u.bed_config, u.status, u.status_reason,
             to_char(u.status_expected_back, 'YYYY-MM-DD') AS expected_back,
             u.room_type_id, COALESCE(rt.name, u.type, 'Other') AS type_name,
             COALESCE(rt.max_guests, u.max_guests) AS max_guests, rt.description, rt.sort_order
      FROM units u LEFT JOIN room_types rt ON rt.id = u.room_type_id
      WHERE u.property_id = $1
      ORDER BY rt.sort_order NULLS LAST, type_name, u.name`, [propertyId]),
    db.query(`
      SELECT b.unit_id, g.name AS guest_name, ${overdueSql('b')} AS overdue,
             to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in, to_char(b.check_out_date, 'YYYY-MM-DD') AS check_out
      FROM bookings b JOIN guests g ON g.id = b.guest_id
      WHERE b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
        AND b.check_in_date < $3 AND ${occupiedUntilSql('b')} > $2
      ORDER BY b.check_in_date`, [propertyId, checkIn, checkOut]),
    db.query('SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]),
  ]);

  const busy = new Map();
  for (const c of conflicts) if (!busy.has(c.unit_id)) busy.set(c.unit_id, c);

  const types = new Map();
  for (const u of units) {
    const key = u.room_type_id || `name:${u.type_name}`;
    if (!types.has(key)) {
      types.set(key, {
        room_type_id: u.room_type_id, name: u.type_name, description: u.description || null,
        max_guests: u.max_guests, fits: (u.max_guests || 99) >= guestsPerRoom,
        total_count: 0, available_count: 0, price: null, units: [],
      });
    }
    const t = types.get(key);
    t.total_count++;

    const c = busy.get(u.id);
    const outOfOrder = u.status === 'out_of_order' && (!u.expected_back || u.expected_back > checkIn);
    const room = { id: u.id, name: u.name, bed_config: u.bed_config, available: !c && !outOfOrder };
    if (c) {
      room.reason = c.overdue ? 'overdue' : 'booked';
      room.booked_until = c.check_out;
      if (includeGuests) room.guest_name = c.guest_name;
    } else if (outOfOrder) {
      room.reason = 'out_of_order';
      if (includeGuests) room.note = u.status_reason || null;
      room.expected_back = u.expected_back;
    }
    if (room.available) {
      const rates = await nightlyRoomRates(propertyId, u.id, checkIn, checkOut);
      const total = round2(computeFolioTotals(rates.room_total, settings?.tax_rate, settings?.service_charge_rate).total);
      room.price = total;
      room.nights = rates.night_breakdown.map(n => ({ date: n.date, rate: n.room_rate, period: n.period?.name || null }));
      t.available_count++;
    }
    t.units.push(room);
  }

  const nightsCount = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  const roomTypes = [...types.values()].map(t => {
    const prices = t.units.filter(r => r.available).map(r => r.price);
    if (prices.length) {
      const min = Math.min(...prices), max = Math.max(...prices);
      t.price = { total: min, max_total: max, per_night: round2(min / nightsCount), varies: min !== max };
      // Did the nightly rate change during the stay (a pricing period)?
      const cheapest = t.units.find(r => r.available && r.price === min);
      t.price.varies_by_night = new Set(cheapest.nights.map(n => n.rate)).size > 1;
      t.price.nights = cheapest.nights;
    }
    return t;
  });

  return {
    check_in: checkIn, check_out: checkOut, nights: nightsCount, guests_per_room: guestsPerRoom,
    total_rooms: units.length,
    available_rooms: roomTypes.reduce((s, t) => s + t.available_count, 0),
    room_types: roomTypes,
  };
}

module.exports = { searchAvailability };
