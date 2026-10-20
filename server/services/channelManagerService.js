// Channel Manager — setup (stage 1, migration 117): which Channex property
// is this hotel, and which Channex room type / rate plan each PMS room type /
// meal plan is. The PMS is the source of truth for rooms: linking (or
// "Update in Channex") sets the Channex room type's room count and guests to
// the PMS's. Unlinking only forgets the link here — nothing is deleted in
// Channex (an OTA may be mapped to it there).

const db = require('../db');
const channex = require('./channexAdapter');

const PROVIDER = 'channex';

function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// Channex's meal_type for a PMS meal plan.
function mealTypeFor(plan) {
  const b = !!plan.includes_breakfast, l = !!plan.includes_lunch, d = !!plan.includes_dinner;
  if (b && l && d) return 'full_board';
  if (b && d) return 'half_board';
  if (b) return 'breakfast';
  if (!b && !l && !d) return 'room_only';
  return 'none';
}

async function linkedPropertyId(propertyId, client = db) {
  const { rows: [p] } = await client.query('SELECT channex_property_id FROM properties WHERE id = $1', [propertyId]);
  return p?.channex_property_id || null;
}

async function pmsRoomTypes(propertyId, client = db) {
  const { rows } = await client.query(`
    SELECT rt.id, rt.name, rt.max_guests, rt.base_rate, rt.sort_order,
           (SELECT count(*)::int FROM units u WHERE u.room_type_id = rt.id AND u.property_id = rt.property_id) AS rooms
    FROM room_types rt
    WHERE rt.property_id = $1
    ORDER BY rt.sort_order, rt.name
  `, [propertyId]);
  return rows;
}

async function pmsRatePlans(propertyId, client = db) {
  const { rows } = await client.query(
    `SELECT id, code, name, includes_breakfast, includes_lunch, includes_dinner, is_active, is_default
     FROM rate_plans WHERE property_id = $1 ORDER BY sort_order, code`, [propertyId]);
  return rows;
}

