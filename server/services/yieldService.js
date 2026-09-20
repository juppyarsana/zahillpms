const crypto = require('crypto');
const db = require('../db');

// Yield / dynamic pricing v1 (migration 061). Per ROOM TYPE (units.type):
//   final multiplier = day-of-week × (1 + occupancy tier %) × (1 + holiday/event %),
//   clamped to [floor_pct, ceiling_pct], written as source='auto' multiplier periods
//   into pricing_periods at a priority below every manual period (manual always wins).

const AUTO_SORT_ORDER = -1000;   // manual periods are >= 0, so any manual rule outranks these
const AUTO_COLOR = '#94a3b8';
const MIN_HISTORY_WEEKS = 8;
const MIN_NIGHTS_PER_DOW = 5;

// Default holiday uplifts (owner edits per date in the Events tab). Assumptions,
// not measured demand — surfaced as "default" in the UI until the owner sets one.
function defaultHolidayUplift(h) {
  if (/nyepi/i.test(h.name)) return h.is_joint_leave ? -10 : -30; // island shuts down
  if (h.category === 'balinese') return 0;
  return h.is_joint_leave ? 10 : 15;
}

function defaultTiers(mode, roomCount) {
  if (mode === 'rooms_left') {
    return [{ left: 1, pct: 25 }, { left: 2, pct: 10 }, { left: 3, pct: 0 }];
  }
  return [{ from: 0, pct: 0 }, { from: 40, pct: 0 }, { from: 70, pct: 15 }, { from: 90, pct: 30 }];
}

// ── date helpers (all plain 'YYYY-MM-DD' strings; DATE columns are strings, see db/index.js) ──
function addDays(dateStr, n) {
  return new Date(new Date(dateStr + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
}
function dowOf(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); } // 0=Sun..6=Sat
async function today() {
  const { rows: [r] } = await db.query(`SELECT (NOW() AT TIME ZONE 'Asia/Makassar')::date AS d`);
  return r.d;
}

// One settings row per (property, room type). New types get defaults (disabled).
// Small types (≤5 rooms) default to rooms-left tiers — see ROADMAP step 4.
async function ensureSettings(propertyId) {
  const { rows: types } = await db.query(
    `SELECT type, COUNT(*)::int AS rooms, MIN(base_rate) AS base_rate FROM units
     WHERE property_id = $1 AND type IS NOT NULL AND type <> '' GROUP BY type ORDER BY type`,
    [propertyId]
  );
  for (const t of types) {
    const mode = t.rooms <= 5 ? 'rooms_left' : 'percent';
    await db.query(
      `INSERT INTO yield_settings (property_id, room_type, tier_mode, tiers)
       VALUES ($1,$2,$3,$4) ON CONFLICT (property_id, room_type) DO NOTHING`,
      [propertyId, t.type, mode, JSON.stringify(defaultTiers(mode, t.rooms))]
    );
  }
  const { rows } = await db.query(
    'SELECT * FROM yield_settings WHERE property_id = $1 ORDER BY room_type', [propertyId]
  );
  const byType = Object.fromEntries(types.map(t => [t.type, t]));
  return rows.filter(r => byType[r.room_type]).map(r => ({ ...r, rooms: byType[r.room_type].rooms, base_rate: byType[r.room_type].base_rate }));
}

// Pure: pick the occupancy-tier % for booked/sellable rooms.
function tierPct(settings, booked, sellable) {
  const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];
  if (!tiers.length || sellable <= 0) return { pct: 0, label: 'no tiers' };
  if (settings.tier_mode === 'rooms_left') {
    // Sold out (left=0) uses the scarcest tier so a full night doesn't visibly drop to base.
    const left = Math.max(0, sellable - booked);
    const sorted = [...tiers].sort((a, b) => a.left - b.left);
    const tier = sorted.find(t => t.left >= Math.max(left, 1)) || sorted[sorted.length - 1];
    return { pct: Number(tier.pct), label: `${left} of ${sellable} rooms left` };
  }
  const occ = (booked / sellable) * 100;
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  let tier = sorted[0];
  for (const t of sorted) if (occ >= t.from) tier = t;
  return { pct: Number(tier.pct), label: `${Math.round(occ)}% occupied` };
}

// Pure: combine every factor for one date, then clamp.
// daysAhead = nights between today and `date`; used for the quiet-night discount window.
function computeMultiplier(settings, date, occ, eventPct, daysAhead = 0) {
  const dowFactor = Number((settings.dow_factors || [])[dowOf(date)] ?? 1) || 1;
  const tier = tierPct(settings, occ.booked, occ.sellable);
  const win = settings.discount_window_days;
  const suppressed = tier.pct < 0 && win != null && daysAhead > Number(win);
  if (suppressed) tier.pct = 0;
  const raw = dowFactor * (1 + tier.pct / 100) * (1 + eventPct / 100);
  const rawPct = (raw - 1) * 100;
  const pct = Math.min(Number(settings.ceiling_pct), Math.max(Number(settings.floor_pct), rawPct));
  return {
    multiplier: Math.round((1 + pct / 100) * 10000) / 10000,
    clamped: Math.abs(pct - rawPct) > 0.0001,
    factors: {
      occupancy: { pct: tier.pct, label: tier.label, booked: occ.booked, sellable: occ.sellable, ...(suppressed ? { discount_held_back: true, window_days: Number(win) } : {}) },
      dow: { factor: dowFactor },
      event: { pct: eventPct },
      raw_pct: Math.round(rawPct * 100) / 100,
      final_pct: Math.round(pct * 100) / 100,
    },
  };
}

