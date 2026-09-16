// Channex channel-manager adapter — spike/validation only (see migration 060
// and routes/channelManager.js). Deliberately vendor-specific and isolated
// behind a plain function interface (isConfigured/push*/pull*) so a future
// beds24Adapter.js or staahAdapter.js could implement the same shape without
// any caller (routes/channelManager.js) needing to change.
//
// NOTE: the request/response field names below (property/room_type/rate_plan
// creation especially) are best-effort from Channex's public docs
// (docs.channex.io) — verify against the live staging Swagger UI and adjust
// as needed. Expected iteration for a spike, not a sign something's broken.

const BASE_URL = process.env.CHANNEX_API_URL || 'https://staging.channex.io/api/v1';

function isConfigured() {
  return !!process.env.CHANNEX_API_KEY;
}

async function request(method, path, body) {
  if (!isConfigured()) throw new Error('Channex is not configured (CHANNEX_API_KEY unset)');
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'user-api-key': process.env.CHANNEX_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Channex ${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ── One-time setup (spike scope: one property, one room type, one rate plan) ──

async function createProperty({ title, currency = 'IDR', timezone = 'Asia/Makassar' }) {
  const data = await request('POST', '/properties', { property: { title, currency, timezone } });
  return data.data; // Channex wraps responses as { data: {...} }
}

// Idempotent — a prior attempt may have created the room type on Channex's
// side but failed on a later step (e.g. rate plan validation) before we
// could save the mapping locally, so a naive create-every-time would hit
// Channex's "Duplication in Room Type title is not allowed" error on retry.
async function createRoomType(channexPropertyId, unit) {
  const existing = await request('GET', `/room_types?filter[property_id]=${encodeURIComponent(channexPropertyId)}`);
  const match = (existing.data || []).find(rt => rt.attributes?.title === unit.name);
  if (match) return { id: match.id, ...match.attributes };

  const data = await request('POST', '/room_types', {
    room_type: {
      property_id: channexPropertyId,
      title: unit.name,
      count_of_rooms: 1,
      occ_adults: unit.max_guests || 2,
      occ_children: 0,
      occ_infants: 0,
    },
  });
  return data.data;
}

async function createRatePlan(channexPropertyId, channexRoomTypeId, ratePlan) {
  const data = await request('POST', '/rate_plans', {
    rate_plan: {
      property_id: channexPropertyId,
      room_type_id: channexRoomTypeId,
      title: ratePlan.name,
      currency: 'IDR',
      sell_mode: 'per_room',
      rate_mode: 'manual',
      options: [{ occupancy: 1, is_primary: true, rate: 0 }],
    },
  });
  return data.data;
}

// ── ARI push ─────────────────────────────────────────────────

async function pushAvailability(channexPropertyId, channexRoomTypeId, values) {
  // values: [{ date, availability }]
  return request('POST', '/availability', {
    values: values.map(v => ({
      property_id: channexPropertyId,
      room_type_id: channexRoomTypeId,
      date: v.date,
      availability: v.availability,
    })),
  });
}

async function pushRates(channexPropertyId, channexRatePlanId, values) {
  // values: [{ date, rate }]. Channex accepts rate either as a decimal
  // string ("5000.00") or an integer in the currency's minor unit (cents-
  // equivalent — so a raw integer 500000 is read as 5000.00, not 500000.00).
  // Sending a decimal string avoids that ambiguity — confirmed live against
  // staging: an unformatted integer landed 100x too low.
  return request('POST', '/restrictions', {
    values: values.map(v => ({
      property_id: channexPropertyId,
      rate_plan_id: channexRatePlanId,
      date: v.date,
      rate: v.rate.toFixed(2),
    })),
  });
}

// ── Bookings (pull, inspect-only for this spike) ────────────

async function pullBookingRevisions(channexPropertyId) {
  const data = await request('GET', `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(channexPropertyId)}`);
  return data.data || [];
}

async function ackBookingRevision(revisionId) {
  return request('POST', `/booking_revisions/${encodeURIComponent(revisionId)}/ack`);
}

module.exports = {
  isConfigured,
  createProperty,
  createRoomType,
  createRatePlan,
  pushAvailability,
  pushRates,
  pullBookingRevisions,
  ackBookingRevision,
};