// Everything the setup screen shows. Channex is read live; when it can't be
// reached the PMS side is still returned with `channex_error`.
async function getSetup(propertyId) {
  const out = {
    configured: channex.isConfigured(),
    environment: channex.environment(),
    property: null,
    channex_properties: [],
    room_types: [],
    channex_room_types: [],
    channex_rate_plans: [],
    channex_error: null,
  };
  const [roomTypes, ratePlans, externalId] = await Promise.all([
    pmsRoomTypes(propertyId), pmsRatePlans(propertyId), linkedPropertyId(propertyId),
  ]);
  const { rows: rtLinks } = await db.query(
    'SELECT room_type_id, external_room_type_id FROM channel_room_types WHERE property_id = $1 AND provider = $2', [propertyId, PROVIDER]);
  const { rows: rpLinks } = await db.query(
    'SELECT room_type_id, rate_plan_id, external_rate_plan_id FROM channel_rate_plans WHERE property_id = $1 AND provider = $2', [propertyId, PROVIDER]);

  let cxRoomTypes = [], cxRatePlans = [], cxProperty = null;
  if (out.configured) {
    try {
      const props = await channex.listProperties();
      if (externalId) {
        cxProperty = props.find(p => p.id === externalId) || null;
        if (cxProperty) {
          [cxRoomTypes, cxRatePlans] = await Promise.all([channex.listRoomTypes(externalId), channex.listRatePlans(externalId)]);
        }
      }
      // Properties another PMS property already uses are not offered.
      const { rows: taken } = await db.query(
        'SELECT channex_property_id FROM properties WHERE channex_property_id IS NOT NULL AND id <> $1', [propertyId]);
      const takenIds = new Set(taken.map(t => t.channex_property_id));
      out.channex_properties = props.filter(p => !takenIds.has(p.id));
    } catch (err) {
      out.channex_error = err.message;
    }
  }

  out.property = externalId
    ? { external_id: externalId, title: cxProperty?.title || null, currency: cxProperty?.currency || null,
        found: out.channex_error ? null : !!cxProperty }
    : null;

  const rtById = new Map(cxRoomTypes.map(r => [r.id, r]));
  const rpById = new Map(cxRatePlans.map(r => [r.id, r]));
  const linkedRt = new Set(rtLinks.map(l => l.external_room_type_id));
  const linkedRp = new Set(rpLinks.map(l => l.external_rate_plan_id));

  out.room_types = roomTypes.map(rt => {
    const link = rtLinks.find(l => l.room_type_id === rt.id);
    const cx = link ? rtById.get(link.external_room_type_id) : null;
    return {
      id: rt.id, name: rt.name, rooms: rt.rooms, max_guests: rt.max_guests,
      link: link ? {
        external_id: link.external_room_type_id,
        title: cx?.title || null,
        count_of_rooms: cx?.count_of_rooms ?? null,
        occ_adults: cx?.occ_adults ?? null,
        found: out.channex_error || !cxProperty ? null : !!cx,
        differs: !!cx && (cx.count_of_rooms !== rt.rooms || cx.occ_adults !== rt.max_guests),
      } : null,
      rate_plans: ratePlans.filter(p => p.is_active || rpLinks.some(l => l.room_type_id === rt.id && l.rate_plan_id === p.id)).map(p => {
        const l = rpLinks.find(x => x.room_type_id === rt.id && x.rate_plan_id === p.id);
        const cxp = l ? rpById.get(l.external_rate_plan_id) : null;
        return {
          id: p.id, code: p.code, name: p.name, is_active: p.is_active, meal_type: mealTypeFor(p),
          link: l ? { external_id: l.external_rate_plan_id, title: cxp?.title || null,
                      found: out.channex_error || !cxProperty ? null : !!cxp } : null,
        };
      }),
    };
  });
  out.channex_room_types = cxRoomTypes.map(r => ({ ...r, linked: linkedRt.has(r.id) }));
  out.channex_rate_plans = cxRatePlans.map(r => ({ ...r, linked: linkedRp.has(r.id) }));
  return out;
}

function requireConfigured() {
  if (!channex.isConfigured()) throw httpError(400, 'Channex is not set up on this server (CHANNEX_API_KEY is missing)', 'NOT_CONFIGURED');
}

// { external_id } links an existing Channex property; { create: true } makes
// one named after the hotel.
async function linkProperty(propertyId, { external_id, create }) {
  requireConfigured();
  const current = await linkedPropertyId(propertyId);
  const { rows: [{ n }] } = await db.query(
    'SELECT count(*)::int AS n FROM channel_room_types WHERE property_id = $1 AND provider = $2', [propertyId, PROVIDER]);
  if (current && n > 0) {
    throw httpError(409, 'Unlink every room type first — they belong to the Channex property linked now', 'HAS_ROOM_TYPES');
  }

  let target;
  if (create) {
    const { rows: [p] } = await db.query(`
      SELECT COALESCE(NULLIF(ps.property_name, ''), p.name) AS name
      FROM properties p LEFT JOIN property_settings ps ON ps.property_id = p.id WHERE p.id = $1`, [propertyId]);
    const made = await channex.createProperty({ title: p.name });
    target = made.id;
  } else {
    if (!external_id) throw httpError(400, 'Choose a Channex property');
    const props = await channex.listProperties();
    const found = props.find(p => p.id === external_id);
    if (!found) throw httpError(404, 'That Channex property is not in this Channex account');
    if (found.currency && found.currency !== 'IDR') {
      throw httpError(400, `That Channex property uses ${found.currency} — the PMS sends prices in IDR`, 'CURRENCY');
    }
    target = external_id;
  }
  const { rows: [other] } = await db.query(
    'SELECT name FROM properties WHERE channex_property_id = $1 AND id <> $2', [target, propertyId]);
  if (other) throw httpError(409, `That Channex property is already linked to ${other.name}`, 'TAKEN');

  await db.query('UPDATE properties SET channex_property_id = $1 WHERE id = $2', [target, propertyId]);
  return target;
}

