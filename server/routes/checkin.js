const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const agentBilling = require('../services/agentBillingService');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function saveResized(buffer, filename) {
  const outPath = path.join(UPLOAD_DIR, filename);
  await sharp(buffer)
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(outPath);
  return `/uploads/${filename}`;
}

const OTA_SOURCES = ['airbnb', 'booking_com', 'traveloka'];

// Shared by the single-room route below and the group check-in route —
// throws an Error with .code/.status set on a business-rule failure
// (mirrors the res.status(409)/code shape the single-room route used to
// return directly) so the group route can catch per-room without one
// room's failure aborting the others.
async function checkinOneBooking(bookingId, propertyId, userId) {
  const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [bookingId, propertyId]);
  if (!booking) { const err = new Error('Booking not found'); err.status = 404; throw err; }
  const isOTA = OTA_SOURCES.includes(booking.source);

  if (isOTA) {
    // OTA manages payment externally — allow from any pre-checkin status
    if (!['confirmed', 'deposit_paid', 'pending'].includes(booking.status)) {
      const err = new Error(`Cannot check in — booking status is ${booking.status}`); err.status = 409; throw err;
    }
  } else {
    // Direct / walk-in: full payment required before check-in
    if (booking.status === 'deposit_paid') {
      const err = new Error('Balance payment has not been received. Full payment is required before check-in.');
      err.status = 409; err.code = 'BALANCE_UNPAID'; throw err;
    }
    if (booking.status === 'pending') {
      const err = new Error('Payment has not been received. Full payment is required before check-in.');
      err.status = 409; err.code = 'DEPOSIT_UNPAID'; throw err;
    }
    if (booking.status !== 'confirmed') {
      const err = new Error(`Cannot check in — booking status is ${booking.status}`); err.status = 409; throw err;
    }
  }

  await db.query("UPDATE bookings SET status = 'checked_in', updated_at = NOW() WHERE id = $1 AND property_id = $2", [bookingId, propertyId]);
  await db.query("UPDATE units SET status = 'occupied' WHERE id = $1 AND property_id = $2", [booking.unit_id, propertyId]);

  const { rows } = await db.query(
    `INSERT INTO checkin_records (booking_id, checkin_time, processed_by)
     VALUES ($1, NOW(), $2) ON CONFLICT (booking_id) DO UPDATE SET checkin_time = NOW(), processed_by = $2 RETURNING *`,
    [bookingId, userId]
  );
  return rows[0];
}

