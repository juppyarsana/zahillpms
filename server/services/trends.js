// Google Trends — unofficial wrapper around Google's public Trends interface.
// Aggregate, anonymized search-interest data (not scraping any single listing/site).
// This library reads an undocumented endpoint, so it can break if Google changes it —
// callers should treat failures as non-fatal.

const googleTrends = require('google-trends-api');

async function fetchInterestOverTime(term, days = 90) {
  const raw = await googleTrends.interestOverTime({
    keyword: term,
    geo: 'ID',
    startTime: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  });
  const parsed = JSON.parse(raw);
  return (parsed.default?.timelineData || []).map(pt => ({
    date: new Date(Number(pt.time) * 1000).toISOString().slice(0, 10),
    interest: pt.value?.[0] ?? 0,
  }));
}

module.exports = { fetchInterestOverTime };
