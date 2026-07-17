const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/reports/revenue?month=&year=
router.get('/revenue', auth, requireRole('owner'), async (req, res) => {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const roomQ = db.query(`
      SELECT
        COALESCE(SUM(total_amount), 0) as room_revenue,
        COUNT(*) as bookings_count,
        COALESCE(SUM(nights), 0) as total_nights
      FROM bookings
      WHERE property_id = $3
        AND EXTRACT(MONTH FROM check_in_date) = $1
        AND EXTRACT(YEAR FROM check_in_date) = $2
        AND status IN ('checked_in','checked_out','confirmed')
    `, [month, year, req.propertyId]);

    const ancillaryQ = db.query(`
      SELECT COALESCE(SUM(total_amount), 0) as ancillary_revenue, COUNT(*) as sales_count
      FROM sales
      WHERE property_id = $3 AND EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2
    `, [month, year, req.propertyId]);

    const dailyQ = db.query(`
      SELECT d::date as date, COALESCE(SUM(b.total_amount / NULLIF(b.nights,0)), 0) as room_revenue
      FROM generate_series(
        MAKE_DATE($2::int, $1::int, 1),
        MAKE_DATE($2::int, $1::int, 1) + INTERVAL '1 month' - INTERVAL '1 day',
        '1 day'
      ) d
      LEFT JOIN bookings b ON d::date BETWEEN b.check_in_date AND b.check_out_date - 1
        AND b.status IN ('checked_in','checked_out','confirmed')
        AND b.property_id = $3
      GROUP BY d ORDER BY d
    `, [month, year, req.propertyId]);

    const sourceQ = db.query(`
      SELECT source, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
      FROM bookings
      WHERE property_id = $3
        AND EXTRACT(MONTH FROM check_in_date) = $1
        AND EXTRACT(YEAR FROM check_in_date) = $2
        AND status IN ('checked_in','checked_out','confirmed')
      GROUP BY source
    `, [month, year, req.propertyId]);

    const [{ rows: [room] }, { rows: [ancillary] }, { rows: daily }, { rows: bySource }] = await Promise.all([roomQ, ancillaryQ, dailyQ, sourceQ]);

    res.json({
      month, year,
      room_revenue: parseFloat(room.room_revenue),
      ancillary_revenue: parseFloat(ancillary.ancillary_revenue),
      total_revenue: parseFloat(room.room_revenue) + parseFloat(ancillary.ancillary_revenue),
      bookings_count: parseInt(room.bookings_count),
      total_nights: parseInt(room.total_nights),
      daily_revenue: daily,
      by_source: bySource,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
