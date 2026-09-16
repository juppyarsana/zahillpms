// Channel Manager — Channex integration, spike/validation only (migration
// 060). Owner-only, all endpoints under /test/* to signal this is proving
// the integration shape works, not production automation yet — no cron job,
// no writing pulled bookings into our real `bookings` table (inspect-only).
//
// Rate/availability resolution below deliberately mirrors, rather than
// reuses, routes/pricing.js's GET /calendar and routes/bookings.js's GET
// /availability — kept inline for spike simplicity. If this graduates to
// production automation, factor this into a shared service so the two
// copies of the resolution logic can't drift (same reasoning folioService.js
// was extracted for).

const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const ratePlanService = require('../services/ratePlanService');
const channexAdapter = require('../services/channexAdapter');

const ownerOnly = [auth, requireRole('owner')];

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// POST /api/channel-manager/test/setup { unit_id, rate_plan_id? }
// Creates (or reuses) the Channex property, then a room type + rate plan for
// this one unit, and stores the mapping.
router.post('/test/setup', ownerOnly, async (req, res) => {
  const { unit_id, rate_plan_id } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id is required' });
  if (!channexAdapter.isConfigured()) return res.status(400).json({ error: 'Channex is not configured (CHANNEX_API_KEY unset)' });

  try {
    const { rows: [unit] } = await db.query('SELECT * FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const ratePlan = await ratePlanService.resolveForBooking(req.propertyId, rate_plan_id || null);
    if (!ratePlan) return res.status(400).json({ error: 'No rate plan available for this property' });

    const { rows: [property] } = await db.query('SELECT * FROM properties WHERE id = $1', [req.propertyId]);

    let channexPropertyId = property.channex_property_id;
    if (!channexPropertyId) {
      const created = await channexAdapter.createProperty({ title: property.name });
      channexPropertyId = created.id;
      await db.query('UPDATE properties SET channex_property_id = $1 WHERE id = $2', [channexPropertyId, req.propertyId]);
    }

    const roomType = await channexAdapter.createRoomType(channexPropertyId, unit);
    const ratePlanExternal = await channexAdapter.createRatePlan(channexPropertyId, roomType.id, ratePlan);

    const { rows: [mapping] } = await db.query(`
      INSERT INTO channel_manager_mappings (property_id, provider, unit_id, rate_plan_id, external_room_type_id, external_rate_plan_id)
      VALUES ($1, 'channex', $2, $3, $4, $5)
      ON CONFLICT (property_id, provider, unit_id, rate_plan_id)
      DO UPDATE SET external_room_type_id = EXCLUDED.external_room_type_id, external_rate_plan_id = EXCLUDED.external_rate_plan_id
      RETURNING *
    `, [req.propertyId, unit_id, ratePlan.id, roomType.id, ratePlanExternal.id]);

    res.json({ channex_property_id: channexPropertyId, mapping });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/channel-manager/test/push-rates { unit_id, days? }
// Pushes real pricing_periods-resolved rates + live availability for the
// next `days` days (default 30) for this unit's existing mapping.
router.post('/test/push-rates', ownerOnly, async (req, res) => {
  const { unit_id, days } = req.body;
  const numDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  if (!unit_id) return res.status(400).json({ error: 'unit_id is required' });
  if (!channexAdapter.isConfigured()) return res.status(400).json({ error: 'Channex is not configured (CHANNEX_API_KEY unset)' });

  try {
    const { rows: [mapping] } = await db.query(
      `SELECT * FROM channel_manager_mappings WHERE property_id = $1 AND provider = 'channex' AND unit_id = $2 LIMIT 1`,
      [req.propertyId, unit_id]
    );
    if (!mapping || !mapping.external_room_type_id || !mapping.external_rate_plan_id) {
      return res.status(400).json({ error: 'No Channex mapping for this unit — call /test/setup first' });
    }

    const { rows: [property] } = await db.query('SELECT channex_property_id FROM properties WHERE id = $1', [req.propertyId]);
    const { rows: [unit] } = await db.query('SELECT * FROM units WHERE id = $1 AND property_id = $2', [unit_id, req.propertyId]);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const today = new Date();
    const dates = [];
    for (let i = 0; i < numDays; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(toDateStr(d));
    }
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];

    // Rate resolution — mirrors routes/pricing.js's GET /calendar
    const { rows: periods } = await db.query(`
      SELECT * FROM pricing_periods
      WHERE property_id = $1 AND is_active = true AND date_from <= $3 AND date_to >= $2
        AND (unit_ids = '[]'::jsonb OR unit_ids @> $4::jsonb)
      ORDER BY sort_order DESC
    `, [req.propertyId, dateFrom, dateTo, JSON.stringify([unit_id])]);

    const baseRate = parseFloat(unit.base_rate);
    const rates = dates.map(date => {
      const period = periods.find(p => p.date_from <= date && p.date_to >= date);
      const rate = period
        ? (period.type === 'fixed' ? parseFloat(period.value) : baseRate * parseFloat(period.value))
        : baseRate;
      return { date, rate: Math.round(rate) };
    });

    // Availability resolution — mirrors routes/bookings.js's GET /availability
    // overlap check. check_in_date/check_out_date are DATE columns, already
    // normalized to plain 'YYYY-MM-DD' strings by db/index.js (not JS Dates).
    const { rows: overlapping } = await db.query(`
      SELECT check_in_date, check_out_date FROM bookings
      WHERE unit_id = $1 AND property_id = $2 AND status NOT IN ('cancelled', 'no_show')
        AND check_in_date < $4 AND check_out_date > $3
    `, [unit_id, req.propertyId, dateFrom, dateTo]);

    const availability = dates.map(date => {
      const booked = overlapping.some(b => b.check_in_date <= date && b.check_out_date > date);
      return { date, availability: booked ? 0 : 1 };
    });

    const channexPropertyId = property.channex_property_id;
    await channexAdapter.pushRates(channexPropertyId, mapping.external_rate_plan_id, rates);
    await channexAdapter.pushAvailability(channexPropertyId, mapping.external_room_type_id, availability);

    res.json({ pushed: { unit_id, date_from: dateFrom, date_to: dateTo, rates, availability } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/channel-manager/test/bookings
// Raw pull of the unacknowledged booking-revisions feed — inspection only,
// does NOT create/update anything in our own `bookings` table.
router.get('/test/bookings', ownerOnly, async (req, res) => {
  if (!channexAdapter.isConfigured()) return res.status(400).json({ error: 'Channex is not configured (CHANNEX_API_KEY unset)' });
  try {
    const { rows: [property] } = await db.query('SELECT channex_property_id FROM properties WHERE id = $1', [req.propertyId]);
    if (!property?.channex_property_id) {
      return res.status(400).json({ error: 'No Channex property mapped yet — call /test/setup first' });
    }
    const revisions = await channexAdapter.pullBookingRevisions(property.channex_property_id);
    res.json({ revisions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/channel-manager/test/bookings/:revisionId/ack
router.post('/test/bookings/:revisionId/ack', ownerOnly, async (req, res) => {
  if (!channexAdapter.isConfigured()) return res.status(400).json({ error: 'Channex is not configured (CHANNEX_API_KEY unset)' });
  try {
    const result = await channexAdapter.ackBookingRevision(req.params.revisionId);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
