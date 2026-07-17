const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const places = require('../services/googlePlaces');
const claude = require('../services/claude');
const { refreshCompetitors, refreshSearchTrends, refreshAiSummary } = require('../jobs/marketInsights');

// GET /api/insights/competitors
// Latest rating per competitor, plus the snapshot from ~7 days ago for a trend delta.
router.get('/competitors', auth, async (req, res) => {
  try {
    const { rows: competitors } = await db.query(
      'SELECT * FROM competitors WHERE is_active = true AND property_id = $1 ORDER BY is_self DESC, name',
      [req.propertyId]
    );

    const result = await Promise.all(competitors.map(async c => {
      const { rows: latestRows } = await db.query(
        'SELECT * FROM competitor_snapshots WHERE competitor_id = $1 ORDER BY captured_at DESC LIMIT 1',
        [c.id]
      );
      const { rows: priorRows } = await db.query(
        `SELECT * FROM competitor_snapshots
         WHERE competitor_id = $1 AND captured_at <= NOW() - INTERVAL '6 days'
         ORDER BY captured_at DESC LIMIT 1`,
        [c.id]
      );
      const latest = latestRows[0] || null;
      const prior = priorRows[0] || null;

      return {
        id: c.id,
        name: c.name,
        matched_address: c.matched_address,
        is_self: c.is_self,
        configured: places.isConfigured(),
        rating: latest ? parseFloat(latest.rating) : null,
        review_count: latest ? latest.review_count : null,
        price_level: latest ? latest.price_level : null,
        rating_delta: latest && prior ? parseFloat(latest.rating) - parseFloat(prior.rating) : null,
        review_count_delta: latest && prior ? latest.review_count - prior.review_count : null,
        last_checked: latest ? latest.captured_at : null,
      };
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/insights/competitors — add a competitor by name (owner only)
// Looks the name up on Google Places so the owner can see exactly what it resolved to.
router.post('/competitors', auth, requireRole('owner'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!places.isConfigured()) return res.status(400).json({ error: 'Google Places API key not configured' });

  try {
    const match = await places.findPlace(name);
    if (!match) return res.status(404).json({ error: `No Google listing found for "${name}"` });

    const { rows: [competitor] } = await db.query(
      `INSERT INTO competitors (name, place_id, matched_address, is_active, property_id)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (place_id, property_id) DO UPDATE SET name = EXCLUDED.name, matched_address = EXCLUDED.matched_address, is_active = true
       RETURNING id`,
      [match.name, match.placeId, match.address, req.propertyId]
    );
    await db.query(
      'INSERT INTO competitor_snapshots (competitor_id, rating, review_count, price_level) VALUES ($1, $2, $3, $4)',
      [competitor.id, match.rating, match.userRatingCount, match.priceLevel]
    );

    res.status(201).json({ id: competitor.id, matched_name: match.name, matched_address: match.address });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/insights/competitors/:id — remove a manually-added competitor (owner only)
router.delete('/competitors/:id', auth, requireRole('owner'), async (req, res) => {
  try {
    const { rows: [c] } = await db.query('SELECT is_self FROM competitors WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (c.is_self) return res.status(400).json({ error: 'Cannot remove the self-benchmark row' });

    await db.query('UPDATE competitors SET is_active = false WHERE id = $1 AND property_id = $2', [req.params.id, req.propertyId]);
    res.json({ message: 'Removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/insights/competitors/refresh — manual trigger (owner only)
router.post('/competitors/refresh', auth, requireRole('owner'), async (req, res) => {
  try {
    await refreshCompetitors(req.propertyId);
    res.json({ message: 'Competitor ratings refreshed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/insights/trends
router.get('/trends', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT term, point_date, interest FROM search_trends
       WHERE property_id = $1 AND point_date >= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY term, point_date`,
      [req.propertyId]
    );
    const byTerm = {};
    for (const r of rows) {
      if (!byTerm[r.term]) byTerm[r.term] = [];
      byTerm[r.term].push({ date: r.point_date, interest: r.interest });
    }
    res.json(byTerm);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/insights/trends/refresh — manual trigger (owner only)
router.post('/trends/refresh', auth, requireRole('owner'), async (req, res) => {
  try {
    await refreshSearchTrends(req.propertyId);
    res.json({ message: 'Search trends refreshed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/insights/holidays?days=45
router.get('/holidays', auth, async (req, res) => {
  const days = parseInt(req.query.days) || 45;
  try {
    const { rows } = await db.query(
      `SELECT holiday_date, name, category FROM holidays
       WHERE holiday_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1 * INTERVAL '1 day'
       ORDER BY holiday_date`,
      [days]
    );
    res.json(rows.map(r => ({
      date: r.holiday_date,
      name: r.name,
      category: r.category,
      days_until: Math.ceil((new Date(r.holiday_date) - new Date(new Date().toDateString())) / 86400000),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/insights/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const { rows: [row] } = await db.query('SELECT summary, generated_at FROM ai_market_summary WHERE property_id = $1', [req.propertyId]);
    let summary = null;
    if (row?.summary) {
      try { summary = JSON.parse(row.summary); } catch { summary = null; }
    }
    res.json({
      summary,
      generated_at: row?.generated_at || null,
      configured: claude.isConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/insights/summary/refresh — manual trigger (owner only)
router.post('/summary/refresh', auth, requireRole('owner'), async (req, res) => {
  try {
    await refreshAiSummary(req.propertyId);
    res.json({ message: 'AI summary refreshed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
