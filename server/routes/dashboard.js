const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { computeProforma } = require('../services/folioService');
const { TODAY_WITA_SQL } = require('../services/occupancySql');
const moduleGuard = require('../middleware/moduleGuard');
const requireOwnerOrMenu = require('../middleware/requireOwnerOrMenu');
const { todayWITA } = require('../services/roomChargeService');
const { bookingsMade } = require('../services/bookingPickup');
const { GROUP_OWED_SQL } = require('../services/groupBilling');

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const pax = list => list.reduce((s, r) => s + (parseInt(r.num_guests, 10) || 0), 0);

// "Today" / "Tomorrow" at a glance — built on the Guest Lists page's own
// loadGuestLists (so the Dashboard, Guest Lists and the Morning Brief always
// show the same numbers) and bookingPickup (reservations made today, same as
// the Reservations page's "Booked on" view and the Daily Close).
// Totals are fixed for the whole day; progress (arrived / checked out) is
// shown inside them. Tonight = arriving (whose stay covers tonight) +
// staying over + overdue — the same rule every availability check uses.
async function todayAtAGlance(propertyId, sellable) {
  const { loadGuestLists } = require('./bookings');   // lazy: bookings.js is large
  const today = todayWITA();
  const tomorrow = addDays(today, 1);
  const [gl, glTomorrow, made] = await Promise.all([
    loadGuestLists(propertyId, today, { balances: false }),
    loadGuestLists(propertyId, tomorrow, { balances: false }),
    bookingsMade(propertyId, today),
  ]);
  const arrivedS = r => r.status === 'checked_in' || r.status === 'checked_out';
  const arrivingTonight = gl.arrivals.filter(a => a.check_out_date > today);
  const overdue = gl.departures.filter(d => d.overdue);
  const tonightRooms = arrivingTonight.length + gl.in_house.length + overdue.length;
  const tmTonight = glTomorrow.arrivals.length + glTomorrow.in_house.length;
  const pct = n => (sellable > 0 ? Math.round((n / sellable) * 100) : 0);
  return {
    date: today,
    arriving: {
      rooms: gl.arrivals.length, guests: pax(gl.arrivals),
      arrived: gl.arrivals.filter(arrivedS).length,
      to_come: gl.arrivals.filter(a => !arrivedS(a)).length,
      late: gl.arrivals.filter(a => a.late_arrival).length,
    },
    staying: { rooms: gl.in_house.length, guests: pax(gl.in_house) },
    departing: {
      rooms: gl.departures.length, guests: pax(gl.departures),
      out: gl.departures.filter(d => d.status === 'checked_out').length,
      to_go: gl.departures.filter(d => d.status !== 'checked_out').length,
      overdue: overdue.length,
    },
    tonight: {
      rooms: tonightRooms,
      guests: pax(arrivingTonight) + pax(gl.in_house) + pax(overdue),
      arriving: arrivingTonight.length, staying: gl.in_house.length, overdue: overdue.length,
      sellable, pct: pct(tonightRooms),
    },
    made: { ...made.made, cancelled: made.cancelled },
    // Stays already over that never checked in — not counted anywhere above.
    never_arrived: gl.never_arrived.map(r => ({
      id: r.id, unit_name: r.unit_name, guest_name: r.guest_name,
      check_in_date: r.check_in_date, check_out_date: r.check_out_date, status: r.status,
    })),
    tomorrow: {
      date: tomorrow,
      arriving: { rooms: glTomorrow.arrivals.length, guests: pax(glTomorrow.arrivals) },
      departing: { rooms: glTomorrow.departures.length, guests: pax(glTomorrow.departures) },
      staying: { rooms: glTomorrow.in_house.length, guests: pax(glTomorrow.in_house) },
      tonight: { rooms: tmTonight, pct: pct(tmTonight) },
    },
  };
}

