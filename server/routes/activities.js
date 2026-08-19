const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const activityBookingService = require('../services/activityBookingService');
const activitiesService = require('../services/activitiesService');

// GET /api/activities — catalog
router.get('/', auth, async (req, res) => {
  const { category, available } = req.query;
  let query = 'SELECT * FROM activities WHERE property_id = $1';
  const params = [req.propertyId];
  if (category) { params.push(category); query += ` AND category = $${params.length}`; }
  if (available !== undefined) { params.push(available === 'true'); query += ` AND is_available = $${params.length}`; }
  query += ' ORDER BY sort_order, name';
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/activities
router.post('/', auth, requireRole('owner'), async (req, res) => {
  const { name, category, price, description, duration_minutes, capacity_per_slot } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });
  try {
    const activity = await activitiesService.createActivity(req.propertyId, { name, category, price, description, duration_minutes, capacity_per_slot });
    res.status(201).json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/activities/:id
router.put('/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, category, price, description, duration_minutes, capacity_per_slot, is_available } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE activities SET
        name = COALESCE($1, name), category = COALESCE($2, category),
        price = COALESCE($3, price), description = COALESCE($4, description),
        duration_minutes = COALESCE($5, duration_minutes), capacity_per_slot = COALESCE($6, capacity_per_slot),
        is_available = COALESCE($7, is_available)
       WHERE id = $8 AND property_id = $9 RETURNING *`,
      [name, category, price, description, duration_minutes, capacity_per_slot, is_available, req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Activity not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/bookings — ?date=&status=&booking_id=
router.get('/bookings', auth, async (req, res) => {
  const { date, status, booking_id } = req.query;
  let query = `
    SELECT ab.*, a.name AS activity_name, a.category AS activity_category,
           b.id AS room_booking_id, g.name AS room_guest_name, u.name AS unit_name
    FROM activity_bookings ab
    JOIN activities a ON a.id = ab.activity_id
    LEFT JOIN bookings b ON b.id = ab.booking_id
    LEFT JOIN guests g ON g.id = b.guest_id
    LEFT JOIN units u ON u.id = b.unit_id
    WHERE ab.property_id = $1`;
  const params = [req.propertyId];
  if (date) { params.push(date); query += ` AND ab.scheduled_date = $${params.length}`; }
  if (status) { params.push(status); query += ` AND ab.status = $${params.length}`; }
  if (booking_id) { params.push(booking_id); query += ` AND ab.booking_id = $${params.length}`; }
  query += ' ORDER BY ab.scheduled_date, ab.scheduled_time NULLS LAST';
  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/bookings/summary?month=&year= — revenue by status
router.get('/bookings/summary', auth, requireRole('owner'), async (req, res) => {
  const now = new Date();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const year = parseInt(req.query.year) || now.getFullYear();
  try {
    const { rows } = await db.query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total
       FROM activity_bookings
       WHERE property_id = $1
         AND EXTRACT(MONTH FROM scheduled_date) = $2
         AND EXTRACT(YEAR FROM scheduled_date) = $3
       GROUP BY status`,
      [req.propertyId, month, year]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/activities/bookings — staff desk booking (auto-confirmed)
router.post('/bookings', auth, async (req, res) => {
  const { activity_id, booking_id, guest_name, guest_phone, scheduled_date, scheduled_time,
    num_participants, payment_method, pickup_location, notes } = req.body;
  if (!activity_id || !scheduled_date) return res.status(400).json({ error: 'activity_id and scheduled_date required' });
  try {
    const result = await activityBookingService.createBooking(req.propertyId, {
      activityId: activity_id, bookingId: booking_id || null, guestName: guest_name, guestPhone: guest_phone,
      scheduledDate: scheduled_date, scheduledTime: scheduled_time, numParticipants: num_participants,
      paymentMethod: payment_method, pickupLocation: pickup_location, notes,
      bookedVia: 'staff', createdBy: req.user.id, autoConfirm: true,
    });
    if (result.code === 'CAPACITY_FULL') return res.status(409).json({ error: result.error, code: result.code });
    if (result.error) return res.status(404).json({ error: result.error });
    res.status(201).json(result.booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/activities/bookings/:id/status
router.patch('/bookings/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  try {
    const result = await activityBookingService.setStatus(req.propertyId, req.params.id, status, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result.booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
