const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const places = require('../services/googlePlaces');
const claude = require('../services/claude');
const { refreshCompetitors, refreshSearchTrends, refreshAiSummary, refreshHolidays } = require('../jobs/marketInsights');

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

// ── Market settings (migration 069) ─────────────────────────────────────────
// Per property: where it is (for Google searches + the AI briefing), which
// search terms to follow, a short description for the AI briefing, and its
// own Google listing (the competitors row with is_self = true).

async function loadMarketSettings(propertyId) {
  const [{ rows: [ps] }, { rows: [self] }] = await Promise.all([
    db.query('SELECT market_area, market_keywords, market_description FROM property_settings WHERE property_id = $1', [propertyId]),
    db.query('SELECT name, matched_address FROM competitors WHERE property_id = $1 AND is_self AND is_active LIMIT 1', [propertyId]),
  ]);
  return {
    area: ps?.market_area || '',
    keywords: ps?.market_keywords || [],
    description: ps?.market_description || '',
    self: self || null,
    places_configured: places.isConfigured(),
  };
}

// GET /api/insights/settings (owner)
router.get('/settings', auth, requireRole('owner'), async (req, res) => {
  try {
    res.json(await loadMarketSettings(req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/insights/settings { area, keywords[], description } (owner)
router.put('/settings', auth, requireRole('owner'), async (req, res) => {
  const area = String(req.body.area || '').trim().slice(0, 120) || null;
  const description = String(req.body.description || '').trim().slice(0, 300) || null;
  const raw = Array.isArray(req.body.keywords) ? req.body.keywords : [];
  const keywords = [...new Set(raw.map(k => String(k).trim().toLowerCase()).filter(Boolean))];
  if (keywords.length > 5) return res.status(400).json({ error: 'Follow at most 5 search terms' });
  if (keywords.some(k => k.length > 60)) return res.status(400).json({ error: 'A search term can be at most 60 characters' });
  try {
    const { rows: [before] } = await db.query('SELECT market_keywords FROM property_settings WHERE property_id = $1', [req.propertyId]);
    await db.query(
      'UPDATE property_settings SET market_area = $1, market_keywords = $2, market_description = $3 WHERE property_id = $4',
      [area, keywords, description, req.propertyId]
    );
    // New search terms: fetch their data now (in the background) so the
    // Dashboard card fills in without waiting for Monday's refresh.
    const added = keywords.filter(k => !(before?.market_keywords || []).includes(k));
    if (added.length) refreshSearchTrends(req.propertyId).catch(err => console.error('[Insights] Trend refresh after settings change failed:', err.message));
    res.json(await loadMarketSettings(req.propertyId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/insights/self { name } (owner) — find the property's own Google
// listing and use it as the "You" row on the Competitor Ratings card.
router.put('/self', auth, requireRole('owner'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!places.isConfigured()) return res.status(400).json({ error: 'Google Places API key not configured' });
  const client = await db.pool.connect();
  try {
    const { rows: [ps] } = await client.query('SELECT market_area FROM property_settings WHERE property_id = $1', [req.propertyId]);
    const match = await places.findPlace(name, ps?.market_area);
    if (!match) return res.status(404).json({ error: `No Google listing found for "${name}"` });   // released in finally
    await client.query('BEGIN');
    // Only one "You" row: the previous one is retired (its history is kept).
    await client.query(
      'UPDATE competitors SET is_self = false, is_active = false WHERE property_id = $1 AND is_self AND place_id IS DISTINCT FROM $2',
      [req.propertyId, match.placeId]
    );
    const { rows: [row] } = await client.query(
      `INSERT INTO competitors (name, place_id, matched_address, is_self, is_active, property_id)
       VALUES ($1, $2, $3, true, true, $4)
       ON CONFLICT (place_id, property_id) DO UPDATE SET name = EXCLUDED.name, matched_address = EXCLUDED.matched_address, is_self = true, is_active = true
       RETURNING id`,
      [match.name, match.placeId, match.address, req.propertyId]
    );
    await client.query(
      'INSERT INTO competitor_snapshots (competitor_id, rating, review_count, price_level) VALUES ($1, $2, $3, $4)',
      [row.id, match.rating, match.userRatingCount, match.priceLevel]
    );
    await client.query('COMMIT');
    res.json(await loadMarketSettings(req.propertyId));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/insights/competitors — add a competitor by name (owner only)
// Looks the name up on Google Places so the owner can see exactly what it resolved to.
router.post('/competitors', auth, requireRole('owner'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!places.isConfigured()) return res.status(400).json({ error: 'Google Places API key not configured' });

  try {
    const { rows: [ps] } = await db.query('SELECT market_area FROM property_settings WHERE property_id = $1', [req.propertyId]);
    const match = await places.findPlace(name, ps?.market_area);
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
    // Only the terms the property follows now (a removed term's history stays
    // in search_trends but isn't shown).
    const { rows } = await db.query(
      `SELECT st.term, st.point_date, st.interest FROM search_trends st
       JOIN property_settings ps ON ps.property_id = st.property_id
       WHERE st.property_id = $1 AND st.point_date >= CURRENT_DATE - INTERVAL '90 days'
         AND st.term = ANY(ps.market_keywords)
       ORDER BY st.term, st.point_date`,
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

// POST /api/insights/holidays/refresh — manual trigger (owner only).
// Refreshes the GLOBAL holidays table (not property-scoped, see migration 019) — any
// property's owner can trigger it, same as the other manual refresh endpoints here.
router.post('/holidays/refresh', auth, requireRole('owner'), async (req, res) => {
  try {
    await refreshHolidays();
    res.json({ message: 'Holidays refreshed' });
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
