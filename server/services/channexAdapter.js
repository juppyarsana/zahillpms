// Channex channel-manager adapter (migrations 060, 117; routes/channelManager.js). Deliberately vendor-specific and isolated
// behind a plain function interface (isConfigured/push*/pull*) so a future
// beds24Adapter.js or staahAdapter.js could implement the same shape without
// any caller (routes/channelManager.js) needing to change.
//
// Field names checked against Channex staging (2026-09-17 spike, 2026-10-20
// stage 1). CHANNEX_API_URL picks staging or production; one API key covers
// every property in that Channex account.

const http = require('http');
const https = require('https');

const BASE_URL = process.env.CHANNEX_API_URL || 'https://staging.channex.io/api/v1';

function isConfigured() {
  return !!process.env.CHANNEX_API_KEY;
}

// Every call goes out over ONE address family (IPv4 unless CHANNEX_IP_FAMILY=6):
// Channex counts booking-feed reads and acknowledgements by the address they
// come from, and a server with both IPv4 and IPv6 would otherwise mix them
// (certification test 11 ignored the calls from the "other" address).
const IP_FAMILY = process.env.CHANNEX_IP_FAMILY === '6' ? 6 : 4;
const TIMEOUT_MS = 60_000;

function request(method, path, body) {
  if (!isConfigured()) return Promise.reject(new Error('The channel manager is not configured (CHANNEX_API_KEY unset)'));
  const url = new URL(`${BASE_URL}${path}`);
  const payload = body ? JSON.stringify(body) : null;
  const lib = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method,
      family: IP_FAMILY,
      headers: {
        'Content-Type': 'application/json',
        'user-api-key': process.env.CHANNEX_API_KEY,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Channel manager ${method} ${path} failed (${res.statusCode}): ${JSON.stringify(data)}`));
        } else resolve(data);
      });
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Channel manager ${method} ${path} timed out`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Reading the account (setup screen) ───────────────────────

// Every page of a list endpoint (Channex pages at 100 at most).
async function listAll(path) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= 50; page++) {
    const data = await request('GET', `${path}${sep}pagination[page]=${page}&pagination[limit]=100`);
    const rows = data.data || [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

async function listProperties() {
  return (await listAll('/properties')).map(p => ({
    id: p.id, title: p.attributes?.title, currency: p.attributes?.currency, timezone: p.attributes?.timezone,
  }));
}

async function listRoomTypes(channexPropertyId) {
  return (await listAll(`/room_types?filter[property_id]=${encodeURIComponent(channexPropertyId)}`)).map(rt => ({
    id: rt.id, title: rt.attributes?.title, count_of_rooms: rt.attributes?.count_of_rooms,
    occ_adults: rt.attributes?.occ_adults,
  }));
}

async function listRatePlans(channexPropertyId) {
  return (await listAll(`/rate_plans?filter[property_id]=${encodeURIComponent(channexPropertyId)}`)).map(rp => ({
    id: rp.id, title: rp.attributes?.title, sell_mode: rp.attributes?.sell_mode,
    meal_type: rp.attributes?.meal_type, currency: rp.attributes?.currency,
    room_type_id: rp.relationships?.room_type?.data?.id || null,
    occupancy: (rp.attributes?.options || []).find(o => o.is_primary)?.occupancy ?? null,
  }));
}

// ── Setup: create / update ───────────────────────────────────

async function createProperty({ title, currency = 'IDR', timezone = 'Asia/Makassar' }) {
  const data = await request('POST', '/properties', { property: { title, currency, timezone } });
  return data.data; // Channex wraps responses as { data: {...} }
}

// A PMS room type → one Channex room type with `count` rooms.
async function createRoomType(channexPropertyId, { title, count, maxGuests }) {
  const data = await request('POST', '/room_types', {
    room_type: {
      property_id: channexPropertyId,
      title,
      count_of_rooms: count,
      occ_adults: maxGuests || 2,
      occ_children: 0,
      occ_infants: 0,
      default_occupancy: maxGuests || 2,
    },
  });
  return { id: data.data.id, ...data.data.attributes };
}

async function updateRoomType(channexRoomTypeId, { title, count, maxGuests }) {
  const room_type = {};
  if (title !== undefined) room_type.title = title;
  if (count !== undefined) room_type.count_of_rooms = count;
  if (maxGuests !== undefined) { room_type.occ_adults = maxGuests; room_type.default_occupancy = maxGuests; }
  const data = await request('PUT', `/room_types/${encodeURIComponent(channexRoomTypeId)}`, { room_type });
  return { id: data.data.id, ...data.data.attributes };
}

// A (room type, meal plan) pair → one Channex rate plan, sold per room at
// the room type's full occupancy (the price the PMS sends is for that many
// guests, meal plan included).
async function createRatePlan(channexPropertyId, channexRoomTypeId, { title, occupancy, mealType }) {
  const rate_plan = {
    property_id: channexPropertyId,
    room_type_id: channexRoomTypeId,
    title,
    currency: 'IDR',
    sell_mode: 'per_room',
    rate_mode: 'manual',
    options: [{ occupancy: occupancy || 2, is_primary: true, rate: 0 }],
  };
  if (mealType) rate_plan.meal_type = mealType;
  const data = await request('POST', '/rate_plans', { rate_plan });
  return { id: data.data.id, ...data.data.attributes };
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

// Stage 2 (services/channelSync.js): one request carrying many values, each
// a date range — kind 'availability' ({ room_type_id, date_from, date_to,
// availability }) or 'restrictions' ({ rate_plan_id, date_from, date_to,
// rate as a decimal string }). Both dates inclusive. One call carries every
// value (Channex certification: a full sync = 2 calls; 10 MB per call).
// Returns { warnings (values Channex did not take), taskIds }.
async function pushAri(kind, values) {
  if (!values.length) return { warnings: [], taskIds: [] };
  if (!['availability', 'restrictions'].includes(kind)) throw new Error(`Unknown ARI kind ${kind}`);
  const data = await request('POST', `/${kind}`, { values });
  return { warnings: data?.meta?.warnings || [], taskIds: (data?.data || []).filter(d => d.type === 'task').map(d => d.id) };
}

// What Channex holds for a date range (checking a send):
// { availability: { roomTypeId: { date: n } }, rates: { ratePlanId: { date: "123.00" } } }
async function readAri(channexPropertyId, dateFrom, dateTo) {
  const q = `filter[property_id]=${encodeURIComponent(channexPropertyId)}&filter[date][gte]=${dateFrom}&filter[date][lte]=${dateTo}`;
  const [avail, restr] = await Promise.all([
    request('GET', `/availability?${q}`),
    request('GET', `/restrictions?${q}&filter[restrictions]=rate`),
  ]);
  const rates = {};
  for (const [rp, days] of Object.entries(restr?.data || {})) {
    rates[rp] = Object.fromEntries(Object.entries(days).map(([d, v]) => [d, v.rate]));
  }
  return { availability: avail?.data || {}, rates };
}

// ── Bookings (pull, inspect-only for this spike) ────────────

// The revisions not acknowledged yet — for every property of the account in
// one call (Channex: don't read the feed property by property).
async function pullBookingRevisions() {
  const data = await request('GET', '/booking_revisions/feed');
  return data.data || [];
}

// One revision (the webhook names it).
async function getBookingRevision(revisionId) {
  const data = await request('GET', `/booking_revisions/${encodeURIComponent(revisionId)}`);
  return data.data || null;
}

async function ackBookingRevision(revisionId) {
  return request('POST', `/booking_revisions/${encodeURIComponent(revisionId)}/ack`);
}

// ── Webhook (migration 123): Channex calls the PMS when a booking comes in ──

async function listWebhooks(channexPropertyId) {
  return (await listAll(`/webhooks?filter[property_id]=${encodeURIComponent(channexPropertyId)}`))
    .map(w => ({ id: w.id, url: w.attributes?.callback_url, is_active: !!w.attributes?.is_active }));
}

async function createWebhook(channexPropertyId, callbackUrl) {
  const data = await request('POST', '/webhooks', { webhook: {
    property_id: channexPropertyId, callback_url: callbackUrl, event_mask: 'booking',
    request_params: {}, headers: {}, is_active: true, send_data: false,
  } });
  return data.data?.id;
}

async function deleteWebhook(webhookId) {
  return request('DELETE', `/webhooks/${encodeURIComponent(webhookId)}`);
}

function environment() {
  return /staging/i.test(BASE_URL) ? 'staging' : 'production';
}

module.exports = {
  isConfigured,
  environment,
  listProperties,
  listRoomTypes,
  listRatePlans,
  createProperty,
  createRoomType,
  updateRoomType,
  createRatePlan,
  pushAvailability,
  pushRates,
  pushAri,
  readAri,
  pullBookingRevisions,
  getBookingRevision,
  ackBookingRevision,
  listWebhooks,
  createWebhook,
  deleteWebhook,
};
