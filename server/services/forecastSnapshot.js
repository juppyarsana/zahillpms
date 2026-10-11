// Forecast snapshots (migration 104): once a day, what is on the books for
// yesterday and the next 120 nights — rooms sold, guests, net room + meal
// revenue, rooms per room type and per source. Pickup and, later, a real
// projection are worked out from these; they can't be rebuilt afterwards.
//
// Light on purpose: per property ONE read (bookings touching the window,
// grouped per night) and ONE insert of ~121 rows, once a day. Counted like
// the Forecast page and Reports: every booking except cancelled / no-show,
// by its booked dates.
const db = require('../db');
const { roomRevPerNightSql } = require('./nightRates');
const { todayWITA } = require('./roomChargeService');

const NIGHTS_AHEAD = 120;

async function takeSnapshot(propertyId, date = todayWITA()) {
  const [{ rows }, { rows: [u] }] = await Promise.all([
    db.query(`
      SELECT to_char(gs, 'YYYY-MM-DD') AS night, u.type AS room_type, b.source,
             COUNT(*)::int AS rooms, COALESCE(SUM(b.num_guests), 0)::int AS guests,
             COALESCE(SUM(${roomRevPerNightSql('b', 'gs')}), 0) AS room,
             COALESCE(SUM(COALESCE(b.fnb_revenue, 0) / NULLIF(b.nights, 0)), 0) AS meals
      FROM generate_series($2::date - 1, $2::date + ${NIGHTS_AHEAD - 1}, '1 day') gs
      JOIN bookings b ON b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
        AND b.check_in_date <= gs::date AND b.check_out_date > gs::date
      JOIN units u ON u.id = b.unit_id
      GROUP BY gs, u.type, b.source`, [propertyId, date]),
    db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order')::int AS for_sale FROM units WHERE property_id = $1`, [propertyId]),
  ]);

  const byNight = new Map();
  for (const r of rows) {
    const n = byNight.get(r.night) || { rooms_sold: 0, guests: 0, room_revenue: 0, meal_revenue: 0, by_type: {}, by_source: {} };
    n.rooms_sold += r.rooms; n.guests += r.guests;
    n.room_revenue += parseFloat(r.room) || 0; n.meal_revenue += parseFloat(r.meals) || 0;
    if (r.room_type) n.by_type[r.room_type] = (n.by_type[r.room_type] || 0) + r.rooms;
    if (r.source) n.by_source[r.source] = (n.by_source[r.source] || 0) + r.rooms;
    byNight.set(r.night, n);
  }
  const out = [];
  const start = new Date(date + 'T00:00:00Z');
  for (let i = -1; i < NIGHTS_AHEAD; i++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
    const night = d.toISOString().slice(0, 10);
    const n = byNight.get(night);
    out.push({
      night, rooms_sold: n?.rooms_sold || 0, guests: n?.guests || 0,
      room_revenue: Math.round((n?.room_revenue || 0) * 100) / 100, meal_revenue: Math.round((n?.meal_revenue || 0) * 100) / 100,
      by_type: n ? n.by_type : null, by_source: n ? n.by_source : null,
    });
  }
  // Taken again on the same day = replaced.
  await db.query(`
    INSERT INTO forecast_snapshots (property_id, snapshot_date, night, rooms_sold, rooms_for_sale, guests, room_revenue, meal_revenue, by_type, by_source)
    SELECT $1, $2::date, x.night, x.rooms_sold, $3, x.guests, x.room_revenue, x.meal_revenue, x.by_type, x.by_source
    FROM jsonb_to_recordset($4::jsonb) AS x(night date, rooms_sold int, guests int, room_revenue numeric, meal_revenue numeric, by_type jsonb, by_source jsonb)
    ON CONFLICT (property_id, snapshot_date, night) DO UPDATE SET
      rooms_sold = EXCLUDED.rooms_sold, rooms_for_sale = EXCLUDED.rooms_for_sale, guests = EXCLUDED.guests,
      room_revenue = EXCLUDED.room_revenue, meal_revenue = EXCLUDED.meal_revenue,
      by_type = EXCLUDED.by_type, by_source = EXCLUDED.by_source, taken_at = NOW()`,
    [propertyId, date, u?.for_sale || 0, JSON.stringify(out)]);
  return { date, nights: out.length, rooms: out.reduce((s, r) => s + r.rooms_sold, 0) };
}

// Every active property, one after the other. onlyMissing: skip a property
// that already has today's snapshot (the catch-up when the server starts —
// a server that was down at the nightly run would otherwise leave a gap).
async function snapshotAllProperties({ onlyMissing = false } = {}) {
  const date = todayWITA();
  const { rows: props } = await db.query(`
    SELECT p.id FROM properties p
    WHERE p.is_active = true
      AND ($2::boolean = false OR NOT EXISTS (
        SELECT 1 FROM forecast_snapshots s WHERE s.property_id = p.id AND s.snapshot_date = $1::date))`, [date, onlyMissing]);
  for (const { id } of props) {
    try {
      await takeSnapshot(id, date);
    } catch (err) {
      console.error(`[Forecast snapshot] failed for property ${id}:`, err.message);
    }
  }
  return props.length;
}

module.exports = { takeSnapshot, snapshotAllProperties, NIGHTS_AHEAD };
