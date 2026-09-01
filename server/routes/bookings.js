const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { sendBookingEmail, sendGroupBookingEmail } = require('../services/mailer');
const { computeFolioTotals, round2 } = require('../services/folioService');
const ratePlanService = require('../services/ratePlanService');
const roomCharge = require('../services/roomChargeService');

// Gross-up factor F = (1 + service_charge_rate/100) * (1 + tax_rate/100).
async function grossFactor(client, propertyId) {
  const { rows: [s] } = await client.query(
    'SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]
  );
  const tax = parseFloat(s?.tax_rate ?? 0) / 100;
  const sc = parseFloat(s?.service_charge_rate ?? 0) / 100;
  return { F: (1 + sc) * (1 + tax), tax_rate: s?.tax_rate ?? 0, service_charge_rate: s?.service_charge_rate ?? 0 };
}

const BED_PREFS = ['double', 'twin', 'twin_or_double', 'other'];

// Split a stay's gross post-discount total into NET room + NET meal amounts.
// meal is rate-plan-derived and fixed; room absorbs the rest.
function splitRevenue({ grossNet, nights, ratePlan, numGuests, F, clientRoomRevenue }) {
  const mealNet = round2(ratePlanService.mealNetPerNight(ratePlan, numGuests) * nights);
  let roomNet;
  if (clientRoomRevenue !== undefined && clientRoomRevenue !== null && clientRoomRevenue !== '') {
    roomNet = round2(parseFloat(clientRoomRevenue));
  } else {
    roomNet = round2(grossNet / F - mealNet);
  }
  if (roomNet < 0) roomNet = 0;
  return { roomNet, mealNet };
}

