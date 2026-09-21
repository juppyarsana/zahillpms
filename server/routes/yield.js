const router = require('express').Router();
const db = require('../db');
const y = require('../services/yieldService');

// Mounted in index.js as: auth → moduleGuard('yield_management') → requireRole('owner').
// Every query is property_id-scoped (req.propertyId).

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// Validate + normalise a settings payload. Returns { error } or { value }.
function validateSettings(b, current) {
  const out = {};
  if (b.enabled !== undefined) out.enabled = !!b.enabled;
  const mode = b.tier_mode ?? current.tier_mode;
  if (!['percent', 'rooms_left'].includes(mode)) return { error: 'tier_mode must be percent or rooms_left' };
  out.tier_mode = mode;
  if (b.tiers !== undefined || b.tier_mode !== undefined) {
    const tiers = b.tiers ?? y.defaultTiers(mode);
    const key = mode === 'percent' ? 'from' : 'left';
    if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > 12) return { error: 'tiers must be a list of 1–12 entries' };
    for (const t of tiers) {
      if (!isNum(Number(t[key])) || !isNum(Number(t.pct))) return { error: `each tier needs "${key}" and "pct"` };
      if (mode === 'percent' && (Number(t.from) < 0 || Number(t.from) > 100)) return { error: `Occupancy threshold ${t.from}% is not valid — each tier must be between 0 and 100` };
      if (mode === 'rooms_left' && (Number(t.left) < 1 || Number(t.left) > 500)) return { error: `Rooms-left value ${t.left} is not valid — must be between 1 and 500` };
      if (Number(t.pct) < -90 || Number(t.pct) > 200) return { error: `Price change ${t.pct}% is not valid — must be between -90 and 200` };
    }
    out.tiers = tiers.map(t => ({ [key]: Number(t[key]), pct: Number(t.pct) })).sort((a, b) => a[key] - b[key]);
  }
  if (b.dow_factors !== undefined) {
    const f = b.dow_factors;
    if (!Array.isArray(f) || f.length !== 7 || !f.every(n => isNum(Number(n)) && Number(n) >= 0.5 && Number(n) <= 2)) {
      return { error: 'dow_factors must be 7 numbers between 0.5 and 2 (Sun..Sat)' };
    }
    out.dow_factors = f.map(Number);
  }
  const floor = b.floor_pct ?? current.floor_pct;
  const ceil = b.ceiling_pct ?? current.ceiling_pct;
  if (!(Number(floor) <= 0 && Number(floor) >= -90)) return { error: 'floor must be between -90 and 0' };
  if (!(Number(ceil) >= 0 && Number(ceil) <= 200)) return { error: 'ceiling must be between 0 and 200' };
  out.floor_pct = Number(floor);
  out.ceiling_pct = Number(ceil);
  if (b.discount_window_days !== undefined) {
    if (b.discount_window_days === null || b.discount_window_days === '') out.discount_window_days = null;
    else {
      const w = parseInt(b.discount_window_days, 10);
      if (!(w >= 0 && w <= 365)) return { error: 'Discount window must be 0–365 days (or empty for no limit)' };
      out.discount_window_days = w;
    }
  }
  if (b.lookahead_days !== undefined) {
    const n = parseInt(b.lookahead_days, 10);
    if (!(n >= 7 && n <= 365)) return { error: 'lookahead_days must be 7–365' };
    out.lookahead_days = n;
  }
  return { value: out };
}

