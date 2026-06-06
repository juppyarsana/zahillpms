const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// GET /api/bookings
router.get('/', auth, async (req, res) => {
  const { month, year, unit_id, status } = req.query;
  let query = `
    SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, u.name as unit_name,
           EXISTS(
             SELECT 1 FROM checkin_records cr
             WHERE cr.booking_id = b.id
               AND cr.condition_notes IS NOT NULL
               AND cr.condition_notes <> ''
           ) AS has_condition_notes
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN units u ON b.unit_id = u.id
    WHERE 1=1
  `;
  const params = [];
  if (month && year) {
    params.push(year, month);
    query += ` AND EXTRACT(YEAR FROM b.check_in_date) = $${params.length-1} AND EXTRACT(MONTH FROM b.check_in_date) = $${params.length}`;
  }
  if (unit_id) { params.push(unit_id); query += ` AND b.unit_id = $${params.length}`; }
  if (status) { params.push(status); query += ` AND b.status = $${params.length}`; }
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
             u.name as unit_name,
             (b.deposit_amount = 0 OR b.deposit_amount IS NULL OR EXISTS(
               SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'deposit' AND p.status = 'received'
             )) as deposit_paid
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.check_in_date <= CURRENT_DATE
        AND b.status IN ('confirmed','deposit_paid','pending')
      ORDER BY b.check_in_date DESC, g.name
    `);
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
             (SELECT p.amount FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance') as balance_amount
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.check_out_date = CURRENT_DATE
        AND b.status = 'checked_in'
      ORDER BY g.name
    `);
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
             (SELECT p.amount FROM payments p WHERE p.booking_id = b.id AND p.type = 'balance') as balance_amount
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN units u ON b.unit_id = u.id
      WHERE b.status = 'checked_in'
      ORDER BY b.check_out_date, g.name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/availability?unit_id=&check_in=&check_out=
router.get('/availability', auth, async (req, res) => {
  const { unit_id, check_in, check_out } = req.query;
  if (!unit_id || !check_in || !check_out) {
    return res.status(400).json({ error: 'unit_id, check_in, check_out required' });
  }
  try {
    const conflictQ = db.query(`
      SELECT b.id, b.check_in_date, b.check_out_date, b.status, g.name as guest_name
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      WHERE b.unit_id = $1
        AND b.status NOT IN ('cancelled','no_show')
        AND b.check_in_date < $3
        AND b.check_out_date > $2
    `, [unit_id, check_in, check_out]);

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
    const { rows: units } = await db.query('SELECT id, name, type, status FROM units ORDER BY name');
    const params = [check_in, check_out];
    let excludeClause = '';
    if (exclude_booking_id) { params.push(exclude_booking_id); excludeClause = `AND b.id != $${params.length}`; }
    const { rows: conflicts } = await db.query(`
      SELECT b.unit_id, g.name as guest_name, b.check_in_date, b.check_out_date
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      WHERE b.status NOT IN ('cancelled','no_show')
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

// GET /api/bookings/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const bookingQ = db.query(`
      SELECT b.*, g.name as guest_name, g.whatsapp as guest_whatsapp, g.nationality, g.email as guest_email,
             u.name as unit_name,
             (b.deposit_amount = 0 OR b.deposit_amount IS NULL OR EXISTS(
               SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'deposit' AND p.status = 'received'
             )) as deposit_paid
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      WHERE b.id = $1`, [req.params.id]);
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
    res.json({ ...booking, payments, notes, checkin_record: checkin_record || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings
router.post('/', auth, async (req, res) => {
  const { guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, special_requests, internal_notes, status, discount_type, discount_value } = req.body;
  if (!guest_id || !unit_id || !check_in_date || !check_out_date) {
    return res.status(400).json({ error: 'guest_id, unit_id, check_in_date, check_out_date required' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Check availability
    const conflict = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $3
        AND check_out_date > $2
    `, [unit_id, check_in_date, check_out_date]);
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
    const net = total - discountAmount;

    const depositAmount = deposit_amount !== undefined
      ? Math.min(parseFloat(deposit_amount), net)
      : Math.round(net * 0.3);
    const balanceAmount = net - depositAmount;

    const { rows } = await client.query(
      `INSERT INTO bookings (guest_id, unit_id, check_in_date, check_out_date, num_guests, source, total_amount, deposit_amount, discount_type, discount_value, discount_amount, special_requests, internal_notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [guest_id, unit_id, check_in_date, check_out_date, num_guests || 1, source || 'direct', total_amount || 0, depositAmount, dType, dValue, discountAmount, special_requests, internal_notes, status || 'pending', req.user.id]
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
    res.status(201).json(booking);
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
    const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
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
      "UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1 RETURNING *",
      [booking.id]
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

    const { rows: [booking] } = await client.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
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

    const { rows: [targetUnit] } = await client.query('SELECT id FROM units WHERE id = $1', [unit_id]);
    if (!targetUnit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Target unit not found' }); }

    const { rows: conflicts } = await client.query(`
      SELECT id FROM bookings
      WHERE unit_id = $1
        AND id != $2
        AND status NOT IN ('cancelled','no_show')
        AND check_in_date < $4
        AND check_out_date > $3
    `, [unit_id, req.params.id, booking.check_in_date, booking.check_out_date]);
    if (conflicts.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Target unit is not available for these booking dates' });
    }

    const oldUnitId = booking.unit_id;
    await client.query('UPDATE bookings SET unit_id = $1, updated_at = NOW() WHERE id = $2', [unit_id, req.params.id]);

    if (booking.status === 'checked_in') {
      await client.query("UPDATE units SET status = 'available' WHERE id = $1", [oldUnitId]);
      await client.query("UPDATE units SET status = 'occupied' WHERE id = $1", [unit_id]);
    }

    await client.query('COMMIT');
    const { rows: [updated] } = await db.query(`
      SELECT b.*, g.name as guest_name, u.name as unit_name
      FROM bookings b JOIN guests g ON b.guest_id = g.id JOIN units u ON b.unit_id = u.id
      WHERE b.id = $1
    `, [req.params.id]);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/bookings/:id
router.put('/:id', auth, async (req, res) => {
  const { num_guests, source, total_amount, special_requests, internal_notes, status } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE bookings SET
        num_guests = COALESCE($1, num_guests),
        source = COALESCE($2, source),
        total_amount = COALESCE($3, total_amount),
        special_requests = COALESCE($4, special_requests),
        internal_notes = COALESCE($5, internal_notes),
        status = COALESCE($6, status),
        updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [num_guests, source, total_amount, special_requests, internal_notes, status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bookings/:id  (cancel only — no hard delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      "UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
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