// GET /api/bookings
router.get('/', auth, async (req, res) => {
  const { month, year, unit_id, status, group_id } = req.query;
  let query = `
    SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, u.name as unit_name,
           u.bed_config, rp.code as rate_plan_code, rp.name as rate_plan_name,
           EXISTS(
             SELECT 1 FROM checkin_records cr
             WHERE cr.booking_id = b.id
               AND cr.condition_notes IS NOT NULL
               AND cr.condition_notes <> ''
           ) AS has_condition_notes
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN units u ON b.unit_id = u.id
    LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
    WHERE b.property_id = $1
  `;
  const params = [req.propertyId];
  if (month && year) {
    params.push(year, month);
    query += ` AND EXTRACT(YEAR FROM b.check_in_date) = $${params.length-1} AND EXTRACT(MONTH FROM b.check_in_date) = $${params.length}`;
  }
  if (unit_id) { params.push(unit_id); query += ` AND b.unit_id = $${params.length}`; }
  if (status) { params.push(status); query += ` AND b.status = $${params.length}`; }
  if (group_id) { params.push(group_id); query += ` AND b.reservation_group_id = $${params.length}`; }
  query += ' ORDER BY b.check_in_date';

  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/today/arrivals
router.get('/today/arrivals', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.nationality,
             u.name as unit_name, u.bed_config, rp.code as rate_plan_code,
             (b.deposit_amount = 0 OR b.deposit_amount IS NULL OR EXISTS(
               SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'deposit' AND p.status = 'received'
             )) as deposit_paid,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
      WHERE b.property_id = $1
        AND b.check_in_date <= CURRENT_DATE
        AND b.status IN ('confirmed','deposit_paid','pending')
      ORDER BY b.check_in_date DESC, g.name
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/today/departures
router.get('/today/departures', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp,
             u.name as unit_name,
             EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance' AND p.status = 'received') as balance_paid,
             (SELECT p.amount FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance') as balance_amount,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.property_id = $1
        AND b.check_out_date = CURRENT_DATE
        AND b.status = 'checked_in'
      ORDER BY g.name
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/in-house  (all currently checked-in guests)
router.get('/in-house', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp,
             u.name as unit_name,
             b.check_out_date < CURRENT_DATE as overdue,
             EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance' AND p.status = 'received') as balance_paid,
             (SELECT p.amount FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance') as balance_amount,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.property_id = $1
        AND b.status = 'checked_in'
      ORDER BY b.check_out_date, g.name
    `, [req.propertyId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/availability?unit_id=&check_in=&check_out=&exclude_booking_id=
router.get('/availability', auth, async (req, res) => {
  const { unit_id, check_in, check_out, exclude_booking_id } = req.query;
  if (!unit_id || !check_in || !check_out) {
    return res.status(400).json({ error: 'unit_id, check_in, check_out required' });
  }
  try {
    const { rows: unitRows } = await db.query('SELECT id FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!unitRows[0]) return res.status(404).json({ error: 'Unit not found' });

    const conflictParams = [unit_id, check_in, check_out, req.propertyId];
    let excludeClause = '';
    if (exclude_booking_id) { conflictParams.push(exclude_booking_id); excludeClause = `AND b.id != $${conflictParams.length}`; }
    const conflictQ = db.query(`
      SELECT b.id, b.check_in_date, b.check_out_date, b.status, g.name as guest_name
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      WHERE b.unit_id = $1
        AND b.property_id = $4
        AND b.status NOT IN ('cancelled','no_show')
        AND b.check_in_date < $3
        AND b.check_out_date > $2
        ${excludeClause}
    `, conflictParams);

    const checkInDate = new Date(check_in);
    const allotmentQ = db.query(
      `SELECT channel, notes FROM allotments WHERE unit_id = $1 AND month = $2 AND year = $3`,
      [unit_id, checkInDate.getUTCMonth() + 1, checkInDate.getUTCFullYear()]
    );

    const [{ rows: conflicts }, { rows: allotmentRows }] = await Promise.all([conflictQ, allotmentQ]);

    res.json({
      available: conflicts.length === 0,
      conflicts: conflicts.map(c => ({
        id: c.id,
        guest_name: c.guest_name,
        check_in_date: c.check_in_date,
        check_out_date: c.check_out_date,
        status: c.status,
      })),
      allotment: allotmentRows[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/transfer-availability?check_in=&check_out=&exclude_booking_id=
// Returns all units with availability status for the given dates
router.get('/transfer-availability', auth, async (req, res) => {
  const { check_in, check_out, exclude_booking_id } = req.query;
  if (!check_in || !check_out) return res.status(400).json({ error: 'check_in, check_out required' });
  try {
    const { rows: units } = await db.query('SELECT id, name, type, status FROM units WHERE property_id = $1 ORDER BY name', [req.propertyId]);
    const params = [check_in, check_out, req.propertyId];
    let excludeClause = '';
    if (exclude_booking_id) { params.push(exclude_booking_id); excludeClause = `AND b.id != $${params.length}`; }
    const { rows: conflicts } = await db.query(`
      SELECT b.unit_id, g.name as guest_name, b.check_in_date, b.check_out_date
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      WHERE b.property_id = $3
        AND b.status NOT IN ('cancelled','no_show')
        AND b.check_in_date < $2
        AND b.check_out_date > $1
        ${excludeClause}
    `, params);
    const conflictMap = {};
    conflicts.forEach(c => { conflictMap[c.unit_id] = c; });
    res.json(units.map(u => ({
      ...u,
      available: !conflictMap[u.id],
      conflict: conflictMap[u.id] || null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/group/:groupId
router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const { rows: [group] } = await db.query(`
      SELECT rg.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.email as guest_email
      FROM reservation_groups rg JOIN guests g ON g.id = rg.primary_guest_id
      WHERE rg.id = $1 AND rg.property_id = $2`, [req.params.groupId, req.propertyId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { rows: bookings } = await db.query(`
      SELECT b.*, u.name as unit_name,
             (SELECT checkin_time FROM checkin_records cr WHERE cr.booking_id = b.id) as checkin_time,
             (SELECT checkout_time FROM checkin_records cr WHERE cr.booking_id = b.id) as checkout_time
      FROM bookings b JOIN units u ON u.id = b.unit_id
      WHERE b.reservation_group_id = $1 AND b.property_id = $2
      ORDER BY u.name`, [req.params.groupId, req.propertyId]);

    const paymentsByBooking = await db.query(
      `SELECT * FROM payments WHERE booking_id = ANY($1::uuid[]) ORDER BY booking_id, type`,
      [bookings.map(b => b.id)]
    );
    const bookingsWithPayments = bookings.map(b => ({
      ...b,
      payments: paymentsByBooking.rows.filter(p => p.booking_id === b.id),
    }));

    const statusBreakdown = {};
    bookings.forEach(b => { statusBreakdown[b.status] = (statusBreakdown[b.status] || 0) + 1; });
    const paidAmount = paymentsByBooking.rows.filter(p => p.status === 'received').reduce((s, p) => s + parseFloat(p.amount), 0);
    const totalAmount = bookings.reduce((s, b) => s + parseFloat(b.total_amount), 0);
    const netAmount = totalAmount - parseFloat(group.group_discount_amount || 0);

    res.json({
      group,
      bookings: bookingsWithPayments,
      rollup: {
        room_count: bookings.length,
        total_amount: totalAmount,
        discount_amount: parseFloat(group.group_discount_amount || 0),
        net_amount: netAmount,
        deposit_amount: parseFloat(group.group_deposit_amount || 0),
        paid_amount: paidAmount,
        balance_due: netAmount - paidAmount,
        status_breakdown: statusBreakdown,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const bookingQ = db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.nationality, g.email as guest_email,
             u.name as unit_name, u.bed_config,
             rp.code as rate_plan_code, rp.name as rate_plan_name,
             (b.deposit_amount = 0 OR b.deposit_amount IS NULL OR EXISTS(
               SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'deposit' AND p.status = 'received'
             )) as deposit_paid,
             CASE WHEN b.reservation_group_id IS NULL THEN 1
                  ELSE (SELECT COUNT(*) FROM bookings b2 WHERE b2.reservation_group_id = b.reservation_group_id)
             END AS group_size
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
      WHERE b.id = $1 AND b.property_id = $2`, [req.params.id, req.propertyId]);
    const paymentsQ = db.query('SELECT * FROM payments WHERE booking_id = $1 ORDER BY type', [req.params.id]);
    const notesQ = db.query(`
      SELECT bn.*, u.name as author_name FROM booking_notes bn
      LEFT JOIN users u ON bn.author_id = u.id
      WHERE bn.booking_id = $1 ORDER BY bn.created_at`, [req.params.id]);
    const checkinQ = db.query(
      `SELECT checkin_time, checkout_time, condition_notes, id_captured
       FROM checkin_records WHERE booking_id = $1`,
      [req.params.id]);

    const [{ rows: [booking] }, { rows: payments }, { rows: notes }, { rows: [checkin_record] }] =
      await Promise.all([bookingQ, paymentsQ, notesQ, checkinQ]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const group = booking.reservation_group_id ? { id: booking.reservation_group_id, room_count: booking.group_size } : null;
    res.json({ ...booking, payments, notes, checkin_record: checkin_record || null, group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings
router.post('/', auth, async (req, res) => {
  const { guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, special_requests, internal_notes, status, discount_type, discount_value, rate_plan_id, bed_preference, room_revenue } = req.body;
  if (!guest_id || !unit_id || !check_in_date || !check_out_date) {
    return res.status(400).json({ error: 'guest_id, unit_id, check_in_date, check_out_date required' });
  }
  if (bed_preference && !BED_PREFS.includes(bed_preference)) {
    return res.status(400).json({ error: `bed_preference must be one of ${BED_PREFS.join(', ')}` });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: unitRows } = await client.query('SELECT id FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!unitRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Unit not found' }); }
    const { rows: guestRows } = await client.query('SELECT id FROM guests WHERE id = $1 AND property_id = $2', [guest_id, req.propertyId]);
    if (!guestRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Guest not found' }); }

    // Check availability
    const conflict = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND property_id = $4
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $3
        AND check_out_date > $2
    `, [unit_id, check_in_date, check_out_date, req.propertyId]);
    if (conflict.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Unit is not available for the selected dates' });
    }

    const total = parseFloat(total_amount || 0);

    // Compute discount
    const dType  = discount_type || null;
    const dValue = parseFloat(discount_value || 0);
    let discountAmount = 0;
    if (dType === 'fixed')      discountAmount = Math.min(dValue, total);
    if (dType === 'percentage') discountAmount = Math.round(total * dValue / 100);

    // Rate plan + room/F&B net split
    const nights = Math.max(1, Math.round((new Date(check_out_date) - new Date(check_in_date)) / 86400000));
    const guests = Math.max(1, parseInt(num_guests, 10) || 1);
    const ratePlan = await ratePlanService.resolveForBooking(req.propertyId, rate_plan_id || null);
    const { F, tax_rate, service_charge_rate } = await grossFactor(client, req.propertyId);
    const { roomNet, mealNet } = splitRevenue({
      grossNet: total - discountAmount, nights, ratePlan, numGuests: guests, F, clientRoomRevenue: room_revenue,
    });
    // Store total_amount consistently with the split (pre-discount gross rack).
    const payable = computeFolioTotals(roomNet + mealNet, tax_rate, service_charge_rate).total;
    const storedTotal = round2(payable + discountAmount);

    const net = payable;
    const depositAmount = deposit_amount !== undefined
      ? Math.min(parseFloat(deposit_amount), net)
      : Math.round(net * 0.3);
    const balanceAmount = round2(net - depositAmount);

    const { rows } = await client.query(
      `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_type, discount_value, discount_amount, special_requests, internal_notes, status, created_by, property_id, rate_plan_id, bed_preference, room_revenue, fnb_revenue)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [guest_id, unit_id, check_in_date, check_out_date, num_guests || 1, source || 'direct', storedTotal, depositAmount, dType, dValue, discountAmount, special_requests, internal_notes, status || 'pending', req.user.id, req.propertyId, ratePlan?.id || null, bed_preference || null, roomNet, mealNet]
    );
    const booking = rows[0];
    if (depositAmount > 0) {
      await client.query(
        'INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)',
        [booking.id, 'deposit', depositAmount]
      );
    }
    if (balanceAmount > 0) {
      await client.query(
        'INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)',
        [booking.id, 'balance', balanceAmount]
      );
    }

    await client.query('COMMIT');

    // Fire and forget — don't await, don't fail the booking if email fails
    sendBookingEmail(req.propertyId, booking.id, 'booking_confirmed')
      .catch(err => console.error('Email trigger failed:', err));

    res.status(201).json(booking);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/bookings/group — multi-room reservation under one guest + shared dates.
// Single-room bookings keep using POST / above unchanged; this endpoint only
// exists once there are 2+ rooms (rooms.length < 2 is rejected below).
router.post('/group', auth, async (req, res) => {
  const {
    guest_id, check_in_date, check_out_date, source, status,
    special_requests, internal_notes,
    group_discount_type, group_discount_value, group_deposit_amount,
    rooms,
  } = req.body;

  if (!guest_id || !check_in_date || !check_out_date || !Array.isArray(rooms) || rooms.length < 2) {
    return res.status(400).json({ error: 'guest_id, check_in_date, check_out_date, and at least 2 rooms are required' });
  }
  const unitIds = rooms.map(r => r.unit_id);
  if (unitIds.some(id => !id) || new Set(unitIds).size !== unitIds.length) {
    return res.status(400).json({ error: 'Each room needs a unit_id, and units must not repeat' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: guestRows } = await client.query('SELECT id FROM guests WHERE id = $1 AND property_id = $2', [guest_id, req.propertyId]);
    if (!guestRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Guest not found' }); }

    const { rows: unitRows } = await client.query('SELECT id FROM units WHERE id = ANY($1::uuid[]) AND property_id = $2', [unitIds, req.propertyId]);
    if (unitRows.length !== unitIds.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'One or more units not found' }); }

    for (const unitId of unitIds) {
      const conflict = await client.query(`
        SELECT id FROM bookings
        WHERE unit_id = $1 AND property_id = $4
          AND status NOT IN ('cancelled','no_show')
          AND check_in_date < $3 AND check_out_date > $2
      `, [unitId, check_in_date, check_out_date, req.propertyId]);
      if (conflict.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Unit ${unitId} is not available for the selected dates` });
      }
    }

    if (rooms.some(r => r.bed_preference && !BED_PREFS.includes(r.bed_preference))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `bed_preference must be one of ${BED_PREFS.join(', ')}` });
    }

    const nights = Math.max(1, Math.round((new Date(check_out_date) - new Date(check_in_date)) / 86400000));
    const { F, tax_rate, service_charge_rate } = await grossFactor(client, req.propertyId);

    const groupTotal = rooms.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);

    const gdType = group_discount_type || null;
    const gdValue = parseFloat(group_discount_value || 0);
    let groupDiscountAmount = 0;
    if (gdType === 'fixed')      groupDiscountAmount = Math.min(gdValue, groupTotal);
    if (gdType === 'percentage') groupDiscountAmount = Math.round(groupTotal * gdValue / 100);
    const groupNet = groupTotal - groupDiscountAmount;
    const groupDepositAmount = Math.min(parseFloat(group_deposit_amount || 0), groupNet);

    // Prorate discount/deposit per room by each room's share of the group total.
    // The last room absorbs the rounding remainder so both sums stay exact.
    let discountRemaining = groupDiscountAmount;
    let depositRemaining = groupDepositAmount;
    const shares = rooms.map((room, i) => {
      const isLast = i === rooms.length - 1;
      const roomTotal = parseFloat(room.total_amount || 0);
      const discountShare = isLast ? discountRemaining : Math.round(groupDiscountAmount * roomTotal / (groupTotal || 1));
      discountRemaining -= discountShare;
      const roomNet = roomTotal - discountShare;
      return { room, roomTotal, discountShare, roomNet, isLast };
    });
    // Second pass for deposit share, since it's proportional to roomNet / groupNet
    shares.forEach(s => {
      s.depositShare = s.isLast ? depositRemaining : Math.round(groupDepositAmount * s.roomNet / (groupNet || 1));
      depositRemaining -= s.depositShare;
      s.balanceShare = s.roomNet - s.depositShare;
    });

    const { rows: [group] } = await client.query(
      `INSERT INTO reservation_groups (property_id, primary_guest_id, check_in_date, check_out_date, group_discount_type, group_discount_value, group_discount_amount, group_deposit_amount, special_requests, internal_notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.propertyId, guest_id, check_in_date, check_out_date, gdType, gdValue, groupDiscountAmount, groupDepositAmount, special_requests, internal_notes, req.user.id]
    );

    const bookings = [];
    for (const s of shares) {
      // Child bookings store the GROUP's discount_type/discount_value verbatim
      // (so BookingDetail.jsx's existing discount box renders unchanged) but
      // their own prorated discount_amount/deposit_amount — that amount won't
      // self-reconcile if recomputed against this one room's total in
      // isolation, which is intentional, not a bug to "fix" later.
      const roomGuests = Math.max(1, parseInt(s.room.num_guests, 10) || 1);
      const roomPlan = await ratePlanService.resolveForBooking(req.propertyId, s.room.rate_plan_id || null);
      const mealNet = round2(ratePlanService.mealNetPerNight(roomPlan, roomGuests) * nights);
      let roomRevNet = round2(s.roomNet / F) - mealNet;
      if (roomRevNet < 0) roomRevNet = 0;
      const roomStoredTotal = round2(computeFolioTotals(roomRevNet + mealNet, tax_rate, service_charge_rate).total + s.discountShare);

      const { rows: [booking] } = await client.query(
        `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_type, discount_value, discount_amount, special_requests, internal_notes, status, created_by, property_id, reservation_group_id, rate_plan_id, bed_preference, room_revenue, fnb_revenue)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [guest_id, s.room.unit_id, check_in_date, check_out_date, s.room.num_guests || 1, source || 'direct', roomStoredTotal, s.depositShare, gdType, gdValue, s.discountShare, special_requests, internal_notes, status || 'pending', req.user.id, req.propertyId, group.id, roomPlan?.id || null, s.room.bed_preference || null, roomRevNet, mealNet]
      );
      if (s.depositShare > 0) {
        await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'deposit', s.depositShare]);
      }
      if (s.balanceShare > 0) {
        await client.query('INSERT INTO payments (booking_id, type, amount) VALUES ($1,$2,$3)', [booking.id, 'balance', s.balanceShare]);
      }
      bookings.push(booking);
    }

    await client.query('COMMIT');

    sendGroupBookingEmail(req.propertyId, group.id)
      .catch(err => console.error('Group email trigger failed:', err));

    res.status(201).json({ group, bookings });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/bookings/group/:groupId  (cancel whole group — no hard delete)
router.delete('/group/:groupId', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [group] } = await client.query(
      "UPDATE reservation_groups SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [req.params.groupId, req.propertyId]
    );
    if (!group) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Group not found' }); }
    const { rows: bookings } = await client.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
       WHERE reservation_group_id = $1 AND property_id = $2 AND status NOT IN ('checked_out','cancelled')
       RETURNING *`,
      [req.params.groupId, req.propertyId]
    );
    for (const b of bookings) await roomCharge.voidAll(client, b.id, req.user.id);
    await client.query('COMMIT');
    res.json({ group, bookings });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id/confirm  (for zero-net bookings with no payments to collect)
router.put('/:id/confirm', auth, async (req, res) => {
  try {
    const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'pending') return res.status(409).json({ error: 'Booking is not in pending status' });

    const net = parseFloat(booking.total_amount) - parseFloat(booking.discount_amount || 0);
    const hasPendingPayment = await db.query(
      "SELECT id FROM payments WHERE booking_id = $1 AND status = 'pending' AND amount > 0",
      [booking.id]
    );
    if (net > 0 && hasPendingPayment.rows.length > 0) {
      return res.status(409).json({ error: 'Use payment confirmation to confirm this booking' });
    }

    const { rows: [updated] } = await db.query(
      "UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [booking.id, req.propertyId]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id/transfer
router.put('/:id/transfer', auth, async (req, res) => {
  const { unit_id } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [booking] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    const transferable = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
    if (!transferable.includes(booking.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot transfer — booking status is ${booking.status}` });
    }
    if (booking.unit_id === unit_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking is already assigned to this unit' });
    }

    const { rows: [targetUnit] } = await client.query('SELECT id FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!targetUnit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Target unit not found' }); }

    const { rows: conflicts } = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND property_id = $5
        AND id != $2
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $4
        AND check_out_date > $3
    `, [unit_id, req.params.id, booking.check_in_date, booking.check_out_date, req.propertyId]);
    if (conflicts.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Target unit is not available for these booking dates' });
    }

    const oldUnitId = booking.unit_id;
    await client.query('UPDATE bookings SET unit_id = $1, updated_at = NOW() WHERE id = $2 AND property_id = $3', [unit_id, req.params.id, req.propertyId]);

    if (booking.status === 'checked_in') {
      await client.query("UPDATE units SET status = 'available' WHERE id = $1 AND property_id = $2", [oldUnitId, req.propertyId]);
      await client.query("UPDATE units SET status = 'occupied' WHERE id = $1 AND property_id = $2", [unit_id, req.propertyId]);
    }

    await client.query('COMMIT');
    const { rows: [updated] } = await db.query(`
      SELECT b.*, g.name as guest_name, u.name as unit_name
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      WHERE b.id = $1 AND b.property_id = $2
    `, [req.params.id, req.propertyId]);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id/dates  (amend check-in/check-out dates, same unit)
router.put('/:id/dates', auth, async (req, res) => {
  const { check_in_date, check_out_date } = req.body;
  if (!check_in_date || !check_out_date) return res.status(400).json({ error: 'check_in_date, check_out_date required' });
  if (new Date(check_out_date) <= new Date(check_in_date)) {
    return res.status(400).json({ error: 'Check-out date must be after check-in date' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [booking] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    if (booking.reservation_group_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Date changes are not supported for group bookings yet' });
    }

    const amendable = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
    if (!amendable.includes(booking.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot amend dates — booking status is ${booking.status}` });
    }

    if (booking.check_in_date === check_in_date && booking.check_out_date === check_out_date) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'New dates are the same as the current dates' });
    }

    const { rows: conflicts } = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND property_id = $5
        AND id != $2
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $4
        AND check_out_date > $3
    `, [booking.unit_id, req.params.id, check_in_date, check_out_date, req.propertyId]);
    if (conflicts.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Unit is not available for the new dates' });
    }

    await client.query(
      'UPDATE bookings SET check_in_date = $1, check_out_date = $2, updated_at = NOW() WHERE id = $3 AND property_id = $4',
      [check_in_date, check_out_date, req.params.id, req.propertyId]
    );

    // Re-spread the (unchanged) net room/F&B totals over the new night count
    // and re-post the folio nights.
    const { rows: [fresh] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    await roomCharge.repostStay(client, fresh, req.user.id);

    await client.query('COMMIT');
    const { rows: [updated] } = await db.query(`
      SELECT b.*, g.name as guest_name, u.name as unit_name
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      WHERE b.id = $1 AND b.property_id = $2
    `, [req.params.id, req.propertyId]);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id/no-show
router.put('/:id/no-show', auth, async (req, res) => {
  try {
    const { rows: [booking] } = await db.query('SELECT status FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!['pending', 'deposit_paid', 'confirmed'].includes(booking.status)) {
      return res.status(409).json({ error: `Cannot mark as no-show — booking status is ${booking.status}` });
    }
    const { rows } = await db.query(
      "UPDATE bookings SET status = 'no_show', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [req.params.id, req.propertyId]
    );
    await roomCharge.voidAll(db, req.params.id, req.user.id);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bookings/:id
router.put('/:id', auth, async (req, res) => {
  const { num_guests, source, total_amount, special_requests, internal_notes, status, rate_plan_id, bed_preference } = req.body;
  if (bed_preference !== undefined && bed_preference !== null && bed_preference !== '' && !BED_PREFS.includes(bed_preference)) {
    return res.status(400).json({ error: `bed_preference must be one of ${BED_PREFS.join(', ')}` });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [before] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    const { rows } = await client.query(
      `UPDATE bookings SET
        num_guests = COALESCE($1, num_guests),
        source = COALESCE($2, source),
        total_amount = COALESCE($3, total_amount),
        special_requests = COALESCE($4, special_requests),
        internal_notes = COALESCE($5, internal_notes),
        status = COALESCE($6, status),
        rate_plan_id = COALESCE($9, rate_plan_id),
        bed_preference = CASE WHEN $10::text IS NULL THEN bed_preference
                             WHEN $10 = '' THEN NULL ELSE $10 END,
        updated_at = NOW()
       WHERE id = $7 AND property_id = $8 RETURNING *`,
      [num_guests, source, total_amount, special_requests, internal_notes, status, req.params.id, req.propertyId,
        rate_plan_id || null, bed_preference === undefined ? null : bed_preference]
    );
    let booking = rows[0];

    // Rate plan or guest count changed → recompute the net F&B portion,
    // keep the grand total (room + F&B) fixed by having room absorb the delta,
    // then re-post the folio nights.
    const planChanged = rate_plan_id && rate_plan_id !== before.rate_plan_id;
    const guestsChanged = num_guests !== undefined && parseInt(num_guests, 10) !== before.num_guests;
    if (planChanged || guestsChanged) {
      const plan = await ratePlanService.resolveForBooking(req.propertyId, booking.rate_plan_id);
      const guests = Math.max(1, parseInt(booking.num_guests, 10) || 1);
      const grossNet = round2(parseFloat(before.room_revenue ?? before.total_amount) + parseFloat(before.fnb_revenue || 0));
      const newFnb = round2(ratePlanService.mealNetPerNight(plan, guests) * booking.nights);
      let newRoom = round2(grossNet - newFnb);
      if (newRoom < 0) newRoom = 0;
      const { rows: [b2] } = await client.query(
        'UPDATE bookings SET room_revenue = $1, fnb_revenue = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
        [newRoom, newFnb, req.params.id]
      );
      booking = b2;
      await roomCharge.repostStay(client, booking, req.user.id);
    }

    await client.query('COMMIT');
    res.json(booking);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/bookings/:id  (cancel only — no hard delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      "UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND property_id = $2 RETURNING *",
      [req.params.id, req.propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
    await roomCharge.voidAll(db, req.params.id, req.user.id);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/note
router.post('/:id/note', auth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const { rows: [booking] } = await db.query('SELECT id FROM bookings WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const { rows } = await db.query(
      'INSERT INTO booking_notes (booking_id, author_id, content) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, content]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
