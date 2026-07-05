// Google Places API (legacy) — text search to resolve a manually-entered competitor name,
// plus a direct details lookup for refreshing a known place by ID.
// Using the legacy endpoint rather than "Places API (New)": both expose the same fields we
// need, and the legacy one is what's actually enabled and working on this project.
// Gracefully no-ops when GOOGLE_PLACES_API_KEY isn't set (e.g. local dev without a key yet).

const SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

function isConfigured() {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

// Resolves a free-text name (as typed by the owner) to a Google Place — biased toward
// Kintamani, Bali since that's always where competitors are located.
async function findPlace(name) {
  const url = `${SEARCH_URL}?query=${encodeURIComponent(`${name} Kintamani Bali`)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Places search failed: ${data.status} ${data.error_message || ''}`);
  }
  const top = data.results?.[0];
  if (!top) return null;
  return {
    placeId: top.place_id,
    name: top.name,
    address: top.formatted_address,
    rating: top.rating ?? null,
    userRatingCount: top.user_ratings_total ?? null,
    priceLevel: top.price_level ?? null,
  };
}

// Direct lookup by known place_id — used to refresh a competitor already resolved earlier.
async function getPlaceDetails(placeId) {
  const url = `${DETAILS_URL}?place_id=${placeId}&fields=rating,user_ratings_total,price_level&key=${process.env.GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') {
    throw new Error(`Place details failed: ${data.status} ${data.error_message || ''}`);
  }
  return {
    rating: data.result.rating ?? null,
    userRatingCount: data.result.user_ratings_total ?? null,
    priceLevel: data.result.price_level ?? null,
  };
}

module.exports = { isConfigured, findPlace, getPlaceDetails };