async function loadOccupancy(propertyId, roomType, from, to) {
  const { rows: units } = await db.query(
    `SELECT id, status FROM units WHERE property_id = $1 AND type = $2`, [propertyId, roomType]
  );
  const sellable = units.filter(u => u.status !== 'out_of_order').length;
  const ids = units.map(u => u.id);
  const { rows } = await db.query(
    `SELECT d::date AS date, COUNT(b.id)::int AS booked
     FROM generate_series($2::date, $3::date, interval '1 day') d
     LEFT JOIN bookings b ON b.property_id = $1 AND b.unit_id = ANY($4::uuid[])
       AND b.status NOT IN ('cancelled','no_show','checked_out')
       AND b.check_in_date <= d::date AND b.check_out_date > d::date
     GROUP BY d ORDER BY d`,
    [propertyId, from, to, ids]
  );
  return { sellable, byDate: Object.fromEntries(rows.map(r => [r.date, Math.min(r.booked, sellable || r.booked)])) };
}

// Per-date holiday/event uplift % over [from,to]. Multiple hits: the one with the
// greatest magnitude wins (a Nyepi −30 shouldn't be diluted by an overlapping +15).
async function loadEventUplifts(propertyId, from, to) {
  const { rows: hols } = await db.query(
    `SELECT h.holiday_date, h.name, h.category, h.is_joint_leave, u.uplift_pct AS override
     FROM holidays h LEFT JOIN yield_holiday_uplifts u ON u.property_id = $1 AND u.holiday_date = h.holiday_date
     WHERE h.holiday_date BETWEEN $2 AND $3`, [propertyId, from, to]
  );
  const { rows: evs } = await db.query(
    `SELECT name, date_from, date_to, uplift_pct FROM yield_events
     WHERE property_id = $1 AND status = 'approved' AND date_from <= $3 AND date_to >= $2`,
    [propertyId, from, to]
  );
  const out = {};
  const add = (date, pct, name) => {
    if (!out[date] || Math.abs(pct) > Math.abs(out[date].pct)) out[date] = { pct, name };
  };
  for (const h of hols) add(h.holiday_date, h.override != null ? Number(h.override) : defaultHolidayUplift(h), h.name);
  for (const e of evs) {
    for (let d = e.date_from < from ? from : e.date_from; d <= e.date_to && d <= to; d = addDays(d, 1)) {
      add(d, Number(e.uplift_pct), e.name);
    }
  }
  return out;
}

