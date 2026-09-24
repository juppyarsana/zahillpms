const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const agentBilling = require('../services/agentBillingService');
const roomCharge = require('../services/roomChargeService');
const { applyBookingPrice } = require('../services/bookingPriceService');
const { round2 } = require('../services/folioService');
const multer = require('multer');

// Today's calendar date in WITA (UTC+8) as YYYY-MM-DD.
function todayWITA() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
const PDFDocument = require('pdfkit');
const { drawDocumentHeader } = require('../services/pdfHeader');
const { renderRegistrationCard } = require('../services/registrationCardPdf');
const { saveIdDocument } = require('../services/idDocument');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const OTA_SOURCES = ['airbnb', 'booking_com', 'traveloka'];

// Shared by the single-room route below and the group check-in route —
// throws an Error with .code/.status set on a business-rule failure
// (mirrors the res.status(409)/code shape the single-room route used to
// return directly) so the group route can catch per-room without one
// room's failure aborting the others.
//
// payLaterReason: front desk lets a direct/walk-in guest in before the room
// is fully paid (EDC down, etc.) — the unpaid deposit/balance simply stays
// owed (Balance Due, checkout warning, folio) and the reason is logged to
// Edit History. Any FO staff may do it (owner's choice); without a reason
// the full-payment rule applies as before.
async function checkinOneBooking(bookingId, propertyId, userId, { payLaterReason } = {}) {
  const { rows: [booking] } = await db.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [bookingId, propertyId]);
  if (!booking) { const err = new Error('Booking not found'); err.status = 404; throw err; }
  const isOTA = OTA_SOURCES.includes(booking.source);

  if (isOTA) {
    // OTA manages payment externally — allow from any pre-checkin status
    if (!['confirmed', 'deposit_paid', 'pending'].includes(booking.status)) {
      const err = new Error(`Cannot check in — booking status is ${booking.status}`); err.status = 409; throw err;
    }
  } else if (payLaterReason && ['deposit_paid', 'pending'].includes(booking.status)) {
    // Checked in without full payment — record how much is still owed and why.
    const { rows: [{ unpaid }] } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS unpaid FROM payments
       WHERE booking_id = $1 AND type IN ('deposit', 'balance') AND status = 'pending' AND amount > 0`,
      [bookingId]
    );
    await db.query(
      'INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
      [bookingId, `Checked in without full payment — Rp ${Math.round(parseFloat(unpaid)).toLocaleString('id-ID')} unpaid (pay later). Reason: ${payLaterReason}`.slice(0, 1000), userId]
    );
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
    const payLaterReason = String(req.body?.pay_later_reason || '').trim() || null;
    const record = await checkinOneBooking(req.params.bookingId, req.propertyId, req.user.id, { payLaterReason });
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
    // Optional: let the group's unpaid rooms in too (pay later), same rule as a single room.
    const payLaterReason = String(req.body?.pay_later_reason || '').trim() || null;

    const results = [];
    for (const b of bookings) {
      try {
        const record = await checkinOneBooking(b.id, req.propertyId, req.user.id, { payLaterReason });
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
      id_document_url = await saveIdDocument(req.file, req.params.bookingId);
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

// GET /api/checkin/:bookingId/registration-card — printable PDF for the
// guest to sign. Works for any booking status (a not-yet-arrived
// 'confirmed' booking as well as a 'checked_in' one) since front desk
// prepares this ahead of arrival as often as at/after check-in — see
// the Dashboard "Registration Card" shortcut and BookingDetail's
// Download menu, both of which hit this same route.
// Card data for one or more bookings — shared by the single card and the
// "all arrival cards" PDF. `where` is appended after the joins; b = bookings.
async function loadRegCardData(where, params) {
  const { rows } = await db.query(
    `SELECT
       b.id AS booking_id,
       g.name AS guest_name, g.address, g.email, g.nationality, g.id_number, g.whatsapp AS mobile,
       b.num_guests, b.check_in_date, b.check_out_date, b.purpose_of_stay, b.room_revenue, b.nights, b.deposit_amount,
       u.name AS unit_name, u.type AS room_type_name,
       bs.label AS source_label, COALESCE(bs.publish_rate, true) AS publish_rate,
       lt.name AS membership,
       pm.label AS payment_method_label,
       cu.name AS checked_in_by
     FROM bookings b
     JOIN guests g ON g.id = b.guest_id
     JOIN units u ON u.id = b.unit_id
     LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     LEFT JOIN loyalty_tiers lt ON lt.id = g.loyalty_tier_id
     -- "Checked In By" = whoever actually checked the guest in; blank (to
     -- fill in by hand) on a card printed before arrival.
     LEFT JOIN checkin_records cr ON cr.booking_id = b.id
     LEFT JOIN users cu ON cu.id = cr.processed_by
     LEFT JOIN payment_methods pm ON pm.property_id = b.property_id AND pm.id = (
       SELECT p.method FROM payments p
       WHERE p.booking_id = b.id AND p.status = 'received' AND p.type IN ('deposit', 'balance')
       ORDER BY p.received_at DESC NULLS LAST LIMIT 1
     )
     ${where}`,
    params
  );
  for (const d of rows) d.room_rate = d.nights > 0 ? Number(d.room_revenue || 0) / d.nights : null;
  return rows;
}

async function loadRegCardProperty(propertyId) {
  const { rows: [property] } = await db.query(
    `SELECT property_name, property_address, property_phone, property_email, logo_url, registration_notice
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  return property || {};
}

