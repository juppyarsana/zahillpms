// Forecast — the days ahead, one row per day, for planning staff and
// breakfast: arrivals / departures / staying over, rooms sold and free,
// guests in house, breakfast and dinner counts, and (for those allowed to see
// money) revenue on the books.
//
// "On the books" only: what is reserved today, nothing projected. Counted by
// the booked DATES with the same status rule as Guest Lists / Reports (every
// booking except cancelled and no-show), so a future day here equals Guest
// Lists for that date and Reports for that night. Today's row is by booked
// dates too — Guest Lists shows today's real check-ins.
const db = require('../db');
const { roomRevPerNightSql } = require('./nightRates');
const { todayWITA } = require('./roomChargeService');

const MAX_DAYS = 92;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const int = v => parseInt(v, 10) || 0;

async function buildForecast(propertyId, { from, days = 14, withMoney = false } = {}) {
  const today = todayWITA();
  const start = from || today;
  if (!DATE_RE.test(start) || isNaN(Date.parse(start))) return null;
  const n = Math.min(MAX_DAYS, Math.max(1, int(days) || 14));
  const end = addDays(start, n - 1);

  const [bookings, addons, units, holidays, money] = await Promise.all([
    // Every stay touching the period (the day before too: its guests have
    // breakfast on the first morning).
    db.query(`
      SELECT b.id, to_char(b.check_in_date, 'YYYY-MM-DD') AS ci, to_char(b.check_out_date, 'YYYY-MM-DD') AS co,
             b.num_guests, b.status, b.reservation_group_id, u.type AS room_type, b.children, b.kids_free_breakfast,
             COALESCE(rp.includes_breakfast, false) AS breakfast,
             COALESCE(rp.includes_lunch, false) AS lunch,
             COALESCE(rp.includes_dinner, false) AS dinner
      FROM bookings b
      JOIN units u ON u.id = b.unit_id
      LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
      WHERE b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
        AND b.check_in_date <= $3::date AND b.check_out_date >= $2::date`, [propertyId, start, end]),
    // Per-night extras (extra beds): the bed on its night, its breakfasts the
    // morning after.
    db.query(`
      SELECT to_char(a.service_date, 'YYYY-MM-DD') AS night, SUM(a.quantity)::int AS beds, SUM(a.breakfasts)::int AS breakfasts
      FROM booking_addons a JOIN bookings b ON b.id = a.booking_id
      WHERE a.property_id = $1 AND a.status = 'active' AND b.status NOT IN ('cancelled', 'no_show')
        AND a.service_date >= b.check_in_date AND a.service_date < b.check_out_date
        AND a.service_date BETWEEN $2::date - 1 AND $3::date
      GROUP BY a.service_date`, [propertyId, start, end]),
    db.query(`
      SELECT u.type AS room_type, u.status, to_char(u.status_expected_back, 'YYYY-MM-DD') AS expected_back
      FROM units u LEFT JOIN room_types rt ON rt.id = u.room_type_id
      WHERE u.property_id = $1 ORDER BY rt.sort_order NULLS LAST, u.type`, [propertyId]),
    db.query(`
      SELECT to_char(holiday_date, 'YYYY-MM-DD') AS date, string_agg(DISTINCT name, ' · ') AS name
      FROM holidays WHERE holiday_date BETWEEN $1::date AND $2::date GROUP BY holiday_date`, [start, end]),
    // Net room + meal-plan revenue per night — the Reports rule.
    withMoney ? db.query(`
      SELECT to_char(gs, 'YYYY-MM-DD') AS night,
             COALESCE(SUM(${roomRevPerNightSql('b', 'gs')}), 0) AS room,
             COALESCE(SUM(COALESCE(b.fnb_revenue, 0) / NULLIF(b.nights, 0)), 0) AS meals,
             COUNT(b.id) FILTER (WHERE b.complimentary_scope IS NULL) AS paid_rooms
      FROM generate_series($2::date, $3::date, '1 day') gs
      LEFT JOIN bookings b ON b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
        AND b.check_in_date <= gs::date AND b.check_out_date > gs::date
      GROUP BY gs`, [propertyId, start, end]) : Promise.resolve({ rows: [] }),
  ]);

  const addonBy = new Map(addons.rows.map(r => [r.night, r]));
  const holidayBy = new Map(holidays.rows.map(r => [r.date, r.name]));
  const moneyBy = new Map(money.rows.map(r => [r.night, r]));
  const types = [...new Set(units.rows.map(u => u.room_type).filter(Boolean))]; // in the owner's room-type order
  const totalRooms = units.rows.length;
  // Out of order is a current status, not dated: a room counts as out until
  // its expected-back date (every day when none was given).
  const outOn = date => units.rows.filter(u => u.status === 'out_of_order' && (!u.expected_back || u.expected_back > date)).length;

  const rows = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    const d = {
      date, holiday: holidayBy.get(date) || null,
      arrivals: 0, arrival_guests: 0, departures: 0, departure_guests: 0, stayovers: 0,
      sold: 0, guests: 0, unpaid: 0, groups: 0,
      breakfast: 0, breakfast_kids: 0, kids: 0, lunch: 0, dinner: 0, extra_beds: addonBy.get(date)?.beds || 0,
      by_type: Object.fromEntries(types.map(t => [t, 0])),
    };
    const groups = new Set();
    for (const b of bookings.rows) {
      const g = int(b.num_guests);
      if (b.ci === date) { d.arrivals++; d.arrival_guests += g; }
      if (b.co === date) { d.departures++; d.departure_guests += g; }
      if (b.ci < date && b.co > date) d.stayovers++;
      if (b.ci <= date && b.co > date) {          // sleeps here tonight
        d.sold++; d.guests += g; d.kids += int(b.children);   // children apart from guests (migration 114)
        if (b.status === 'pending') d.unpaid++;
        if (b.reservation_group_id) groups.add(b.reservation_group_id);
        if (b.room_type in d.by_type) d.by_type[b.room_type]++;
        if (b.dinner) d.dinner += g;
      }
      if (b.ci < date && b.co >= date) {          // slept here last night
        if (b.breakfast) d.breakfast += g;
        if (b.breakfast && b.kids_free_breakfast) d.breakfast_kids += int(b.children);   // free kids' breakfasts, apart
        if (b.lunch && b.co > date) d.lunch += g;
      }
    }
    d.breakfast += addonBy.get(addDays(date, -1))?.breakfasts || 0;
    d.groups = groups.size;
    d.out_of_order = outOn(date);
    d.sellable = totalRooms - d.out_of_order;
    d.free = Math.max(0, d.sellable - d.sold);
    d.occupancy = d.sellable ? Math.round((d.sold / d.sellable) * 100) : 0;
    if (withMoney) {
      const m = moneyBy.get(date);
      const room = parseFloat(m?.room) || 0, meals = parseFloat(m?.meals) || 0, paid = int(m?.paid_rooms);
      d.room_revenue = room; d.meal_revenue = meals; d.revenue = room + meals;
      d.adr = paid ? room / paid : 0;
    }
    rows.push(d);
  }

  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const sellableNights = sum('sellable');
  const totals = {
    arrivals: sum('arrivals'), arrival_guests: sum('arrival_guests'), departures: sum('departures'), departure_guests: sum('departure_guests'),
    sold: sum('sold'), free: sum('free'), guests: sum('guests'),
    breakfast: sum('breakfast'), breakfast_kids: sum('breakfast_kids'), kids: sum('kids'), lunch: sum('lunch'), dinner: sum('dinner'),
    occupancy: sellableNights ? Math.round((sum('sold') / sellableNights) * 100) : 0,
  };
  if (withMoney) {
    totals.room_revenue = sum('room_revenue'); totals.meal_revenue = sum('meal_revenue'); totals.revenue = sum('revenue');
    const paid = money.rows.reduce((s, r) => s + int(r.paid_rooms), 0);
    totals.adr = paid ? totals.room_revenue / paid : 0;
  }
  const busiest = rows.reduce((a, r) => (r.sold > a.sold ? r : a), rows[0]);
  const quietest = rows.reduce((a, r) => (r.sold < a.sold ? r : a), rows[0]);

  return {
    from: start, to: end, days: n, today, total_rooms: totalRooms, room_types: types, with_money: !!withMoney,
    has_lunch: rows.some(r => r.lunch > 0), has_dinner: rows.some(r => r.dinner > 0),
    rows, totals,
    busiest: { date: busiest.date, sold: busiest.sold, occupancy: busiest.occupancy },
    quietest: { date: quietest.date, sold: quietest.sold, occupancy: quietest.occupancy },
  };
}

module.exports = { buildForecast, MAX_DAYS };
