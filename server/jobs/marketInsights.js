const db = require('../db');
const places = require('../services/googlePlaces');
const trends = require('../services/trends');
const claude = require('../services/claude');

const TREND_TERMS = ['kintamani glamping', 'bali glamping'];

async function getActiveProperties() {
  const { rows } = await db.query('SELECT id FROM properties WHERE is_active = true');
  return rows;
}

// Manually-curated list (owner adds/removes competitors via the dashboard). This job just
// refreshes ratings for whatever's currently active — resolving a place_id on first sight,
// then reusing it on every later run.
async function refreshCompetitors(propertyId) {
  if (!places.isConfigured()) {
    console.log('[Insights] GOOGLE_PLACES_API_KEY not set — skipping competitor ratings refresh');
    return;
  }

  const { rows: competitors } = await db.query(
    'SELECT * FROM competitors WHERE is_active = true AND property_id = $1',
    [propertyId]
  );

  for (const c of competitors) {
    try {
      let placeId = c.place_id;

      if (!placeId) {
        const match = await places.findPlace(c.name);
        if (!match) {
          console.log(`[Insights] No Google Places match for "${c.name}"`);
          continue;
        }
        placeId = match.placeId;
        await db.query('UPDATE competitors SET place_id = $1, matched_address = $2 WHERE id = $3', [placeId, match.address, c.id]);
      }

      const details = await places.getPlaceDetails(placeId);
      await db.query(
        'INSERT INTO competitor_snapshots (competitor_id, rating, review_count, price_level) VALUES ($1, $2, $3, $4)',
        [c.id, details.rating, details.userRatingCount, details.priceLevel]
      );
    } catch (err) {
      console.error(`[Insights] Failed to refresh "${c.name}":`, err.message);
    }
  }

  console.log(`[Insights] Competitor ratings refreshed for property ${propertyId} — ${competitors.length} active competitor(s)`);
}

async function refreshSearchTrends(propertyId) {
  for (const term of TREND_TERMS) {
    try {
      const points = await trends.fetchInterestOverTime(term, 90);
      for (const p of points) {
        await db.query(
          `INSERT INTO search_trends (term, point_date, interest, property_id) VALUES ($1, $2, $3, $4)
           ON CONFLICT (term, point_date, property_id) DO UPDATE SET interest = EXCLUDED.interest`,
          [term, p.date, p.interest, propertyId]
        );
      }
    } catch (err) {
      console.error(`[Insights] Failed to refresh trend "${term}":`, err.message);
    }
  }
}

// Pulls the same data the dashboard cards show and has Claude synthesize a short briefing.
async function refreshAiSummary(propertyId) {
  if (!claude.isConfigured()) {
    console.log('[Insights] ANTHROPIC_API_KEY not set — skipping AI summary');
    return;
  }

  const { rows: competitors } = await db.query(
    'SELECT * FROM competitors WHERE is_active = true AND property_id = $1 ORDER BY is_self DESC, name',
    [propertyId]
  );
  const competitorData = await Promise.all(competitors.map(async c => {
    const { rows: [latest] } = await db.query(
      'SELECT * FROM competitor_snapshots WHERE competitor_id = $1 ORDER BY captured_at DESC LIMIT 1', [c.id]
    );
    const { rows: [prior] } = await db.query(
      `SELECT * FROM competitor_snapshots WHERE competitor_id = $1 AND captured_at <= NOW() - INTERVAL '6 days'
       ORDER BY captured_at DESC LIMIT 1`, [c.id]
    );
    return {
      name: c.name,
      is_self: c.is_self,
      rating: latest ? parseFloat(latest.rating) : null,
      review_count: latest ? latest.review_count : null,
      rating_delta: latest && prior ? parseFloat(latest.rating) - parseFloat(prior.rating) : null,
      review_count_delta: latest && prior ? latest.review_count - prior.review_count : null,
    };
  }));

  const { rows: trendRows } = await db.query(
    `SELECT term, point_date, interest FROM search_trends
     WHERE property_id = $1 AND point_date >= CURRENT_DATE - INTERVAL '14 days'
     ORDER BY term, point_date`,
    [propertyId]
  );
  const trendData = {};
  for (const r of trendRows) {
    if (!trendData[r.term]) trendData[r.term] = [];
    trendData[r.term].push({ date: r.point_date, interest: r.interest });
  }

  const { rows: holidayRows } = await db.query(
    `SELECT holiday_date, name FROM holidays WHERE holiday_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '45 days' ORDER BY holiday_date`
  );

  try {
    const summary = await claude.generateMarketSummary({
      competitors: competitorData,
      trends: trendData,
      holidays: holidayRows,
    });
    await db.query(
      'UPDATE ai_market_summary SET summary = $1, generated_at = NOW() WHERE property_id = $2',
      [JSON.stringify(summary), propertyId]
    );
    console.log(`[Insights] AI summary refreshed for property ${propertyId}`);
  } catch (err) {
    console.error('[Insights] Failed to generate AI summary:', err.message);
  }
}

async function refreshCompetitorsAllProperties() {
  const properties = await getActiveProperties();
  for (const prop of properties) await refreshCompetitors(prop.id);
}

async function refreshSearchTrendsAllProperties() {
  const properties = await getActiveProperties();
  for (const prop of properties) await refreshSearchTrends(prop.id);
}

async function refreshAiSummaryAllProperties() {
  const properties = await getActiveProperties();
  for (const prop of properties) await refreshAiSummary(prop.id);
}

module.exports = {
  refreshCompetitors,
  refreshSearchTrends,
  refreshAiSummary,
  refreshCompetitorsAllProperties,
  refreshSearchTrendsAllProperties,
  refreshAiSummaryAllProperties,
};