async function unlinkProperty(propertyId) {
  const { rows: [{ n }] } = await db.query(
    'SELECT count(*)::int AS n FROM channel_room_types WHERE property_id = $1 AND provider = $2', [propertyId, PROVIDER]);
  if (n > 0) throw httpError(409, 'Unlink every room type first', 'HAS_ROOM_TYPES');
  await db.query('UPDATE properties SET channex_property_id = NULL WHERE id = $1', [propertyId]);
}

async function loadRoomType(propertyId, roomTypeId) {
  const rt = (await pmsRoomTypes(propertyId)).find(r => r.id === roomTypeId);
  if (!rt) throw httpError(404, 'Room type not found');
  return rt;
}

async function requireLinkedProperty(propertyId) {
  const external = await linkedPropertyId(propertyId);
  if (!external) throw httpError(400, 'Link the Channex property first', 'NO_PROPERTY');
  return external;
}

// { external_id } links an existing Channex room type (its room count and
// guests are then set to the PMS's); { create: true } makes a new one.
async function linkRoomType(propertyId, roomTypeId, { external_id, create }) {
  requireConfigured();
  const cxProperty = await requireLinkedProperty(propertyId);
  const rt = await loadRoomType(propertyId, roomTypeId);
  if (rt.rooms < 1) throw httpError(400, `${rt.name} has no rooms`, 'NO_ROOMS');

  const { rows: [existing] } = await db.query(
    'SELECT external_room_type_id FROM channel_room_types WHERE property_id = $1 AND provider = $2 AND room_type_id = $3',
    [propertyId, PROVIDER, roomTypeId]);
  if (existing) throw httpError(409, `${rt.name} is already linked — unlink it first`, 'ALREADY_LINKED');

  let externalId;
  if (create) {
    const cxTypes = await channex.listRoomTypes(cxProperty);
    if (cxTypes.some(t => (t.title || '').trim().toLowerCase() === rt.name.trim().toLowerCase())) {
      throw httpError(409, `Channex already has a room type called "${rt.name}" — link that one instead`, 'TITLE_EXISTS');
    }
    const made = await channex.createRoomType(cxProperty, { title: rt.name, count: rt.rooms, maxGuests: rt.max_guests });
    externalId = made.id;
  } else {
    if (!external_id) throw httpError(400, 'Choose a Channex room type');
    const cxTypes = await channex.listRoomTypes(cxProperty);
    if (!cxTypes.some(t => t.id === external_id)) throw httpError(404, 'That room type is not in the linked Channex property');
    const { rows: [taken] } = await db.query(`
      SELECT rt.name FROM channel_room_types c JOIN room_types rt ON rt.id = c.room_type_id
      WHERE c.property_id = $1 AND c.provider = $2 AND c.external_room_type_id = $3`, [propertyId, PROVIDER, external_id]);
    if (taken) throw httpError(409, `That Channex room type is already linked to ${taken.name}`, 'TAKEN');
    await channex.updateRoomType(external_id, { count: rt.rooms, maxGuests: rt.max_guests });
    externalId = external_id;
  }
  await db.query(
    `INSERT INTO channel_room_types (property_id, provider, room_type_id, external_room_type_id) VALUES ($1, $2, $3, $4)`,
    [propertyId, PROVIDER, roomTypeId, externalId]);
  return externalId;
}

// Sets the Channex room type's room count and guests to the PMS's again
// (after rooms were added / removed or max guests changed).
async function refreshRoomType(propertyId, roomTypeId) {
  requireConfigured();
  const rt = await loadRoomType(propertyId, roomTypeId);
  const { rows: [link] } = await db.query(
    'SELECT external_room_type_id FROM channel_room_types WHERE property_id = $1 AND provider = $2 AND room_type_id = $3',
    [propertyId, PROVIDER, roomTypeId]);
  if (!link) throw httpError(400, `${rt.name} is not linked`, 'NOT_LINKED');
  await channex.updateRoomType(link.external_room_type_id, { count: rt.rooms, maxGuests: rt.max_guests });
}

