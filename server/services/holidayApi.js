// api.co.id Indonesian Holidays API — https://docs.api.co.id/products/indonesian-holidays/
// Base URL confirmed live (not documented in the static docs page, which renders its
// interactive reference client-side): https://use.api.co.id
// Auth: `x-api-co-id: <key>` header. Gracefully no-ops when HOLIDAY_API_KEY isn't set,
// same convention as googlePlaces.js/claude.js.

const BASE_URL = process.env.HOLIDAY_API_URL || 'https://use.api.co.id';

function isConfigured() {
  return !!process.env.HOLIDAY_API_KEY;
}

// Fetches every row the API has for one calendar year — real public holidays AND
// "Observance"/awareness days (e.g. "Hari Kartini") in the same list, distinguished only
// by the is_holiday/is_joint_holiday/is_observance flags. Caller decides what to keep.
// Paginates defensively even though a year currently fits on one page (~56 rows, default
// page size 100).
async function fetchYear(year) {
  const out = [];
  let page = 1;
  for (;;) {
    const url = `${BASE_URL}/holidays/indonesia?year=${year}&page=${page}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-co-id': process.env.HOLIDAY_API_KEY },
    });
    const data = await res.json();
    if (!data.is_success) throw new Error(`Holiday API failed for ${year}: ${data.message || res.status}`);
    out.push(...(data.data || []));
    const { page: currentPage, total_page } = data.paging || {};
    if (!total_page || currentPage >= total_page) break;
    page++;
  }
  return out;
}

module.exports = { isConfigured, fetchYear };