// One registration card on the current page.
function drawRegCard(doc, property, data) {
  drawDocumentHeader(doc, property, { title: 'Registration Card', refLine: `Booking #${String(data.booking_id).slice(0, 8).toUpperCase()}`, compact: true });
  renderRegistrationCard(doc, { property, data });
}

router.get('/:bookingId/registration-card', auth, async (req, res) => {
  try {
    const [data] = await loadRegCardData('WHERE b.id = $1 AND b.property_id = $2', [req.params.bookingId, req.propertyId]);
    if (!data) return res.status(404).json({ error: 'Booking not found' });
    const property = await loadRegCardProperty(req.propertyId);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="registration-card-${req.params.bookingId.slice(0, 8)}.pdf"`);
    doc.pipe(res);
    drawRegCard(doc, property, data);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/checkin/registration-cards?date=YYYY-MM-DD — every arrival of the
// date (check-in that day, not cancelled / no-show), one card per page, in
// room order — so front desk can print them ahead (e.g. the evening before)
// and have them ready when guests arrive.
router.get('/registration-cards', auth, async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const cards = await loadRegCardData(
      `WHERE b.property_id = $1 AND b.check_in_date = $2::date AND b.status NOT IN ('cancelled', 'no_show')
       ORDER BY u.name, g.name`,
      [req.propertyId, date]
    );
    if (!cards.length) return res.status(404).json({ error: 'No arrivals on this date' });
    const property = await loadRegCardProperty(req.propertyId);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="registration-cards-${date}.pdf"`);
    doc.pipe(res);
    cards.forEach((data, i) => {
      if (i > 0) doc.addPage();
      drawRegCard(doc, property, data);
    });
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/checkout/:bookingId/complete
router.put('/checkout/:bookingId/complete', auth, async (req, res) => {
  const { condition_notes, bill_to_agent } = req.body;

  // ── Early departure ─────────────────────────────────────────────────
  // Leaving before the booked check-out date (e.g. checked in today, has to
  // leave tonight). Front desk must choose what to charge — before this,
  // checkout voided every night from today on, so a same-day departure was
  // charged Rp 0 while the booking still said the full stay and the room
  // stayed blocked. The booking becomes the stay actually charged:
  //   stayed  — the nights used (a same-day departure counts as 1 night),
  //             at the booking's own rate
  //   full    — the whole booking (no refund); the dates still shorten
  //   custom  — `amount` = the total to charge for the stay
  // Check-out date, price, room/F&B split, folio nights and pending payment
  // lines all follow (applyBookingPrice); anything already paid beyond the
  // new price shows as a credit to refund. The room is released from the
  // real departure day (bookings.js occupiedUntilSql). Reason required.
  {
    const { rows: [b] } = await db.query(
      "SELECT * FROM bookings WHERE id = $1 AND property_id = $2 AND status = 'checked_in'", [req.params.bookingId, req.propertyId]
    );
    const today = todayWITA();
    if (b && today < String(b.check_out_date).slice(0, 10)) {
      const ci = String(b.check_in_date).slice(0, 10);
      const co = String(b.check_out_date).slice(0, 10);
      const dayMs = d => Date.parse(d + 'T00:00:00Z');
      const bookedNights = Math.round((dayMs(co) - dayMs(ci)) / 86400000);
      const stayedNights = Math.max(1, Math.round((dayMs(today) - dayMs(ci)) / 86400000));
      const ed = req.body.early_departure || {};
      const reason = String(ed.reason || '').trim();
      if (!['stayed', 'full', 'custom'].includes(ed.charge) || !reason) {
        return res.status(409).json({
          error: 'Guest is leaving before the booked check-out date — choose what to charge and give a reason',
          code: 'EARLY_DEPARTURE', booked_nights: bookedNights, stayed_nights: stayedNights, check_out_date: co,
        });
      }
      const custom = parseFloat(ed.amount);
      if (ed.charge === 'custom' && !(Number.isFinite(custom) && custom >= 0)) {
        return res.status(400).json({ error: 'amount required for a custom charge' });
      }
      const newCo = new Date(dayMs(ci) + stayedNights * 86400000).toISOString().slice(0, 10);
      const c = await db.pool.connect();
      try {
        await c.query('BEGIN');
        const oldTotal = parseFloat(b.total_amount);
        const oldDiscount = parseFloat(b.discount_amount || 0);
        const oldNet = round2(oldTotal - oldDiscount);
        const ratio = stayedNights / bookedNights;
        // Discount scales with the nights kept (e.g. a fixed group discount
        // shouldn't cancel a single remaining night).
        const newDiscount = ed.charge === 'stayed' ? round2(oldDiscount * ratio) : oldDiscount;
        await c.query('UPDATE bookings SET check_out_date = $1, discount_amount = $2, updated_at = NOW() WHERE id = $3',
          [newCo, newDiscount, b.id]);
        const { rows: [moved] } = await c.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        let charged = oldNet;
        let credit = 0;
        if (ed.charge === 'full') {
          // Same price over fewer nights.
          await roomCharge.repostStay(c, moved, req.user.id);
        } else {
          const newTotal = ed.charge === 'stayed'
            ? round2(oldTotal * ratio)
            : round2(custom + newDiscount);
          const priced = await applyBookingPrice(c, {
            propertyId: req.propertyId, before: moved, newTotal, userId: req.user.id,
            keepDiscount: true, receivedWasTypo: false,
            balanceNote: 'Early departure — amount due',
          });
          if (priced.error) { await c.query('ROLLBACK'); return res.status(priced.status).json(priced.error); }
          charged = priced.payable;
          credit = priced.credit;
        }
        const fmt = n => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
        const how = ed.charge === 'full' ? 'full booking kept (no refund)' : ed.charge === 'custom' ? 'custom amount' : 'nights used';
        await c.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [b.id,
          (`Early departure: booked ${bookedNights} night${bookedNights === 1 ? '' : 's'} (to ${co}), charged ${stayedNights} night${stayedNights === 1 ? '' : 's'} — ${how}, price ${fmt(oldNet)} → ${fmt(charged)}.`
           + (credit > 0 ? ` Guest overpaid ${fmt(credit)} — to be refunded.` : '')
           + ` Reason: ${reason}`).slice(0, 1000), req.user.id]);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        return res.status(500).json({ error: err.message });
      } finally {
        c.release();
      }
    }
  }

  // Folio catch-up must be committed BEFORE the checkout transaction opens,
  // because agentBilling.settleCheckout reads the folio via the pool (not the
  // txn client) to compute the commission base.
  {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const { rows: [b] } = await c.query('SELECT * FROM bookings WHERE id = $1 AND property_id = $2', [req.params.bookingId, req.propertyId]);
      if (b) {
        // Post every night of the stay as it now stands (an early departure
        // was already shortened above) and void anything beyond it.
        const lastDay = String(b.check_out_date).slice(0, 10);
        await roomCharge.postStay(c, b, { upToDate: lastDay, actorUserId: req.user.id });
        await roomCharge.voidFrom(c, b.id, lastDay, req.user.id);
      }
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      console.error('[checkout] folio catch-up failed:', err.message);
    } finally {
      c.release();
    }
  }

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
    // Vacate the room AND flag it dirty — front desk sees a "to clean" room
    // distinct from a ready one; housekeeping clears it from the room tablet.
    await client.query(
      "UPDATE units SET status = 'available', housekeeping_status = 'dirty', housekeeping_updated_at = NOW() WHERE id = $1 AND property_id = $2",
      [booking.unit_id, req.propertyId]
    );
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