async function unlinkRoomType(propertyId, roomTypeId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_rate_plans WHERE property_id = $1 AND provider = $2 AND room_type_id = $3',
      [propertyId, PROVIDER, roomTypeId]);
    const { rowCount } = await client.query(
      'DELETE FROM channel_room_types WHERE property_id = $1 AND provider = $2 AND room_type_id = $3',
      [propertyId, PROVIDER, roomTypeId]);
    await client.query('COMMIT');
    if (!rowCount) throw httpError(404, 'That room type is not linked');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// { external_id } links an existing Channex rate plan of that room type;
// { create: true } makes one (per room, at the room type's max guests).
async function linkRatePlan(propertyId, roomTypeId, ratePlanId, { external_id, create }) {
  requireConfigured();
  const cxProperty = await requireLinkedProperty(propertyId);
  const rt = await loadRoomType(propertyId, roomTypeId);
  const plan = (await pmsRatePlans(propertyId)).find(p => p.id === ratePlanId);
  if (!plan) throw httpError(404, 'Meal plan not found');
  const { rows: [rtLink] } = await db.query(
    'SELECT external_room_type_id FROM channel_room_types WHERE property_id = $1 AND provider = $2 AND room_type_id = $3',
    [propertyId, PROVIDER, roomTypeId]);
  if (!rtLink) throw httpError(400, `Link ${rt.name} first`, 'NOT_LINKED');
  const { rows: [existing] } = await db.query(
    'SELECT 1 FROM channel_rate_plans WHERE property_id = $1 AND provider = $2 AND room_type_id = $3 AND rate_plan_id = $4',
    [propertyId, PROVIDER, roomTypeId, ratePlanId]);
  if (existing) throw httpError(409, `${plan.name} is already linked for ${rt.name}`, 'ALREADY_LINKED');

  let externalId;
  const cxPlans = (await channex.listRatePlans(cxProperty)).filter(p => p.room_type_id === rtLink.external_room_type_id);
  if (create) {
    const made = await channex.createRatePlan(cxProperty, rtLink.external_room_type_id, {
      title: plan.name, occupancy: rt.max_guests, mealType: mealTypeFor(plan),
    });
    externalId = made.id;
  } else {
    if (!external_id) throw httpError(400, 'Choose a Channex rate plan');
    const found = cxPlans.find(p => p.id === external_id);
    if (!found) throw httpError(404, `That rate plan is not one of ${rt.name}'s in Channex`);
    if (found.currency && found.currency !== 'IDR') throw httpError(400, `That rate plan is in ${found.currency}`, 'CURRENCY');
    const { rows: [taken] } = await db.query(
      'SELECT 1 FROM channel_rate_plans WHERE property_id = $1 AND provider = $2 AND external_rate_plan_id = $3',
      [propertyId, PROVIDER, external_id]);
    if (taken) throw httpError(409, 'That Channex rate plan is already linked', 'TAKEN');
    externalId = external_id;
  }
  await db.query(
    `INSERT INTO channel_rate_plans (property_id, provider, room_type_id, rate_plan_id, external_rate_plan_id)
     VALUES ($1, $2, $3, $4, $5)`, [propertyId, PROVIDER, roomTypeId, ratePlanId, externalId]);
  return externalId;
}

async function unlinkRatePlan(propertyId, roomTypeId, ratePlanId) {
  const { rowCount } = await db.query(
    'DELETE FROM channel_rate_plans WHERE property_id = $1 AND provider = $2 AND room_type_id = $3 AND rate_plan_id = $4',
    [propertyId, PROVIDER, roomTypeId, ratePlanId]);
  if (!rowCount) throw httpError(404, 'That meal plan is not linked');
}

module.exports = {
  PROVIDER,
  mealTypeFor,
  getSetup,
  linkProperty,
  unlinkProperty,
  linkRoomType,
  refreshRoomType,
  unlinkRoomType,
  linkRatePlan,
  unlinkRatePlan,
};
