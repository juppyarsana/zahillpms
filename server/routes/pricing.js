const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/pricing/periods
router.get('/periods', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM pricing_periods ORDER BY sort_order DESC, date_from'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pricing/suggest?unit_id=&check_in=&check_out=
// Returns suggested total and which period was applied
router.get('/suggest', auth, async (req, res) => {
  const { unit_id, check_in, check_out } = req.query;
  if (!unit_id || !check_in || !check_out) {
    return res.status(400).json({ error: 'unit_id, check_in, check_out required' });
  }
  try {
    const nights = Math.max(0,
      (new Date(check_out) - new Date(check_in)) / 86400000
    );
    if (nights === 0) return res.json({ nights: 0, suggested_total: 0, period: null });

    const { rows: [unit] } = await db.query('SELECT * FROM units WHERE id = $1', [unit_id]);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    // Find highest-priority active period covering check_in date
    const { rows: periods } = await db.query(`
      SELECT * FROM pricing_periods
      WHERE is_active = true
        AND date_from <= $1
        AND date_to >= $1
        AND (unit_ids = '[]'::jsonb OR unit_ids @> $2::jsonb)
      ORDER BY sort_order DESC
      LIMIT 1
    `, [check_in, JSON.stringify([unit_id])]);

    const period = periods[0] || null;
    let rate_per_night = parseFloat(unit.base_rate);

    if (period) {
      if (period.type === 'fixed') {
        rate_per_night = parseFloat(period.value);
      } else {
        rate_per_night = parseFloat(unit.base_rate) * parseFloat(period.value);
      }
    }

    res.json({
      nights,
      base_rate: parseFloat(unit.base_rate),
      rate_per_night: Math.round(rate_per_night),
      suggested_total: Math.round(rate_per_night * nights),
      period: period ? { name: period.name, type: period.type, value: period.value, color: period.color } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pricing/calendar?month=&year=
// Returns each unit's effective nightly rate for every day of the given month:
// { [unit_id]: { [day]: rate, ... }, ... }
router.get('/calendar', auth, async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month, year required' });

  try {
    const daysInMonth = new Date(year, month, 0).getDate();
    const pad = n => String(n).padStart(2, '0');
    const monthStart = `${year}-${pad(month)}-01`;
    const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth)}`;

    const { rows: units } = await db.query('SELECT id, base_rate FROM units');
    const { rows: periods } = await db.query(`
      SELECT * FROM pricing_periods
      WHERE is_active = true AND date_from <= $1 AND date_to >= $2
      ORDER BY sort_order DESC
    `, [monthEnd, monthStart]);

    const rates = {};
    for (const unit of units) {
      const baseRate = parseFloat(unit.base_rate);
      const unitPeriods = periods.filter(p => p.unit_ids.length === 0 || p.unit_ids.includes(unit.id));

      const byDay = {};
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${pad(month)}-${pad(d)}`;
        const period = unitPeriods.find(p => p.date_from <= dateStr && p.date_to >= dateStr);
        byDay[d] = Math.round(period
          ? (period.type === 'fixed' ? parseFloat(period.value) : baseRate * parseFloat(period.value))
          : baseRate);
      }
      rates[unit.id] = byDay;
    }

    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pricing/periods
router.post('/periods', auth, requireRole('owner'), async (req, res) => {
  const { name, color, date_from, date_to, type, value, unit_ids, sort_order } = req.body;
  if (!name || !date_from || !date_to || value === undefined) {
    return res.status(400).json({ error: 'name, date_from, date_to, value required' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO pricing_periods (name, color, date_from, date_to, type, value, unit_ids, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, color || '#6b7280', date_from, date_to, type || 'multiplier', value,
       JSON.stringify(unit_ids || []), sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pricing/periods/:id
router.put('/periods/:id', auth, requireRole('owner'), async (req, res) => {
  const { name, color, date_from, date_to, type, value, unit_ids, sort_order, is_active } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE pricing_periods SET
        name = COALESCE($1, name),
        color = COALESCE($2, color),
        date_from = COALESCE($3, date_from),
        date_to = COALESCE($4, date_to),
        type = COALESCE($5, type),
        value = COALESCE($6, value),
        unit_ids = COALESCE($7, unit_ids),
        sort_order = COALESCE($8, sort_order),
        is_active = COALESCE($9, is_active)
       WHERE id = $10 RETURNING *`,
      [name, color, date_from, date_to, type, value,
       unit_ids ? JSON.stringify(unit_ids) : null,
       sort_order, is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Period not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pricing/periods/:id
router.delete('/periods/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    await db.query('DELETE FROM pricing_periods WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
