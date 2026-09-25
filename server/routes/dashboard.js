const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { computeProforma } = require('../services/folioService');
const { occupiedUntilSql, TODAY_WITA_SQL } = require('../services/occupancySql');

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
      revenueQ,
      tonightQ,
    ] = await Promise.all([
      db.query(`
        SELECT u.id, u.name, u.status, u.type, u.controller_id, u.housekeeping_status,
          u.status_reason, u.status_expected_back, u.status_updated_at,
          sub.name as status_updated_by_name,
          b.id as booking_id, b.source, b.num_guests,
          b.check_in_date, b.check_out_date,
          (b.check_out_date - CURRENT_DATE) as nights_left,
          g.name as guest_name, g.nationality,
          arr.id as arriving_booking_id, arr.source as arriving_source,
          arr.num_guests as arriving_num_guests, arr.check_out_date as arriving_check_out,
          ag.name as arriving_guest_name, ag.nationality as arriving_nationality,
          (SELECT nb.check_in_date FROM bookings nb
           WHERE nb.unit_id = u.id AND nb.property_id = u.property_id AND nb.status IN ('confirmed','deposit_paid','pending')
             AND nb.check_in_date > CURRENT_DATE
           ORDER BY nb.check_in_date LIMIT 1) as next_booking_date,
          (SELECT nb.check_in_date - CURRENT_DATE FROM bookings nb
           WHERE nb.unit_id = u.id AND nb.property_id = u.property_id AND nb.status IN ('confirmed','deposit_paid','pending')
             AND nb.check_in_date > CURRENT_DATE
           ORDER BY nb.check_in_date LIMIT 1) as gap_nights,
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
        LEFT JOIN bookings arr ON arr.unit_id = u.id AND arr.property_id = u.property_id AND arr.status IN ('confirmed','deposit_paid','pending') AND arr.check_in_date = CURRENT_DATE
        LEFT JOIN guests ag ON arr.guest_id = ag.id
        LEFT JOIN room_display_devices rdd ON rdd.controller_id = u.controller_id AND rdd.property_id = u.property_id
        LEFT JOIN users sub ON sub.id = u.status_updated_by
        WHERE u.property_id = $1
        ORDER BY u.name
      `, [req.propertyId]),
      db.query(`
        SELECT b.id, g.name as guest_name, u.name as unit_name, b.num_guests, b.source
        FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
        WHERE b.property_id = $1 AND b.check_in_date = CURRENT_DATE AND b.status IN ('confirmed','deposit_paid','pending')
      `, [req.propertyId]),
      db.query(`
        SELECT b.id, g.name as guest_name, u.name as unit_name
        FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
        WHERE b.property_id = $1 AND b.check_out_date = CURRENT_DATE AND b.status = 'checked_in'
      `, [req.propertyId]),
      db.query(`
        SELECT COUNT(*) as count FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        WHERE b.property_id = $1 AND p.status = 'pending' AND p.amount > 0 AND b.status NOT IN ('cancelled','no_show')
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
      db.query(`
        SELECT
          (SELECT COALESCE(SUM(COALESCE(room_revenue, total_amount)), 0) FROM bookings
           WHERE property_id = $1 AND status IN ('checked_in','checked_out')
             AND DATE_TRUNC('month', check_in_date) = DATE_TRUNC('month', NOW())) as room_revenue_mtd,
          (SELECT COALESCE(SUM(fnb_revenue), 0) FROM bookings
           WHERE property_id = $1 AND status IN ('checked_in','checked_out')
             AND DATE_TRUNC('month', check_in_date) = DATE_TRUNC('month', NOW())) as fnb_revenue_mtd,
          (SELECT COALESCE(SUM(total_amount), 0) FROM sales
           WHERE property_id = $1 AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
             AND confirmation_status IS DISTINCT FROM 'rejected') as ancillary_revenue_mtd
      `, [req.propertyId]),
      // Rooms that will have a guest TONIGHT, from bookings (not units.status,
      // which is "right now" — on a turnover day it still counts guests who
      // leave today and misses those arriving). Same rule as every
      // availability check: staying over + arriving today (checked in or not
      // yet, incl. late arrivals not yet no-showed) + overdue guests.
      db.query(`
        SELECT COUNT(DISTINCT b.unit_id) AS count,
          COUNT(*) FILTER (WHERE b.status = 'checked_in' AND b.check_in_date < ${TODAY_WITA_SQL}
                             AND b.check_out_date > ${TODAY_WITA_SQL}) AS staying,
          COUNT(*) FILTER (WHERE b.status = 'checked_in' AND b.check_out_date <= ${TODAY_WITA_SQL}) AS overdue,
          COUNT(*) FILTER (WHERE b.status <> 'checked_in' OR b.check_in_date = ${TODAY_WITA_SQL}) AS arriving
        FROM bookings b
        WHERE b.property_id = $1
          AND b.status IN ('pending','deposit_paid','confirmed','checked_in')
          AND b.check_in_date <= ${TODAY_WITA_SQL}
          AND ${occupiedUntilSql('b')} > ${TODAY_WITA_SQL}
      `, [req.propertyId]),
    ]);

    const units = occupancyQ.rows;
    const occupied = units.filter(u => u.status === 'occupied').length;
    const t = tonightQ.rows[0];
    const tonight = parseInt(t.count);
    const tonightBreakdown = { staying: parseInt(t.staying), arriving: parseInt(t.arriving), overdue: parseInt(t.overdue) };
    const outOfOrder = units.filter(u => u.status === 'out_of_order').length;

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
      occupancy: { occupied, tonight, tonight_breakdown: tonightBreakdown, out_of_order: outOfOrder, total: units.length, units },
      arrivals_today: arrivalsQ.rows,
      departures_today: departuresQ.rows,
      overdue_checkouts: overdue,
      pending_payments_count: parseInt(pendingPaymentsQ.rows[0].count),
      open_tasks_count: parseInt(openTasksQ.rows[0].count),
      upcoming_birthdays_count: parseInt(birthdaysQ.rows[0].count),
      revenue: revenueQ.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
