const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
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

// POST /api/checkin/:bookingId/start
router.post('/:bookingId/start', auth, async (req, res) => {
  try {
    const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1', [req.params.bookingId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const isOTA = OTA_SOURCES.includes(booking.source);

    if (isOTA) {
      // OTA manages payment externally — allow from any pre-checkin status
      if (!['confirmed', 'deposit_paid', 'pending'].includes(booking.status)) {
        return res.status(409).json({ error: `Cannot check in — booking status is ${booking.status}` });
      }
    } else {
      // Direct / walk-in: full payment required before check-in
      if (booking.status === 'deposit_paid') {
        return res.status(409).json({
          error: 'Balance payment has not been received. Full payment is required before check-in.',
          code: 'BALANCE_UNPAID',
        });
      }
      if (booking.status === 'pending') {
        return res.status(409).json({
          error: 'Payment has not been received. Full payment is required before check-in.',
          code: 'DEPOSIT_UNPAID',
        });
      }
      if (booking.status !== 'confirmed') {
        return res.status(409).json({ error: `Cannot check in — booking status is ${booking.status}` });
      }
    }

    await db.query("UPDATE bookings SET status = 'checked_in', updated_at = NOW() WHERE id = $1", [req.params.bookingId]);
    await db.query("UPDATE units SET status = 'occupied' WHERE id = $1", [booking.unit_id]);

    const { rows } = await db.query(
      `INSERT INTO checkin_records (booking_id, checkin_time, processed_by)
       VALUES ($1, NOW(), $2) ON CONFLICT (booking_id) DO UPDATE SET checkin_time = NOW(), processed_by = $2 RETURNING *`,
      [req.params.bookingId, req.user.id]
    );
    res.json(rows[0]);
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

    let id_document_url = null;
    if (req.file) {
      const filename = `${req.params.bookingId}-${Date.now()}.jpg`;
      id_document_url = await saveResized(req.file.buffer, filename);
      const { rows: [booking] } = await client.query('SELECT guest_id FROM bookings WHERE id = $1', [req.params.bookingId]);
      if (booking) {
        await client.query('UPDATE guests SET id_document_url = $1 WHERE id = $2', [id_document_url, booking.guest_id]);
      }
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
  const { condition_notes } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [booking] } = await client.query('SELECT * FROM bookings WHERE id = $1', [req.params.bookingId]);
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }

    await client.query("UPDATE bookings SET status = 'checked_out', updated_at = NOW() WHERE id = $1", [req.params.bookingId]);
    await client.query("UPDATE units SET status = 'available' WHERE id = $1", [booking.unit_id]);
    await client.query(
      'UPDATE checkin_records SET checkout_time = NOW(), condition_notes = COALESCE($1, condition_notes) WHERE booking_id = $2',
      [condition_notes, req.params.bookingId]
    );

    // Auto-generate housekeeping task
    await client.query(
      `INSERT INTO tasks (title, type, priority, unit_id, booking_id, due_time)
       VALUES ($1, 'housekeeping', 'high', $2, $3, NOW())`,
      [`Clean & prepare unit after checkout`, booking.unit_id, booking.id]
    );

    // Recalculate guest loyalty tier
    await recalcGuestTier(client, booking.guest_id);

    await client.query('COMMIT');
    res.json({ message: 'Check-out complete', booking_id: req.params.bookingId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

async function recalcGuestTier(client, guestId) {
  const { rows: stats } = await client.query(`
    SELECT
      COALESCE(SUM(nights), 0) as total_nights,
      COALESCE(SUM(total_amount), 0) as total_spend,
      COUNT(*) as total_visits
    FROM bookings
    WHERE guest_id = $1 AND status = 'checked_out'
  `, [guestId]);

  const { total_nights, total_spend, total_visits } = stats[0];
  const { rows: tiers } = await client.query(
    'SELECT * FROM loyalty_tiers ORDER BY threshold_value DESC'
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