// GET /api/yield/overview — settings per room type + the "Sources in use" panel.
router.get('/overview', async (req, res) => {
  try {
    const settings = await y.ensureSettings(req.propertyId);
    const start = await y.today();
    const enabled = settings.filter(s => s.enabled);
    const look = Math.max(0, ...enabled.map(s => s.lookahead_days));
    const report = await y.dowReport(req.propertyId);
    const { rows: [hol] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM holidays WHERE holiday_date BETWEEN $1 AND $2`,
      [start, y.addDays(start, look || 60)]
    );
    const { rows: [ev] } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status='approved')::int AS approved, COUNT(*) FILTER (WHERE status='suggested')::int AS suggested
       FROM yield_events WHERE property_id = $1 AND date_to >= $2`, [req.propertyId, start]
    );
    const usesDow = enabled.some(s => (s.dow_factors || []).some(f => Number(f) !== 1));
    const lastRun = settings.map(s => s.last_run_at).filter(Boolean).sort().pop() || null;
    const sources = [
      { key: 'occupancy', label: 'Occupancy', status: enabled.length ? 'in_use' : 'off',
        detail: 'Live from your bookings, counted per room type per night (out-of-order rooms excluded).' },
      { key: 'dow', label: 'Day of week', status: usesDow ? 'in_use' : 'off',
        detail: usesDow ? 'Your weekday/weekend factors (Settings tab).' : 'No weekday/weekend factor set — every day is treated the same.' },
      { key: 'holidays', label: 'Holidays & events', status: enabled.length ? 'in_use' : 'off',
        detail: `${hol.n} official holidays in the window (Indonesian national holidays + cuti bersama, synced nightly from api.co.id; Balinese Hindu observances added manually) and ${ev.approved} custom event(s); uplifts are yours to edit in the Events tab.` },
      { key: 'history', label: 'Booking history (weekday vs weekend)',
        status: report.history_weeks >= report.min_weeks ? 'report_only' : 'waiting',
        detail: report.history_weeks >= report.min_weeks
          ? 'Enough history to show suggestions in the Reports tab. Suggestions are never applied automatically.'
          : `Not enough data yet: ${report.history_weeks} of ${report.min_weeks} weeks. Reports only show suggestions once there is enough history.` },
      { key: 'ai_events', label: 'AI local-events finder', status: 'coming_soon',
        detail: 'Planned for v1.1 — will only suggest events for you to approve; it never changes a rate by itself.' },
      { key: 'competitors', label: 'Competitor rates', status: 'not_connected',
        detail: 'Not connected. Market Insights tracks competitor ratings only, not their nightly prices.' },
    ];
    res.json({
      settings: settings.map(s => ({
        room_type: s.room_type, rooms: s.rooms, base_rate: Number(s.base_rate), enabled: s.enabled,
        tier_mode: s.tier_mode, tiers: s.tiers, dow_factors: s.dow_factors,
        floor_pct: Number(s.floor_pct), ceiling_pct: Number(s.ceiling_pct), lookahead_days: s.lookahead_days,
        discount_window_days: s.discount_window_days,
      })),
      sources,
      last_run_at: lastRun,
      schedule: 'Nightly at 02:00 (WITA)',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/yield/settings/:roomType — does NOT apply rates; use POST /run (or wait for the nightly job).
router.put('/settings/:roomType', async (req, res) => {
  try {
    const settings = await y.ensureSettings(req.propertyId);
    const cur = settings.find(s => s.room_type === req.params.roomType);
    if (!cur) return res.status(404).json({ error: 'Room type not found' });
    const { error, value } = validateSettings(req.body || {}, cur);
    if (error) return res.status(400).json({ error });
    const next = { ...cur, ...value };
    await db.query(
      `UPDATE yield_settings SET enabled=$3, tier_mode=$4, tiers=$5, dow_factors=$6,
         floor_pct=$7, ceiling_pct=$8, lookahead_days=$9, discount_window_days=$10, updated_at=NOW()
       WHERE property_id=$1 AND room_type=$2`,
      [req.propertyId, cur.room_type, next.enabled, next.tier_mode, JSON.stringify(next.tiers),
       JSON.stringify(next.dow_factors), next.floor_pct, next.ceiling_pct, next.lookahead_days, next.discount_window_days]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/yield/run { dry_run?: boolean } — recalculate now (dry_run = preview, writes nothing).
router.post('/run', async (req, res) => {
  try {
    res.json(await y.runForProperty(req.propertyId, { dryRun: !!req.body?.dry_run }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/yield/rates?month=YYYY-MM — the final rate per room type per night for that whole
// month (default: the current month) and where each rate came from. `today` lets the client dim past days.
router.get('/rates', async (req, res) => {
  try {
    const today = await y.today();
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') ? req.query.month : today.slice(0, 7);
    const start = month + '-01';
    const [yy, mm] = month.split('-').map(Number);
    const end = month + '-' + String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0');
    const { rows: units } = await db.query(
      'SELECT id, type, base_rate, name FROM units WHERE property_id = $1 AND type IS NOT NULL ORDER BY type, name', [req.propertyId]
    );
    const { rows: periods } = await db.query(
      `SELECT * FROM pricing_periods WHERE property_id = $1 AND is_active = true AND date_from <= $3 AND date_to >= $2
       ORDER BY sort_order DESC`, [req.propertyId, start, end]
    );
    const { rows: logs } = await db.query(
      `SELECT DISTINCT ON (room_type, stay_date) room_type, stay_date, factors, created_at
       FROM yield_rate_log WHERE property_id = $1 AND stay_date BETWEEN $2 AND $3
       ORDER BY room_type, stay_date, created_at DESC`, [req.propertyId, start, end]
    );
    const logMap = Object.fromEntries(logs.map(l => [`${l.room_type}|${l.stay_date}`, l.factors]));
    const types = {};
    for (const u of units) (types[u.type] ||= u); // representative unit = first by name
    const out = Object.values(types).map(u => {
      const base = parseFloat(u.base_rate);
      const cover = periods.filter(p => p.unit_ids.length === 0 || p.unit_ids.includes(u.id));
      const dates = [];
      for (let d = start; d <= end; d = y.addDays(d, 1)) {
        const p = cover.find(x => x.date_from <= d && x.date_to >= d);
        const rate = Math.round(p ? (p.type === 'fixed' ? parseFloat(p.value) : base * parseFloat(p.value)) : base);
        dates.push({
          date: d, rate,
          origin: !p ? 'base' : p.source === 'auto' ? 'auto' : 'manual',
          period: p ? { name: p.name, type: p.type, value: Number(p.value) } : null,
          factors: p && p.source === 'auto' ? (logMap[`${u.type}|${d}`] || null) : null,
        });
      }
      return { room_type: u.type, base_rate: base, dates };
    });
    res.json({ month, today, from: start, to: end, room_types: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/yield/log?room_type=&limit=  — recent automatic changes.
router.get('/log', async (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const params = [req.propertyId, limit];
    let where = 'property_id = $1';
    if (req.query.room_type) { params.push(req.query.room_type); where += ` AND room_type = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT room_type, stay_date, multiplier, old_multiplier, factors, sources, created_at
       FROM yield_rate_log WHERE ${where} ORDER BY created_at DESC, stay_date LIMIT $2`, params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/yield/report/dow — weekday-vs-weekend analysis (gated on minimum data).
router.get('/report/dow', async (req, res) => {
  try {
    res.json(await y.dowReport(req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Events tab ────────────────────────────────────────────────

// GET /api/yield/events — upcoming holidays (with default vs owner uplift) + custom events.
router.get('/events', async (req, res) => {
  try {
    const start = await y.today();
    const { rows: hols } = await db.query(
      `SELECT h.holiday_date, h.name, h.category, h.is_joint_leave, h.source, u.uplift_pct AS override
       FROM holidays h LEFT JOIN yield_holiday_uplifts u ON u.property_id = $1 AND u.holiday_date = h.holiday_date
       WHERE h.holiday_date >= $2 ORDER BY h.holiday_date, h.is_joint_leave`, [req.propertyId, start]
    );
    const { rows: events } = await db.query(
      `SELECT * FROM yield_events WHERE property_id = $1 AND date_to >= $2 ORDER BY date_from`, [req.propertyId, start]
    );
    res.json({
      holidays: hols.map(h => {
        const def = y.defaultHolidayUplift(h);
        return { holiday_date: h.holiday_date, name: h.name, category: h.category, is_joint_leave: h.is_joint_leave,
          source: h.source, default_uplift: def, uplift_pct: h.override != null ? Number(h.override) : def, is_custom: h.override != null };
      }),
      events,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/yield/holiday-uplift { holiday_date, uplift_pct | null (reset to default) }
router.put('/holiday-uplift', async (req, res) => {
  try {
    const { holiday_date, uplift_pct } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday_date || '')) return res.status(400).json({ error: 'holiday_date required (YYYY-MM-DD)' });
    if (uplift_pct === null) {
      await db.query('DELETE FROM yield_holiday_uplifts WHERE property_id = $1 AND holiday_date = $2', [req.propertyId, holiday_date]);
      return res.json({ ok: true });
    }
    const pct = Number(uplift_pct);
    if (!Number.isFinite(pct) || pct < -90 || pct > 200) return res.status(400).json({ error: 'uplift_pct must be between -90 and 200' });
    await db.query(
      `INSERT INTO yield_holiday_uplifts (property_id, holiday_date, uplift_pct) VALUES ($1,$2,$3)
       ON CONFLICT (property_id, holiday_date) DO UPDATE SET uplift_pct = EXCLUDED.uplift_pct`,
      [req.propertyId, holiday_date, pct]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/yield/events — owner-added local event (v1.1 will also insert AI suggestions here as status='suggested').
router.post('/events', async (req, res) => {
  try {
    const { name, date_from, date_to, uplift_pct } = req.body || {};
    const pct = Number(uplift_pct);
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date_from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date_to || '')) {
      return res.status(400).json({ error: 'name, date_from, date_to required' });
    }
    if (date_to < date_from) return res.status(400).json({ error: 'date_to must be on or after date_from' });
    if (!Number.isFinite(pct) || pct < -90 || pct > 200) return res.status(400).json({ error: 'uplift_pct must be between -90 and 200' });
    const { rows: [row] } = await db.query(
      `INSERT INTO yield_events (property_id, name, date_from, date_to, uplift_pct) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.propertyId, String(name).slice(0, 200), date_from, date_to, pct]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/events/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM yield_events WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