// Compute (and optionally apply) the auto rates for one property.
// dryRun=true: returns the plan without touching pricing_periods or the log.
async function runForProperty(propertyId, { dryRun = false } = {}) {
  const settingsList = await ensureSettings(propertyId);
  const start = await today();
  const runId = crypto.randomUUID();
  const result = [];

  const maxLook = Math.max(7, ...settingsList.filter(s => s.enabled).map(s => s.lookahead_days), 7);
  const events = await loadEventUplifts(propertyId, start, addDays(start, maxLook));

  const client = dryRun ? null : await db.pool.connect();
  try {
    if (client) await client.query('BEGIN');
    for (const s of settingsList) {
      const rows = [];
      const name = `Auto: ${s.room_type}`;
      if (s.enabled) {
        const end = addDays(start, s.lookahead_days - 1);
        const occ = await loadOccupancy(propertyId, s.room_type, start, end);
        for (let d = start; d <= end; d = addDays(d, 1)) {
          const ev = events[d] || null;
          const daysAhead = Math.round((new Date(d) - new Date(start)) / 86400000);
          const c = computeMultiplier(s, d, { booked: occ.byDate[d] || 0, sellable: occ.sellable }, ev ? ev.pct : 0, daysAhead);
          c.factors.event.name = ev ? ev.name : null;
          rows.push({ date: d, ...c });
        }
      }
      result.push({ room_type: s.room_type, enabled: s.enabled, rows });
      if (dryRun) continue;

      // previous auto multiplier per date (for the change log), then replace this type's auto periods
      const { rows: prev } = await client.query(
        `SELECT date_from, date_to, value FROM pricing_periods
         WHERE property_id = $1 AND source = 'auto' AND name = $2`, [propertyId, name]
      );
      const prevByDate = {};
      for (const p of prev) for (let d = p.date_from; d <= p.date_to; d = addDays(d, 1)) prevByDate[d] = Number(p.value);
      await client.query(`DELETE FROM pricing_periods WHERE property_id = $1 AND source = 'auto' AND name = $2`, [propertyId, name]);
      if (!s.enabled) continue;

      const { rows: unitRows } = await client.query('SELECT id FROM units WHERE property_id = $1 AND type = $2', [propertyId, s.room_type]);
      const unitIds = JSON.stringify(unitRows.map(u => u.id));
      // merge consecutive dates with identical multiplier into one period; skip ×1.0
      let cur = null;
      const flush = async () => {
        if (!cur) return;
        await client.query(
          `INSERT INTO pricing_periods (name, color, date_from, date_to, type, value, unit_ids, sort_order, property_id, source)
           VALUES ($1,$2,$3,$4,'multiplier',$5,$6,$7,$8,'auto')`,
          [name, AUTO_COLOR, cur.from, cur.to, cur.mult, unitIds, AUTO_SORT_ORDER, propertyId]
        );
        cur = null;
      };
      const sources = { occupancy: true, dow: (s.dow_factors || []).some(f => Number(f) !== 1), events: rows.some(r => r.factors.event.pct !== 0) };
      for (const r of rows) {
        if (r.multiplier === 1) { await flush(); }
        else if (cur && cur.mult === r.multiplier && addDays(cur.to, 1) === r.date) cur.to = r.date;
        else { await flush(); cur = { from: r.date, to: r.date, mult: r.multiplier }; }
        const old = prevByDate[r.date] ?? 1;
        if (Math.abs(old - r.multiplier) > 0.00001) {
          await client.query(
            `INSERT INTO yield_rate_log (property_id, room_type, stay_date, multiplier, factors, sources, old_multiplier, run_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [propertyId, s.room_type, r.date, r.multiplier, JSON.stringify({ ...r.factors, clamped: r.clamped }), JSON.stringify(sources), old, runId]
          );
        }
      }
      await flush();
    }
    // Housekeeping: drop auto periods that are entirely in the past (the log keeps the history).
    if (client) {
      await client.query(`DELETE FROM pricing_periods WHERE property_id = $1 AND source = 'auto' AND date_to < $2`, [propertyId, start]);
      await client.query('UPDATE yield_settings SET last_run_at = NOW() WHERE property_id = $1', [propertyId]);
      await client.query('COMMIT');
    }
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
  return { run_id: dryRun ? null : runId, dry_run: dryRun, from: start, room_types: result };
}

// Weekday-vs-weekend analysis of past stays, gated on a minimum amount of data so a
// 3-booking weekend is never read as a trend (see ROADMAP step 4).
async function dowReport(propertyId) {
  const start = await today();
  const { rows: [span] } = await db.query(
    `SELECT MIN(check_in_date) AS first_stay FROM bookings
     WHERE property_id = $1 AND status IN ('checked_in','checked_out') AND check_in_date < $2`, [propertyId, start]
  );
  const weeks = span?.first_stay ? Math.floor((new Date(start) - new Date(span.first_stay)) / (7 * 86400000)) : 0;
  const { rows } = await db.query(
    `WITH nights AS (
       SELECT u.type, d::date AS night, b.room_revenue / NULLIF(b.check_out_date - b.check_in_date, 0) AS rate
       FROM bookings b JOIN units u ON u.id = b.unit_id
       CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - 1, interval '1 day') d
       WHERE b.property_id = $1 AND b.status IN ('checked_in','checked_out') AND b.check_out_date > b.check_in_date
         AND d::date < $2
     ), rooms AS (SELECT type, COUNT(*)::int c FROM units WHERE property_id = $1 GROUP BY type)
     SELECT n.type AS room_type, EXTRACT(dow FROM n.night)::int AS dow, COUNT(*)::int AS room_nights,
            COUNT(DISTINCT n.night)::int AS days, r.c AS rooms,
            ROUND(100.0 * COUNT(*) / (COUNT(DISTINCT n.night) * r.c), 1) AS occ_pct, ROUND(AVG(n.rate)) AS avg_rate
     FROM nights n JOIN rooms r ON r.type = n.type GROUP BY n.type, dow, r.c ORDER BY n.type, dow`,
    [propertyId, start]
  );
  const byType = {};
  for (const r of rows) (byType[r.room_type] ||= { room_type: r.room_type, days: [] }).days.push(r);
  const types = Object.values(byType).map(t => {
    const enough = weeks >= MIN_HISTORY_WEEKS && t.days.length === 7 && t.days.every(d => d.room_nights >= MIN_NIGHTS_PER_DOW);
    return { ...t, enough_data: enough };
  });
  return { history_weeks: weeks, min_weeks: MIN_HISTORY_WEEKS, min_nights_per_dow: MIN_NIGHTS_PER_DOW, types };
}

module.exports = {
  AUTO_SORT_ORDER, MIN_HISTORY_WEEKS, MIN_NIGHTS_PER_DOW,
  defaultTiers, defaultHolidayUplift, ensureSettings, tierPct, computeMultiplier,
  loadEventUplifts, runForProperty, dowReport, addDays, today,
};