// GET /api/dashboard/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const [
      occupancyQ,
      arrivalsQ,
      departuresQ,
      pendingPaymentsQ,
      openTasksQ,
      birthdaysQ,
    ] = await Promise.all([
      db.query(`
        SELECT u.id, u.name, u.status, u.type, u.controller_id, u.housekeeping_status,
          u.status_reason, u.status_expected_back, u.status_updated_at,
          sub.name as status_updated_by_name,
          b.id as booking_id, b.source, b.num_guests,
          b.check_in_date, b.check_out_date,
          (b.check_out_date - ${TODAY_WITA_SQL}) as nights_left,
          g.name as guest_name, g.nationality,
          arr.id as arriving_booking_id, arr.source as arriving_source,
          arr.num_guests as arriving_num_guests, arr.check_out_date as arriving_check_out,
          ag.name as arriving_guest_name, ag.nationality as arriving_nationality,
          nb.check_in_date as next_booking_date,
          nb.check_in_date - ${TODAY_WITA_SQL} as gap_nights,
          nb.id as next_booking_id, nb.guest_name as next_guest_name,
          rdd.battery_level as tablet_battery_level,
          rdd.battery_charging as tablet_battery_charging,
          rdd.power_source as tablet_power_source,
          rdd.network_type as tablet_network_type,
          rdd.internet_ok as tablet_internet_ok,
          rdd.wifi_ssid as tablet_wifi_ssid,
          rdd.wifi_rssi as tablet_wifi_rssi,
          rdd.app_version as tablet_app_version,
          rdd.webview_version as tablet_webview_version,
          rdd.last_seen_at as tablet_last_seen_at
        FROM units u
        LEFT JOIN bookings b ON b.unit_id = u.id AND b.property_id = u.property_id AND b.status = 'checked_in'
        LEFT JOIN guests g ON b.guest_id = g.id
        LEFT JOIN bookings arr ON arr.unit_id = u.id AND arr.property_id = u.property_id AND arr.status IN ('confirmed','deposit_paid','pending') AND arr.check_in_date = ${TODAY_WITA_SQL}
        LEFT JOIN guests ag ON arr.guest_id = ag.id
        LEFT JOIN LATERAL (
          SELECT nb.id, nb.check_in_date, ng.name AS guest_name FROM bookings nb
          JOIN guests ng ON ng.id = nb.guest_id
          WHERE nb.unit_id = u.id AND nb.property_id = u.property_id AND nb.status IN ('confirmed','deposit_paid','pending')
            AND nb.check_in_date > ${TODAY_WITA_SQL}
          ORDER BY nb.check_in_date LIMIT 1
        ) nb ON true
        LEFT JOIN room_display_devices rdd ON rdd.controller_id = u.controller_id AND rdd.property_id = u.property_id
        LEFT JOIN users sub ON sub.id = u.status_updated_by
        WHERE u.property_id = $1
        ORDER BY u.name
      `, [req.propertyId]),
      db.query(`
        SELECT b.id, g.name as guest_name, u.name as unit_name, b.num_guests, b.source
        FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
        WHERE b.property_id = $1 AND b.check_in_date = ${TODAY_WITA_SQL} AND b.status IN ('confirmed','deposit_paid','pending')
      `, [req.propertyId]),
      db.query(`
        SELECT b.id, g.name as guest_name, u.name as unit_name
        FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
        WHERE b.property_id = $1 AND b.check_out_date = ${TODAY_WITA_SQL} AND b.status = 'checked_in'
      `, [req.propertyId]),
      db.query(`
        SELECT (SELECT COUNT(*) FROM payments p
                JOIN bookings b ON p.booking_id = b.id
                WHERE b.property_id = $1 AND p.status = 'pending' AND p.amount > 0 AND b.status NOT IN ('cancelled','no_show'))
             -- + groups billed as a whole still owing (migration 097)
             + (SELECT COUNT(*) FROM (${GROUP_OWED_SQL}) go WHERE go.owed >= 1) AS count
      `, [req.propertyId]),
      db.query(`SELECT COUNT(*) as count FROM tasks WHERE property_id = $1 AND status != 'done'`, [req.propertyId]),
      db.query(`
        SELECT COUNT(*) as count FROM guests
        WHERE property_id = $1
          AND birthday IS NOT NULL
          AND (
            (DATE_TRUNC('year', NOW()) + (birthday - DATE_TRUNC('year', birthday))) BETWEEN NOW() AND NOW() + INTERVAL '30 days'
            OR
            (DATE_TRUNC('year', NOW()) + INTERVAL '1 year' + (birthday - DATE_TRUNC('year', birthday))) BETWEEN NOW() AND NOW() + INTERVAL '30 days'
          )
      `, [req.propertyId]),
    ]);

    const units = occupancyQ.rows;
    const occupied = units.filter(u => u.status === 'occupied').length;
    const outOfOrder = units.filter(u => u.status === 'out_of_order').length;
    const today = await todayAtAGlance(req.propertyId, units.length - outOfOrder);

    // Guests still checked in AFTER their check-out date (staff forgot to
    // check them out, or the stay was extended without amending the dates).
    // Their room stays blocked until it's sorted (see bookings.js
    // occupiedUntilSql) — the Dashboard banner makes sure someone notices.
    const { rows: overdue } = await db.query(`
      SELECT b.id, b.check_out_date, g.name AS guest_name, u.name AS unit_name,
             ((NOW() AT TIME ZONE 'Asia/Makassar')::date - b.check_out_date) AS days_overdue
      FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
      WHERE b.property_id = $1 AND b.status = 'checked_in'
        AND b.check_out_date < (NOW() AT TIME ZONE 'Asia/Makassar')::date
      ORDER BY b.check_out_date, u.name
    `, [req.propertyId]);
    for (const o of overdue) {
      const pf = await computeProforma(o.id, req.propertyId);
      o.balance_due = pf ? Math.max(0, pf.balance_due) : 0;
    }

    res.json({
      occupancy: {
        occupied, tonight: today.tonight.rooms,
        tonight_breakdown: { staying: today.tonight.staying, arriving: today.tonight.arriving, overdue: today.tonight.overdue },
        out_of_order: outOfOrder, total: units.length, units,
      },
      today,
      arrivals_today: arrivalsQ.rows,
      departures_today: departuresQ.rows,
      overdue_checkouts: overdue,
      pending_payments_count: parseInt(pendingPaymentsQ.rows[0].count),
      open_tasks_count: parseInt(openTasksQ.rows[0].count),
      upcoming_birthdays_count: parseInt(birthdaysQ.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/month — the Dashboard's "This Month" section. Owners,
// or staff with the month_summary permission (Roles & Permissions).
// Every figure comes from the Reports page's getReport() / bookingPickup, so
// it matches /reports, the Daily Close and the Monthly Report.
//   so far       = 1st → today (tonight's night included — it's sold)
//   vs last month = the same days of last month (1–27 Aug vs 1–27 Sep),
//                   not a whole month against a partial one
//   on the books = the whole month: nights stayed so far + nights still
//                  booked (= the Reports page's "This month")
router.get('/month', auth, moduleGuard('financial'), requireOwnerOrMenu('month_summary'), async (req, res) => {
  try {
    const { getReport } = require('./reports');
    const pid = req.propertyId;
    const today = todayWITA();
    const [y, m, d] = today.split('-').map(Number);
    const pad = n => String(n).padStart(2, '0');
    const monthLen = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const first = `${y}-${pad(m)}-01`;
    const last = `${y}-${pad(m)}-${pad(monthLen(y, m))}`;
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const prevDays = Math.min(d, monthLen(py, pm));
    const prevFirst = `${py}-${pad(pm)}-01`;
    const prevTo = `${py}-${pad(pm)}-${pad(prevDays)}`;

    const [{ rows: [u] }, soFar, prev, books, made, madePrev, { rows: [unpaid] }] = await Promise.all([
      db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order') AS sellable FROM units WHERE property_id = $1`, [pid]),
      getReport(pid, first, today),
      getReport(pid, prevFirst, prevTo),
      getReport(pid, first, last),
      bookingsMade(pid, first, today),
      bookingsMade(pid, prevFirst, prevTo),
      // + groups billed as a whole (migration 097), each counted as one
      db.query(`
        WITH owed AS (
          SELECT b.id::text AS ref, p.amount
          FROM payments p JOIN bookings b ON b.id = p.booking_id
          WHERE b.property_id = $1 AND p.status = 'pending' AND p.amount > 0
            AND b.status NOT IN ('cancelled', 'no_show')
          UNION ALL
          SELECT go.id::text, go.owed FROM (${GROUP_OWED_SQL}) go WHERE go.owed >= 1
        )
        SELECT COUNT(DISTINCT ref) AS bookings, COALESCE(SUM(amount), 0) AS amount FROM owed`, [pid]),
    ]);
    const sellable = parseInt(u.sellable, 10) || 0;
    const figures = (r, days) => ({
      revenue: r.total_revenue,
      room: r.room_revenue, meals: r.fnb_revenue, extras: r.ancillary_revenue, activities: r.activity_revenue || 0,
      room_nights: r.total_nights,
      occupancy: sellable && days ? Math.round((r.total_nights / (sellable * days)) * 100) : 0,
      adr: r.paid_nights > 0 ? r.room_revenue / r.paid_nights : 0,
      revpar: sellable && days ? r.room_revenue / (sellable * days) : 0,
      comp_nights: r.comp_nights,
    });
    const pctChange = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);
    const cur = figures(soFar, d);
    const before = figures(prev, prevDays);
    const top = [...books.by_source]
      .map(s => ({ source: s.source, count: parseInt(s.count, 10), revenue: parseFloat(s.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    const booksRevenue = books.total_revenue;
    const stayRevenue = books.room_revenue + books.fnb_revenue;   // by_source is stays only

    res.json({
      month: `${y}-${pad(m)}`, from: first, to: today, last_day: last, days: d,
      prev: { from: prevFirst, to: prevTo },
      sellable,
      so_far: cur,
      last_month: before,
      change: {
        revenue: pctChange(cur.revenue, before.revenue),
        occupancy_pts: before.room_nights ? cur.occupancy - before.occupancy : null,
        adr: pctChange(cur.adr, before.adr),
        made_value: pctChange(made.made.value, madePrev.made.value),
      },
      on_the_books: {
        revenue: booksRevenue,
        room_nights: books.total_nights,
        occupancy: sellable ? Math.round((books.total_nights / (sellable * monthLen(y, m))) * 100) : 0,
      },
      made: { ...made.made, cancelled: made.cancelled },
      made_last_month: { ...madePrev.made, cancelled: madePrev.cancelled },
      // Whole month, night by night (future nights = already booked).
      daily: books.daily_revenue.map(r => ({
        date: typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
        revenue: parseFloat(r.room_revenue) + parseFloat(r.fnb_revenue) + (r.ancillary_revenue || 0),
        rooms: parseInt(r.nights_sold, 10),
      })),
      by_source: top.map(s => ({ ...s, share: stayRevenue > 0 ? Math.round((s.revenue / stayRevenue) * 100) : 0 })),
      unpaid: { bookings: parseInt(unpaid.bookings, 10), amount: parseFloat(unpaid.amount) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
