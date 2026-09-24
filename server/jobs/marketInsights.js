const db = require('../db');
const places = require('../services/googlePlaces');
const trends = require('../services/trends');
const claude = require('../services/claude');
const holidayApi = require('../services/holidayApi');

// Market settings per property (migration 069): market_area, market_keywords,
// market_description on property_settings.
async function marketSettings(propertyId) {
  const { rows: [ps] } = await db.query(
    `SELECT property_name, property_address, market_area, market_keywords, market_description
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  return ps || {};
}
const HOLIDAY_SYNC_YEARS_AHEAD = 2; // covers yield's max 365-day lookahead even from Dec 31

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

  const { market_area: area } = await marketSettings(propertyId);
  for (const c of competitors) {
    try {
      let placeId = c.place_id;

      if (!placeId) {
        const match = await places.findPlace(c.name, area);
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

// The property's own search terms (Settings → Property Details → Market Insights).
async function refreshSearchTrends(propertyId) {
  const { market_keywords: terms = [] } = await marketSettings(propertyId);
  for (const term of terms) {
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

  // Who the briefing is for — from the property's own settings, not hardcoded.
  const ms = await marketSettings(propertyId);
  const { rows: [{ rooms }] } = await db.query('SELECT COUNT(*)::int AS rooms FROM units WHERE property_id = $1', [propertyId]);
  const property = {
    name: ms.property_name || 'the property',
    description: ms.market_description || null,
    area: ms.market_area || ms.property_address || null,
    rooms,
  };

  try {
    const summary = await claude.generateMarketSummary({
      property,
      competitors: competitorData,
      trends: trendData,
      holidays: holidayRows,
    });
    if (!summary) {
      console.log(`[Insights] No AI summary this time for property ${propertyId} — keeping the previous one`);
      return;
    }
    await db.query(
      'UPDATE ai_market_summary SET summary = $1, generated_at = NOW() WHERE property_id = $2',
      [JSON.stringify(summary), propertyId]
    );
    console.log(`[Insights] AI summary refreshed for property ${propertyId}`);
  } catch (err) {
    console.error('[Insights] Failed to generate AI summary:', err.message);
  }
}

// Refreshes the GLOBAL `holidays` table (shared across every property — see migration
// 019) from the live api.co.id Indonesian Holidays API. Only real public holidays and
// cuti bersama/joint-leave days are kept — the API also returns plain "Observance"/
// awareness days (e.g. "Hari Kartini") mixed into the same list, which don't move guest
// demand the way a statutory holiday does, so those are dropped.
// Supersedes migration 061's hand-seeded 'skb' rows: both sources are deleted for the
// synced date range before the fresh 'api_co_id' rows go in, so a date is never listed
// twice under two different names. Never touches source='manual' rows (the pawukon-
// calendar Balinese Hindu holidays from migration 014 — not in any generic holiday API)
// or per-property yield_holiday_uplifts overrides (keyed by date, so an owner's edit
// survives a resync regardless of which holiday row exists for that date).
async function refreshHolidays() {
  if (!holidayApi.isConfigured()) {
    console.log('[Insights] HOLIDAY_API_KEY not set — skipping holiday sync');
    return;
  }
  const thisYear = new Date().getFullYear();
  let synced = 0;
  for (let year = thisYear; year <= thisYear + HOLIDAY_SYNC_YEARS_AHEAD; year++) {
    try {
      const rows = await holidayApi.fetchYear(year);
      const keep = rows.filter(r => r.is_holiday || r.is_joint_holiday);
      // The API doesn't publish next year's calendar until sometime after the SKB decree
      // is signed (observed: nothing for 2027 as of 2026-09-21, days after that year's SKB
      // was actually signed). Skip entirely rather than deleting a year's rows with nothing
      // to replace them — leaves the migration-061 'skb' fallback seed intact until the API
      // actually has that year, at which point this same loop supersedes it cleanly.
      if (!keep.length) continue;
      // Delete by the exact dates being (re)inserted, not the whole year — so a date the
      // API hasn't caught up on yet (partial-year coverage) also keeps its 'skb' fallback.
      await db.query(
        `DELETE FROM holidays WHERE source IN ('api_co_id', 'skb') AND holiday_date = ANY($1::date[])`,
        [keep.map(h => h.date)]
      );
      for (const h of keep) {
        await db.query(
          `INSERT INTO holidays (holiday_date, name, category, is_joint_leave, source)
           VALUES ($1, $2, 'national', $3, 'api_co_id')
           ON CONFLICT (holiday_date, name) DO UPDATE SET is_joint_leave = EXCLUDED.is_joint_leave, source = 'api_co_id'`,
          [h.date, h.name, !!h.is_joint_holiday]
        );
      }
      synced += keep.length;
    } catch (err) {
      console.error(`[Insights] Holiday sync failed for ${year}:`, err.message);
    }
  }
  console.log(`[Insights] Holidays synced from api.co.id — ${synced} holiday/joint-leave day(s), ${thisYear}-${thisYear + HOLIDAY_SYNC_YEARS_AHEAD}`);
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
  refreshHolidays,
  refreshCompetitorsAllProperties,
  refreshSearchTrendsAllProperties,
  refreshAiSummaryAllProperties,
};