// POST /api/checkin/:bookingId/start
router.post('/:bookingId/start', auth, async (req, res) => {
  try {
    const record = await checkinOneBooking(req.params.bookingId, req.propertyId, req.user.id);
    res.json(record);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
});

// POST /api/checkin/group/:groupId/start — best-effort: every eligible room
// is attempted independently; a failing room is flagged in `results` rather
// than rolling back the rooms that succeeded. Always returns 200 (unless the
// group has no eligible rooms at all) — inspect `results`, don't rely on the
// HTTP status to mean "all rooms checked in".
router.post('/group/:groupId/start', auth, async (req, res) => {
  try {
    const { rows: bookings } = await db.query(`
      SELECT b.id FROM bookings b
      JOIN reservation_groups g ON g.id = b.reservation_group_id
      WHERE g.id = $1 AND g.property_id = $2
        AND b.status NOT IN ('cancelled','no_show','checked_in','checked_out')
    `, [req.params.groupId, req.propertyId]);
    if (bookings.length === 0) return res.status(404).json({ error: 'Group not found or no eligible rooms' });

    const results = [];
    for (const b of bookings) {
      try {
        const record = await checkinOneBooking(b.id, req.propertyId, req.user.id);
        results.push({ booking_id: b.id, ok: true, checkin_record: record });
      } catch (err) {
        results.push({ booking_id: b.id, ok: false, code: err.code || null, error: err.message });
      }
    }
    const succeeded = results.filter(r => r.ok).length;
    res.json({ group_id: req.params.groupId, attempted: results.length, succeeded, failed: results.length - succeeded, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/checkin/:bookingId/complete
router.put('/:bookingId/complete', auth, upload.single('id_document'), async (req, res) => {
  const { checklist_data, condition_notes } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [scopedBooking] } = await client.query('SELECT guest_id FROM bookings WHERE id = $1 AND property_id = $2', [req.params.bookingId, req.propertyId]);
    if (!scopedBooking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    let id_document_url = null;
    if (req.file) {
      const filename = `${req.params.bookingId}-${Date.now()}.jpg`;
      id_document_url = await saveResized(req.file.buffer, filename);
      await client.query('UPDATE guests SET id_document_url = $1 WHERE id = $2', [id_document_url, scopedBooking.guest_id]);
    }

    const { rows } = await client.query(
      `UPDATE checkin_records SET
        id_captured = $1,
        checklist_data = $2,
        condition_notes = $3,
        processed_by = $4
       WHERE booking_id = $5 RETURNING *`,
      [
        !!req.file,
        checklist_data ? JSON.parse(checklist_data) : {},
        condition_notes,
        req.user.id,
        req.params.bookingId,
      ]
    );
    await client.query('COMMIT');
    res.json(rows[0] || { booking_id: req.params.bookingId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/checkout/:bookingId/complete
router.put('/checkout/:bookingId/complete', auth, async (req, res) => {
  const { condition_notes, bill_to_agent } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [booking] } = await client.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.bookingId, req.propertyId]);
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    // Agent billing: mark the folio billed-to-agent (city ledger) and/or post
    // the agent commission, all inside this checkout transaction.
    const settlement = await agentBilling.settleCheckout(client, {
      propertyId: req.propertyId,
      bookingId: req.params.bookingId,
      billToAgent: !!bill_to_agent,
      actorUserId: req.user.id,
    });
    if (settlement.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: settlement.error }); }

    await client.query("UPDATE bookings SET status = 'checked_out', updated_at = NOW() WHERE id = $1 AND property_id = $2", [req.params.bookingId, req.propertyId]);
    await client.query("UPDATE units SET status = 'available' WHERE id = $1 AND property_id = $2", [booking.unit_id, req.propertyId]);
    await client.query(
      'UPDATE checkin_records SET checkout_time = NOW(), condition_notes = COALESCE($1, condition_notes) WHERE booking_id = $2',
      [condition_notes, req.params.bookingId]
    );

    // Auto-generate housekeeping task
    await client.query(
      `INSERT INTO tasks (title, type, priority, unit_id, booking_id, due_time, property_id)
       VALUES ($1, 'housekeeping', 'high', $2, $3, NOW(), $4)`,
      [`Clean & prepare unit after checkout`, booking.unit_id, booking.id, req.propertyId]
    );

    // Recalculate guest loyalty tier
    await recalcGuestTier(client, booking.guest_id, req.propertyId);

    await client.query('COMMIT');
    res.json({
      message: 'Check-out complete',
      booking_id: req.params.bookingId,
      folio_status: settlement.folio_status,
      commission_posted: settlement.commission_posted,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

async function recalcGuestTier(client, guestId, propertyId) {
  const { rows: stats } = await client.query(`
    SELECT
      COALESCE(SUM(nights), 0) as total_nights,
      COALESCE(SUM(COALESCE(room_revenue, total_amount) + fnb_revenue), 0) as total_spend,
      COUNT(*) as total_visits
    FROM bookings
    WHERE guest_id = $1 AND property_id = $2 AND status = 'checked_out'
  `, [guestId, propertyId]);

  const { total_nights, total_spend, total_visits } = stats[0];
  const { rows: tiers } = await client.query(
    'SELECT * FROM loyalty_tiers WHERE property_id = $1 ORDER BY threshold_value DESC',
    [propertyId]
  );

  let assignedTier = null;
  for (const tier of tiers) {
    const val = tier.threshold_type === 'nights' ? total_nights
      : tier.threshold_type === 'spend' ? total_spend
      : total_visits;
    if (parseFloat(val) >= parseFloat(tier.threshold_value)) {
      assignedTier = tier.id;
      break;
    }
  }

  const { rows: [guest] } = await client.query('SELECT tier_override FROM guests WHERE id = $1', [guestId]);
  if (guest && !guest.tier_override) {
    await client.query('UPDATE guests SET loyalty_tier_id = $1 WHERE id = $2', [assignedTier, guestId]);
  }
}

module.exports = router;
