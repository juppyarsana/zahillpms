const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

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
    ] = await Promise.all([
      db.query(`
        SELECT u.id, u.name, u.status,
          b.id as booking_id, b.source, b.num_guests,
          b.check_in_date, b.check_out_date,
          (b.check_out_date - CURRENT_DATE) as nights_left,
          g.name as guest_name, g.nationality,
          arr.id as arriving_booking_id, arr.source as arriving_source,
          arr.num_guests as arriving_num_guests, arr.check_out_date as arriving_check_out,
          ag.name as arriving_guest_name, ag.nationality as arriving_nationality,
          (SELECT nb.check_in_date FROM bookings nb
           WHERE nb.unit_id = u.id AND nb.status IN ('confirmed','pending')
             AND nb.check_in_date > CURRENT_DATE
           ORDER BY nb.check_in_date LIMIT 1) as next_booking_date,
          (SELECT nb.check_in_date - CURRENT_DATE FROM bookings nb
           WHERE nb.unit_id = u.id AND nb.status IN ('confirmed','pending')
             AND nb.check_in_date > CURRENT_DATE
           ORDER BY nb.check_in_date LIMIT 1) as gap_nights
        FROM units u
        LEFT JOIN bookings b ON b.unit_id = u.id AND b.status = 'checked_in'
        LEFT JOIN guests g ON b.guest_id = g.id
        LEFT JOIN bookings arr ON arr.unit_id = u.id AND arr.status IN ('confirmed','pending') AND arr.check_in_date = CURRENT_DATE
        LEFT JOIN guests ag ON arr.guest_id = ag.id
        ORDER BY u.name
      `),
      db.query(`
        SELECT b.id, g.name as guest_name, u.name as unit_name, b.num_guests, b.source
        FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
        WHERE b.check_in_date = CURRENT_DATE AND b.status IN ('confirmed','pending')
      `),
      db.query(`
        SELECT b.id, g.name as guest_name, u.name as unit_name
        FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
        WHERE b.check_out_date = CURRENT_DATE AND b.status = 'checked_in'
      `),
      db.query(`
        SELECT COUNT(*) as count FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        WHERE p.status = 'pending' AND p.amount > 0 AND b.status NOT IN ('cancelled','no_show')
      `),
      db.query(`SELECT COUNT(*) as count FROM tasks WHERE status != 'done'`),
      db.query(`
        SELECT COUNT(*) as count FROM guests
        WHERE birthday IS NOT NULL
          AND (
            (DATE_TRUNC('year', NOW()) + (birthday - DATE_TRUNC('year', birthday))) BETWEEN NOW() AND NOW() + INTERVAL '30 days'
            OR
            (DATE_TRUNC('year', NOW()) + INTERVAL '1 year' + (birthday - DATE_TRUNC('year', birthday))) BETWEEN NOW() AND NOW() + INTERVAL '30 days'
          )
      `),
      db.query(`
        SELECT
          (SELECT COALESCE(SUM(total_amount), 0) FROM bookings
           WHERE status IN ('checked_in','checked_out')
             AND DATE_TRUNC('month', check_in_date) = DATE_TRUNC('month', NOW())) as room_revenue_mtd,
          (SELECT COALESCE(SUM(total_amount), 0) FROM sales
           WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())) as ancillary_revenue_mtd
      `),
    ]);

    const units = occupancyQ.rows;
    const occupied = units.filter(u => u.status === 'occupied').length;

    res.json({
      occupancy: { occupied, total: units.length, units },
      arrivals_today: arrivalsQ.rows,
      departures_today: departuresQ.rows,
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
