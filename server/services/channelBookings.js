// Channel Manager stage 3 (migration 121): OTA bookings in from Channex.
//
// Every minute (and on "Check now") the PMS reads Channex's booking feed for
// each linked property — the revisions not confirmed yet — and handles them
// in order, each in its own transaction:
//
//   new        → a PMS booking per room (a group when 2+ rooms, paid room by
//                room): the first free room of the linked room type for its
//                dates, the guest (matched by e-mail + name, or new), the OTA
//                as the source (made if missing, Publish Rate off), the price
//                Channex reports (night by night when they differ), the meal
//                plan linked to the rate plan, adults / children, the OTA's
//                notes as special requests. To check points: the room was
//                picked automatically, who collects the money when the hotel
//                does. No deposit; `payment_collect` says who collects.
//   modified   → the same rooms changed to match: dates, room type (another
//                free room of it when needed), meal plan, guests, price; a
//                room added is booked, a room gone is cancelled.
//   cancelled  → its bookings cancelled (folio nights voided), money already
//                received flagged.
//
// Anything the PMS can't do safely is NOT guessed: no free room, a guest
// already checked in, a currency other than IDR, an unlinked room type, or a
// change to a reservation FO entered by hand. Those are saved as "attention"
// (listed on the Channel Manager page and sent on Telegram) and FO acts.
//
// A revision is confirmed (acked) to Channex only after its row in
// channel_revisions is saved. One that fails with an error is not confirmed
// and is tried again on the next read.
const db = require('../db');
const channex = require('./channexAdapter');
const { occupiedUntilSql } = require('./occupancySql');
const bookingCreate = require('./bookingCreateService');
const { applyBookingPrice } = require('./bookingPriceService');
const roomCharge = require('./roomChargeService');
const nightRatesSvc = require('./nightRates');
const ratePlanService = require('./ratePlanService');
const telegramService = require('./telegramService');
const { stayNights: stayNightList } = require('./folioService');
const health = require('./channelHealth');
const { recomputeBookingStatus } = require('./paymentStatusService');

const PROVIDER = 'channex';
const PULL_MS = 60_000;
const OPEN = ['pending', 'deposit_paid', 'confirmed'];

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtDay = ymd => { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
const span = (ci, co) => `${fmtDay(ci)} – ${fmtDay(co)}`;
const ymd = v => String(v || '').slice(0, 10);

// ── Reading a revision ───────────────────────────────────────

function parseRevision(raw) {
  const a = raw.attributes || raw;
  const cust = a.customer || {};
  return {
    revisionId: a.id || raw.id,
    bookingId: a.booking_id,
    status: a.status,
    ota: (a.ota_name || '').trim() || 'Channel manager',
    code: a.ota_reservation_code || a.unique_id || '',
    currency: a.currency || 'IDR',
    collect: a.payment_collect === 'property' ? 'property' : a.payment_collect === 'ota' ? 'ota' : null,
    paymentType: a.payment_type || null,
    notes: (a.notes || '').trim(),
    arrivalHour: a.arrival_hour || null,
    arrival: a.arrival_date, departure: a.departure_date,
    customer: {
      name: [cust.name, cust.surname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      mail: (cust.mail || '').trim(), phone: (cust.phone || '').trim(), country: cust.country || null,
      address: [cust.address, cust.city, cust.zip].filter(Boolean).join(', ') || null,
    },
    rooms: (a.rooms || []).map(r => {
      const days = Object.entries(r.days || {}).map(([date, v]) => ({ date, amount: Number(v) })).sort((x, y) => (x.date < y.date ? -1 : 1));
      const amount = Number(r.amount);
      return {
        id: r.booking_room_id, roomType: r.room_type_id, ratePlan: r.rate_plan_id,
        ci: r.checkin_date, co: r.checkout_date,
        amount: Number.isFinite(amount) && amount > 0 ? amount : days.reduce((s, d) => s + d.amount, 0),
        days,
        adults: Math.max(1, parseInt(r.occupancy?.adults, 10) || 1),
        children: Math.min(20, Math.max(0, parseInt(r.occupancy?.children, 10) || 0)),
        cancelled: !!r.is_cancelled,
      };
    }),
  };
}

// The OTA's own night prices, when they differ night by night.
function nightPricesOf(room) {
  const nights = stayNightList(room.ci, room.co);
  if (nights.length < 2 || room.days.length !== nights.length) return null;
  if (!room.days.every((d, i) => d.date === nights[i])) return null;
  if (new Set(room.days.map(d => Math.round(d.amount))).size < 2) return null;
  return room.days.map(d => ({ date: d.date, amount: d.amount }));
}

// ── Lookups ──────────────────────────────────────────────────

async function links(client, propertyId) {
  const [{ rows: rts }, { rows: rps }] = await Promise.all([
    client.query(`SELECT c.room_type_id, c.external_room_type_id, rt.name FROM channel_room_types c JOIN room_types rt ON rt.id = c.room_type_id
                   WHERE c.property_id = $1 AND c.provider = $2`, [propertyId, PROVIDER]),
    client.query(`SELECT c.room_type_id, c.rate_plan_id, c.external_rate_plan_id, rp.name FROM channel_rate_plans c JOIN rate_plans rp ON rp.id = c.rate_plan_id
                   WHERE c.property_id = $1 AND c.provider = $2`, [propertyId, PROVIDER]),
  ]);
  return {
    roomType: ext => rts.find(r => r.external_room_type_id === ext) || null,
    ratePlan: ext => rps.find(r => r.external_rate_plan_id === ext) || null,
  };
}

// The first free room of a type for [ci, co): not booked (every booking but
// cancelled / no-show, the occupiedUntilSql rule), not out of order for the
// stay, not already picked for this reservation. `exclude` = bookings that
// don't count (the booking being moved).
async function freeUnit(client, propertyId, roomTypeId, ci, co, { taken = [], exclude = [], prefer = null } = {}) {
  const { rows } = await client.query(`
    SELECT u.id, u.name FROM units u
     WHERE u.property_id = $1 AND u.room_type_id = $2
       AND NOT (u.id = ANY($5::uuid[]))
       AND NOT (u.status = 'out_of_order' AND (u.status_expected_back IS NULL OR u.status_expected_back > $3::date))
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
          WHERE b.unit_id = u.id AND b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
            AND NOT (b.id = ANY($6::uuid[]))
            AND b.check_in_date < $4::date AND ${occupiedUntilSql('b')} > $3::date)
     ORDER BY (u.id = $7::uuid) DESC, u.name
     LIMIT 1`, [propertyId, roomTypeId, ci, co, taken, exclude, prefer]);
  return rows[0] || null;
}

// OTA e-mail relays reach the guest only through the OTA — kept off the profile.
const RELAY = /(guest\.booking\.com|agoda-messaging|agoda\.com|expediapartnercentral|expedia\.com|airbnb\.com|traveloka\.com|tiket\.com|trip\.com|ctrip\.com)$/i;
const words = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1));
// Names shared by too many guests to say anything about who this is.
const COMMON_NAME_WORDS = new Set(['made', 'putu', 'wayan', 'gede', 'kadek', 'komang', 'nyoman', 'ketut', 'luh', 'ida', 'bagus', 'ayu',
  'gusti', 'agung', 'anak', 'ngurah', 'desak', 'dewa', 'dewi', 'siti', 'nur', 'muhammad', 'mohammad', 'mohamad', 'ahmad', 'mrs', 'miss']);
const longWords = s => [...words(s)].filter(w => w.length > 2);
// Good enough to treat two names as one guest: the same words, or two shared
// words, not counting the common ones. "Made Sudarsa" is not "Made Wirawan".
function sameName(a, b) {
  const A = longWords(a), B = longWords(b);
  if (A.length >= 2 && A.length === B.length && A.every(w => B.includes(w))) return true;
  const X = A.filter(w => !COMMON_NAME_WORDS.has(w)), Y = B.filter(w => !COMMON_NAME_WORDS.has(w));
  const shared = X.filter(w => Y.includes(w)).length;
  return shared >= 2 || (shared > 0 && shared === X.length && shared === Y.length);
}
function nationalityOf(country) {
  if (!country || !/^[A-Z]{2}$/i.test(country)) return null;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(country.toUpperCase()) || null; } catch { return null; }
}

async function guestFor(client, propertyId, cust) {
  const name = cust.name || 'Guest';
  const email = cust.mail && !RELAY.test(cust.mail) ? cust.mail.toLowerCase() : null;
  if (email) {
    const { rows } = await client.query('SELECT id, name FROM guests WHERE property_id = $1 AND lower(email) = $2 ORDER BY created_at', [propertyId, email]);
    const mine = words(name);
    const hit = rows.find(g => [...words(g.name)].some(w => mine.has(w)));
    if (hit) return { id: hit.id, name: hit.name, matched: true };
  }
  const { rows: [g] } = await client.query(
    `INSERT INTO guests (name, nationality, whatsapp, email, address, property_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name`,
    [name.slice(0, 200), nationalityOf(cust.country), cust.phone || null, email, cust.address, propertyId]);
  return { id: g.id, name: g.name, matched: false };
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SOURCE_ALIAS = { bookingcom: 'booking_com', tiketcom: 'tiket_com', tripcom: 'ctrip', expediacom: 'expedia' };
async function sourceFor(client, propertyId, ota) {
  const n = norm(ota);
  const { rows } = await client.query('SELECT id, label FROM booking_sources WHERE property_id = $1', [propertyId]);
  const hit = rows.find(s => norm(s.id) === n || norm(s.label) === n || s.id === SOURCE_ALIAS[n]);
  if (hit) return hit.id;
  const id = (SOURCE_ALIAS[n] || n || 'channel').slice(0, 40);
  await client.query(
    `INSERT INTO booking_sources (id, label, is_ota, source_type, publish_rate, property_id) VALUES ($1, $2, true, 'ota', false, $3)`,
    [id, ota.slice(0, 100), propertyId]);
  return id;
}

// The OTA as the hotel names it: the label of its booking source (Channex
// sends e.g. "BookingCom" for the source "Booking.com"). Used for every text
// the PMS writes — notes, To check, alerts, the OTA bookings list.
async function otaLabel(propertyId, ota) {
  const n = norm(ota);
  if (!n) return ota;
  const { rows } = await db.query('SELECT id, label FROM booking_sources WHERE property_id = $1', [propertyId]);
  const hit = rows.find(s => norm(s.id) === n || norm(s.label) === n || s.id === SOURCE_ALIAS[n]);
  return hit?.label || ota;
}
// Same for rows saved before (r = channel_revisions alias).
const OTA_LABEL_SQL = `COALESCE((SELECT bs.label FROM booking_sources bs
   WHERE bs.property_id = r.property_id
     AND regexp_replace(lower(bs.label), '[^a-z0-9]', '', 'g') = regexp_replace(lower(r.ota_name), '[^a-z0-9]', '', 'g')
   LIMIT 1), r.ota_name)`;

async function note(client, bookingId, text) {
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, NULL)', [bookingId, text.slice(0, 1000)]);
}

// What a booking saves as who collects: the OTA's own answer, or — when it
// gives none — the hotel collects (the industry default, Channex's own
// reading of an empty value): front desk asks the guest rather than the hotel
// waiting for money no one will send. The To check point says to look.
const bookingCollect = r => r.collect || 'property';

function collectPoint(r) {
  if (r.collect === 'property') {
    return `Guest pays at the hotel (${r.ota}${r.paymentType ? ` · ${r.paymentType.replace(/_/g, ' ')}` : ''}) — collect the room price, it is not paid by ${r.ota}`;
  }
  if (!r.collect) return `${r.ota} did not say who collects the money, so the PMS treats the room as paid at the hotel — check the reservation on ${r.ota} and change it in Edit Details if ${r.ota} collects`;
  return null;
}

// ── Already in the PMS ───────────────────────────────────────

// For each room: a PMS booking of the same room type and the same dates, not
// linked to the channel manager yet, carrying the OTA's reservation code (in
// its notes) or the guest's name. [{ room, b }] for the rooms matched.
async function existingStays(client, propertyId, r, rooms, L) {
  const found = [];
  const code = String(r.code || '').trim();
  for (const room of rooms) {
    const type = L.roomType(room.roomType);
    if (!type) continue;
    const { rows } = await client.query(`
      SELECT b.id, b.reservation_group_id, b.payment_collect, b.total_amount, b.discount_amount,
             b.internal_notes, b.special_requests, u.name AS unit, g.name AS guest
        FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
       WHERE b.property_id = $1 AND u.room_type_id = $2 AND b.check_in_date = $3::date AND b.check_out_date = $4::date
         AND b.status NOT IN ('cancelled', 'no_show')
         AND NOT EXISTS (SELECT 1 FROM channel_booking_rooms cr WHERE cr.booking_id = b.id)
         AND NOT (b.id = ANY($5::uuid[]))
       ORDER BY u.name`, [propertyId, type.room_type_id, room.ci, room.co, found.map(f => f.b.id)]);
    const byCode = code.length >= 4 && rows.find(b => `${b.internal_notes || ''} ${b.special_requests || ''}`.includes(code));
    const byName = rows.find(b => sameName(b.guest, r.customer.name));
    const b = byCode || byName;
    if (b) found.push({ room, b, how: byCode ? 'reservation code' : 'guest name' });
  }
  return found;
}

async function linkExisting(client, propertyId, r, rooms, same) {
  const groups = [...new Set(same.map(s => s.b.reservation_group_id).filter(Boolean))];
  const { rows: [cb] } = await client.query(
    `INSERT INTO channel_bookings (property_id, provider, external_booking_id, ota_name, ota_code, status, payment_collect, reservation_group_id, last_revision_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (property_id, provider, external_booking_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
     RETURNING id`, [propertyId, PROVIDER, r.bookingId, r.ota, r.code, r.status, r.collect, groups.length === 1 ? groups[0] : null, r.revisionId]);
  for (const { room, b, how } of same) {
    await client.query('INSERT INTO channel_booking_rooms (channel_booking_id, external_room_id, booking_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [cb.id, room.id, b.id]);
    const price = Math.round(parseFloat(b.total_amount) - parseFloat(b.discount_amount || 0));
    const points = [`${r.ota} ${r.code} came through the channel manager and was matched to this booking (${how})${Math.abs(price - Math.round(room.amount)) >= 1 ? ` — ${r.ota} says ${fmtIDR(room.amount)}, the PMS has ${fmtIDR(price)}: check the price` : ''}`];
    if (!b.payment_collect) { const cp = collectPoint(r); if (cp) points.push(cp); }
    await client.query(
      `UPDATE bookings SET payment_collect = COALESCE(payment_collect, $2),
              to_check = COALESCE(to_check, '[]'::jsonb) || $3::jsonb, to_check_done_at = NULL, to_check_done_by = NULL
        WHERE id = $1`, [b.id, bookingCollect(r), JSON.stringify(points)]);
    await note(client, b.id, `Linked to ${r.ota} reservation ${r.code} (channel manager) — matched by ${how}; not booked again.`);
    await recomputeBookingStatus(client, b.id);
  }
  return {
    result: 'applied', bookingIds: same.map(s => s.b.id), channelBookingId: cb.id,
    message: `Already in the PMS — linked to ${same.map(s => `room ${s.b.unit}`).join(', ')} (${same[0].b.guest})`,
  };
}

// ── new ──────────────────────────────────────────────────────

async function createFromRevision(client, propertyId, r, L) {
  const rooms = r.rooms.filter(x => !x.cancelled);
  if (!rooms.length) return { result: 'ignored', message: 'No rooms in the reservation' };
  if (r.currency !== 'IDR') return { result: 'attention', message: `Price is in ${r.currency}, not IDR — enter this ${r.ota} booking by hand` };

  // Already in the PMS (typed in, or from the VHP import, before the OTA was
  // connected — Channex often sends an OTA's existing bookings when it is
  // connected)? Then link instead of booking twice.
  const same = await existingStays(client, propertyId, r, rooms, L);
  if (same.length === rooms.length) return linkExisting(client, propertyId, r, rooms, same);
  if (same.length) {
    return { result: 'attention', message: `Part of this ${r.ota} booking is already in the PMS (${same.map(s => `room ${s.b.unit}`).join(', ')}) and part is not — check it and enter the rest by hand` };
  }

  // Room type, meal plan and a free room for every room — or nothing.
  const defaultPlan = await ratePlanService.getDefaultRatePlan(propertyId);
  const picked = [];
  for (const room of rooms) {
    const type = L.roomType(room.roomType);
    if (!type) return { result: 'attention', message: `A room type of this booking is not linked in the PMS (channel manager room type ${room.roomType}) — enter it by hand and link the room type` };
    const plan = L.ratePlan(room.ratePlan);
    const unit = await freeUnit(client, propertyId, type.room_type_id, room.ci, room.co, { taken: picked.map(p => p.unit.id) });
    if (!unit) return { result: 'attention', message: `No free ${type.name} for ${span(room.ci, room.co)} — overbooked. Move a guest or call ${r.ota}, then enter the booking by hand` };
    picked.push({ room, type, plan, unit });
  }

  const guest = await guestFor(client, propertyId, r.customer);
  const source = await sourceFor(client, propertyId, r.ota);
  const special = [r.notes, r.arrivalHour ? `Arrival time (OTA): ${String(r.arrivalHour).slice(0, 5)}` : ''].filter(Boolean).join('\n') || null;
  const internal = `CM · ${r.ota} ${r.code}`.trim();
  const roomInput = p => ({
    unit_id: p.unit.id, check_in_date: p.room.ci, check_out_date: p.room.co,
    num_guests: p.room.adults, children: p.room.children,
    rate_plan_id: p.plan?.rate_plan_id || defaultPlan?.id || null,
    total_amount: p.room.amount, night_prices: nightPricesOf(p.room) || undefined,
  });

  let made;
  if (picked.length === 1) {
    made = await bookingCreate.createBooking(client, { propertyId, userId: null, input: {
      ...roomInput(picked[0]), guest_id: guest.id, source, deposit_amount: 0, special_requests: special, internal_notes: internal } });
    if (made.status) return { result: 'error', message: made.error.error || 'Booking not saved' };
    made = { group: null, bookings: [made.booking] };
  } else {
    const ci = picked.reduce((m, p) => (p.room.ci < m ? p.room.ci : m), picked[0].room.ci);
    const co = picked.reduce((m, p) => (p.room.co > m ? p.room.co : m), picked[0].room.co);
    made = await bookingCreate.createGroup(client, { propertyId, userId: null, input: {
      guest_id: guest.id, check_in_date: ci, check_out_date: co, source, special_requests: special, internal_notes: internal,
      group_billing: false, rooms: picked.map(roomInput) } });
    if (made.status) return { result: 'error', message: made.error.error || 'Booking not saved' };
  }

  const { rows: [cb] } = await client.query(
    `INSERT INTO channel_bookings (property_id, provider, external_booking_id, ota_name, ota_code, status, payment_collect, reservation_group_id, last_revision_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (property_id, provider, external_booking_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
     RETURNING id`, [propertyId, PROVIDER, r.bookingId, r.ota, r.code, r.status, r.collect, made.group?.id || null, r.revisionId]);

  const ids = [];
  for (const [i, p] of picked.entries()) {
    const b = made.bookings[i];
    ids.push(b.id);
    const points = [`Room picked automatically: ${p.unit.name} (${p.type.name}) — booked on ${r.ota}${r.code ? ` (${r.code})` : ''}`];
    const cp = collectPoint(r);
    if (cp) points.push(cp);
    if (!p.plan) points.push(`The ${r.ota} rate plan is not linked to a meal plan in the PMS — meal plan set to ${defaultPlan?.name || 'the default'}; check it`);
    if (!(p.room.amount > 0)) points.push(`No price came from ${r.ota} — set it with Edit Price`);
    await client.query('UPDATE bookings SET payment_collect = $2, to_check = $3::jsonb WHERE id = $1', [b.id, bookingCollect(r), JSON.stringify(points)]);
    await recomputeBookingStatus(client, b.id);
    await client.query('INSERT INTO channel_booking_rooms (channel_booking_id, external_room_id, booking_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [cb.id, p.room.id, b.id]);
    await note(client, b.id, `Booked on ${r.ota} via the channel manager (reservation ${r.code}${guest.matched ? '' : ', new guest'}). ${fmtIDR(p.room.amount)}, ${r.collect === 'property' ? 'the hotel collects' : r.collect === 'ota' ? `paid to ${r.ota}` : 'who collects not given — treated as paid at the hotel'}.`);
  }
  const rooms_ = picked.map(p => p.unit.name).join(', ');
  return {
    result: 'applied', bookingIds: ids, channelBookingId: cb.id,
    message: `Booked ${rooms_} · ${guest.name}${guest.matched ? '' : ' (new guest)'}`,
    alert: { title: `New ${r.ota} booking`, guest: guest.name, rooms: picked.map(p => p.unit.name), checkIn: picked[0].room.ci, checkOut: picked[picked.length - 1].room.co,
      guests: picked.reduce((s, p) => s + p.room.adults, 0), total: picked.reduce((s, p) => s + p.room.amount, 0),
      extra: r.collect === 'property' ? 'The hotel collects the payment' : r.collect === 'ota' ? `Paid to ${r.ota}` : null },
  };
}

// ── modified / cancelled ─────────────────────────────────────

async function cancelBooking(client, b, r, problems) {
  if (['cancelled', 'no_show'].includes(b.status)) return false;
  if (!OPEN.includes(b.status)) {
    problems.push(`Room ${b.unit_name}: cancelled on ${r.ota}, but the guest is ${b.status.replace('_', ' ')} — handle it by hand`);
    return false;
  }
  await client.query("UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [b.id]);
  await roomCharge.voidAll(client, b.id, null);
  await note(client, b.id, `Booking cancelled on ${r.ota} (channel manager, reservation ${r.code}).`);
  const { rows: [{ received }] } = await client.query(
    "SELECT COALESCE(SUM(amount), 0) AS received FROM payments WHERE booking_id = $1 AND status = 'received'", [b.id]);
  if (Number(received) >= 1) problems.push(`Room ${b.unit_name}: ${fmtIDR(received)} was received on this booking — refund it or keep it, by ${r.ota}'s cancellation terms`);
  return true;
}

async function closeGroupIfEmpty(client, groupId) {
  if (!groupId) return;
  const { rows: [{ n }] } = await client.query(
    "SELECT count(*)::int AS n FROM bookings WHERE reservation_group_id = $1 AND status NOT IN ('cancelled', 'no_show')", [groupId]);
  if (n === 0) await client.query("UPDATE reservation_groups SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [groupId]);
  else await require('../routes/bookings').syncGroupSpan(client, groupId);
}

// Bookings not linked to the channel manager that may be this reservation: its
// code in their notes on any dates, else a guest name word with the arrival
// within `days` days of the reservation's.
async function unlinkedStays(client, propertyId, r, days) {
  const code = String(r.code || '').trim();
  const usableCode = code.length >= 4 ? code : '';
  const dates = [r.arrival, ...r.rooms.map(x => x.ci)].filter(Boolean).sort();
  const { rows } = await client.query(`
    SELECT b.id, b.reservation_group_id, b.internal_notes, b.special_requests, u.name AS unit, g.name AS guest
      FROM bookings b JOIN units u ON u.id = b.unit_id JOIN guests g ON g.id = b.guest_id
     WHERE b.property_id = $1 AND b.status NOT IN ('cancelled', 'no_show')
       AND NOT EXISTS (SELECT 1 FROM channel_booking_rooms cr WHERE cr.booking_id = b.id)
       AND (b.check_in_date BETWEEN $2::date - $4::int AND $3::date + $4::int
            OR ($5 <> '' AND strpos(COALESCE(b.internal_notes, '') || ' ' || COALESCE(b.special_requests, ''), $5) > 0))
     ORDER BY u.name`, [propertyId, dates[0] || null, dates[dates.length - 1] || null, days, usableCode]);
  const byCode = usableCode ? rows.filter(b => `${b.internal_notes || ''} ${b.special_requests || ''}`.includes(usableCode)) : [];
  const mine = longWords(r.customer.name).filter(w => days === 0 || !COMMON_NAME_WORDS.has(w));
  const byName = byCode.length ? [] : rows.filter(b => longWords(b.guest).some(w => mine.includes(w)));
  return { byCode, byName };
}

// A reservation the channel manager never sent before. It may be in the PMS
// already, on other dates or under a similar name, so its dates must be held
// either way: with the code in its notes the booking itself moves; on a name
// alone they are booked as well and FO cancels the other if it is the same stay.
async function placeUnlinked(client, propertyId, r, L) {
  const rooms = r.rooms.filter(x => !x.cancelled);
  if ((await existingStays(client, propertyId, r, rooms, L)).length) return createFromRevision(client, propertyId, r, L);
  const changed = r.status === 'modified';
  const { byCode, byName } = await unlinkedStays(client, propertyId, r, changed ? 60 : 0);
  if (rooms.length && byCode.length === rooms.length) return moveByCode(client, propertyId, r, byCode, rooms, L);

  const earlier = byCode.length ? byCode : byName;
  const made = await createFromRevision(client, propertyId, r, L);
  if (!earlier.length || made.result === 'ignored') return made;

  const looksLike = earlier.map(b => `room ${b.unit} (${b.guest})`).join(', ');
  const to = rooms[0] ? ` ${changed ? 'to' : 'for'} ${span(rooms[0].ci, rooms[0].co)}` : '';
  const verb = changed ? 'Changed' : 'Booked';
  const booked = made.result === 'applied' && !!made.channelBookingId;
  for (const b of earlier) {
    await pointAt(client, b.id, `${verb} on ${r.ota}${to} (reservation ${r.code})? ${booked ? 'Those dates were booked separately. ' : ''}If this is the same stay, ${booked ? 'cancel this booking' : 'change this booking by hand'}`);
    await note(client, b.id, `${verb} on ${r.ota}: reservation ${r.code} (${r.customer.name})${to}. This booking may be the same stay, so it was flagged and left as it is.`);
  }
  if (!booked) {
    return { ...made, result: 'attention', bookingIds: earlier.map(b => b.id), message: `${made.message}. It may be the same stay as ${looksLike}` };
  }
  for (const id of made.bookingIds) await pointAt(client, id, `May be the same stay as ${looksLike}, which is still booked — cancel that one if so`);
  const message = `${verb} on ${r.ota} (${r.code})${to}: ${made.message}, so those dates are held. It may be the same stay as ${looksLike}, which is still booked and also holds its room — cancel it if so`;
  return {
    ...made, result: 'attention', message, bookingIds: [...made.bookingIds, ...earlier.map(b => b.id)],
    alert: { title: `${changed ? 'Booking changed on' : 'New booking on'} ${r.ota} — possible duplicate`, text: [r.code, message] },
  };
}

// The reservation's code is in these bookings' notes: link them and change them.
async function moveByCode(client, propertyId, r, stays, rooms, L) {
  const groups = [...new Set(stays.map(b => b.reservation_group_id).filter(Boolean))];
  const { rows: [cb] } = await client.query(
    `INSERT INTO channel_bookings (property_id, provider, external_booking_id, ota_name, ota_code, status, payment_collect, reservation_group_id, last_revision_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [propertyId, PROVIDER, r.bookingId, r.ota, r.code, r.status, r.collect, groups.length === 1 ? groups[0] : null, r.revisionId]);
  const left = [];
  for (const s of stays) left.push(await loadBooking(client, s.id));
  for (const room of rooms) {
    const typeId = L.roomType(room.roomType)?.room_type_id;
    const i = Math.max(left.findIndex(b => b.unit_room_type_id === typeId), 0);
    const [b] = left.splice(i, 1);
    await client.query('INSERT INTO channel_booking_rooms (channel_booking_id, external_room_id, booking_id) VALUES ($1, $2, $3)', [cb.id, room.id, b.id]);
    await client.query('UPDATE bookings SET payment_collect = COALESCE(payment_collect, $2) WHERE id = $1', [b.id, bookingCollect(r)]);
    await recomputeBookingStatus(client, b.id);
    await pointAt(client, b.id, `${r.ota} ${r.code} came through the channel manager and was matched to this booking by reservation code; its changes now apply here`);
    await note(client, b.id, `Linked to ${r.ota} reservation ${r.code} (channel manager) — matched by reservation code.`);
  }
  const out = await applyChange(client, propertyId, r, cb, L);
  return { ...out, channelBookingId: cb.id, bookingIds: out.bookingIds || stays.map(b => b.id) };
}

function pointAt(client, bookingId, text) {
  return client.query(
    `UPDATE bookings SET to_check = COALESCE(to_check, '[]'::jsonb) || $2::jsonb, to_check_done_at = NULL, to_check_done_by = NULL WHERE id = $1`,
    [bookingId, JSON.stringify([text])]);
}

// A cancellation for a reservation the channel manager never sent before: the
// stay may still be in the PMS, typed by hand or imported. Its code in the notes
// is proof enough to cancel; a guest name arriving the same day only points at it.
async function cancelUnlinked(client, propertyId, r) {
  const { byCode, byName } = await unlinkedStays(client, propertyId, r, 0);

  const groups = [...new Set(byCode.map(b => b.reservation_group_id).filter(Boolean))];
  // Remembered, so a later revision of this reservation isn't booked automatically.
  const { rows: [cb] } = await client.query(
    `INSERT INTO channel_bookings (property_id, provider, external_booking_id, ota_name, ota_code, status, payment_collect, reservation_group_id, last_revision_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [propertyId, PROVIDER, r.bookingId, r.ota, r.code, r.status, r.collect, groups.length === 1 ? groups[0] : null, r.revisionId]);

  const addPoints = (id, points) => client.query(
    `UPDATE bookings SET to_check = COALESCE(to_check, '[]'::jsonb) || $2::jsonb, to_check_done_at = NULL, to_check_done_by = NULL WHERE id = $1`,
    [id, JSON.stringify(points)]);

  if (byCode.length) {
    const problems = [], changes = [];
    for (const { id } of byCode) {
      const b = await loadBooking(client, id);
      if (await cancelBooking(client, b, r, problems)) changes.push(`room ${b.unit_name} cancelled`);
    }
    for (const g of groups) await closeGroupIfEmpty(client, g);
    if (problems.length) for (const { id } of byCode) await addPoints(id, problems.map(p => `${r.ota}: ${p}`));
    return {
      result: problems.length ? 'attention' : 'applied',
      message: [...changes, ...problems].join(' · '),
      bookingIds: byCode.map(b => b.id), channelBookingId: cb.id,
      alert: { title: `Booking cancelled on ${r.ota}`, text: [r.code, ...changes, ...problems.map(p => `⚠️ ${p}`)] },
    };
  }
  if (byName.length) {
    const looksLike = byName.map(b => `room ${b.unit} (${b.guest})`).join(', ');
    for (const b of byName) {
      await addPoints(b.id, [`Cancelled on ${r.ota} (reservation ${r.code})? The channel manager's cancellation matches this guest and arrival by name only — check, and cancel by hand if it is the same stay`]);
      await note(client, b.id, `${r.ota} cancelled reservation ${r.code} (${r.customer.name}); matched to this booking by name only, so it was not cancelled automatically.`);
    }
    return {
      result: 'attention', bookingIds: byName.map(b => b.id), channelBookingId: cb.id,
      message: `Cancelled on ${r.ota} (${r.code}). It looks like ${looksLike}, but the name is the only match, so it was not cancelled — check, and cancel it by hand if it is the same stay`,
    };
  }
  return {
    result: 'attention', channelBookingId: cb.id,
    message: `Cancelled on ${r.ota} (${r.code}). No matching booking found in the PMS — if this stay was typed in by hand, find it and cancel it`,
  };
}

async function loadBooking(client, id) {
  const { rows: [b] } = await client.query(
    `SELECT b.*, u.name AS unit_name, u.room_type_id AS unit_room_type_id,
            to_char(b.check_in_date, 'YYYY-MM-DD') AS ci, to_char(b.check_out_date, 'YYYY-MM-DD') AS co
       FROM bookings b JOIN units u ON u.id = b.unit_id WHERE b.id = $1`, [id]);
  return b || null;
}

// One room of a modified reservation → its booking changed to match.
async function changeRoom(client, propertyId, r, room, b, L, defaultPlan, problems, takenUnits) {
  const type = L.roomType(room.roomType);
  if (!type) { problems.push(`Room ${b.unit_name}: the new room type is not linked in the PMS — change it by hand`); return null; }
  const plan = L.ratePlan(room.ratePlan);
  const planId = plan?.rate_plan_id || b.rate_plan_id || defaultPlan?.id || null;
  const price = Math.round(parseFloat(b.total_amount) - parseFloat(b.discount_amount || 0));
  const diff = [];
  if (room.ci !== b.ci || room.co !== b.co) diff.push(`dates ${span(b.ci, b.co)} → ${span(room.ci, room.co)}`);
  if (type.room_type_id !== b.unit_room_type_id) diff.push(`room type → ${type.name}`);
  if (planId !== b.rate_plan_id) diff.push(`meal plan → ${plan?.name || 'default'}`);
  if (room.adults !== Number(b.num_guests)) diff.push(`adults ${b.num_guests} → ${room.adults}`);
  if (room.children !== Number(b.children || 0)) diff.push(`children ${b.children || 0} → ${room.children}`);
  if (Math.abs(Math.round(room.amount) - price) >= 1) diff.push(`price ${fmtIDR(price)} → ${fmtIDR(room.amount)}`);
  if (!diff.length) return null;

  if (!OPEN.includes(b.status)) {
    problems.push(`Room ${b.unit_name}: changed on ${r.ota} (${diff.join('; ')}) but the guest is ${b.status.replace('_', ' ')} — apply it by hand`);
    return null;
  }

  let unitId = b.unit_id, unitName = b.unit_name;
  if (room.ci !== b.ci || room.co !== b.co || type.room_type_id !== b.unit_room_type_id) {
    const unit = await freeUnit(client, propertyId, type.room_type_id, room.ci, room.co,
      { taken: takenUnits, exclude: [b.id], prefer: type.room_type_id === b.unit_room_type_id ? b.unit_id : null });
    if (!unit) {
      problems.push(`Room ${b.unit_name}: changed on ${r.ota} to ${type.name} ${span(room.ci, room.co)}, but no room is free — nothing changed, sort it out by hand`);
      return null;
    }
    if (unit.id !== b.unit_id) diff.push(`room ${b.unit_name} → ${unit.name}`);
    unitId = unit.id; unitName = unit.name;
  }
  takenUnits.push(unitId);

  await client.query(
    `UPDATE bookings SET unit_id = $2, check_in_date = $3, check_out_date = $4, num_guests = $5, children = $6::int,
            kids_free_breakfast = CASE WHEN $6::int > 0 THEN kids_free_breakfast ELSE false END, rate_plan_id = $7, updated_at = NOW()
      WHERE id = $1`, [b.id, unitId, room.ci, room.co, room.adults, room.children, planId]);
  const { rows: [fresh] } = await client.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
  const np = nightPricesOf(room);
  const parsed = np ? nightRatesSvc.parseNightPrices(np, stayNightList(room.ci, room.co)) : null;
  const priced = await applyBookingPrice(client, {
    propertyId, before: fresh, userId: null, newTotal: room.amount,
    keepDiscount: false, receivedWasTypo: false,
    balanceNote: `Changed on ${r.ota} — additional amount`,
    nightShares: parsed?.shares || null,
  });
  if (priced?.error) { problems.push(`Room ${unitName}: ${priced.error.error || 'price not saved'}`); throw new Error(priced.error.error || 'price not saved'); }
  await note(client, b.id, `Changed on ${r.ota} (channel manager, reservation ${r.code}): ${diff.join('; ')}.`);
  return { unitName, diff };
}

async function applyChange(client, propertyId, r, cb, L) {
  const { rows: mapped } = await client.query(
    'SELECT external_room_id, booking_id FROM channel_booking_rooms WHERE channel_booking_id = $1', [cb.id]);
  if (!mapped.length) {
    return { result: 'attention', message: `${r.status === 'cancelled' ? 'Cancelled' : 'Changed'} on ${r.ota} — this reservation was entered by hand earlier, so apply it by hand too` };
  }
  const problems = [], changes = [], touched = [];
  const defaultPlan = await ratePlanService.getDefaultRatePlan(propertyId);
  const byRoom = new Map(mapped.map(m => [m.external_room_id, m.booking_id]));
  const takenUnits = [];

  if (r.status === 'cancelled') {
    for (const m of mapped) {
      const b = m.booking_id && await loadBooking(client, m.booking_id);
      if (!b) continue;
      if (await cancelBooking(client, b, r, problems)) { changes.push(`room ${b.unit_name} cancelled`); touched.push(b.id); }
    }
  } else {
    if (r.currency !== 'IDR') return { result: 'attention', message: `Changed on ${r.ota}, price in ${r.currency} — apply it by hand` };
    // Channex may give a room a new id on a revision: rooms not matched by id
    // are paired with the reservation's other bookings — same room type
    // first, then in order — and the link moves to the new id.
    const loose = [];
    let activeMapped = 0;
    for (const m of mapped) { const b = m.booking_id && await loadBooking(client, m.booking_id); if (b && !['cancelled', 'no_show'].includes(b.status)) activeMapped++; }
    for (const m of mapped.filter(x => !r.rooms.some(room => room.id === x.external_room_id))) {
      const b = m.booking_id && await loadBooking(client, m.booking_id);
      if (b && !['cancelled', 'no_show'].includes(b.status)) loose.push({ m, b });
    }
    const pairUp = (room, sameType) => {
      const i = loose.findIndex(x => !sameType || x.b.unit_room_type_id === L.roomType(room.roomType)?.room_type_id);
      return i < 0 ? null : loose.splice(i, 1)[0];
    };
    const unmatched = r.rooms.filter(room => !byRoom.has(room.id) && !room.cancelled)
      .sort((a, b) => (a.ci < b.ci ? -1 : a.ci > b.ci ? 1 : 0));
    for (const pass of [true, false]) {
      const left = unmatched.filter(x => !byRoom.has(x.id));
      // Across room types only for a one-room reservation (its room type
      // changed); otherwise the old room is cancelled, the new one booked.
      if (!pass && !(r.rooms.filter(x => !x.cancelled).length === 1 && left.length === 1 && loose.length === 1 && activeMapped === 1)) break;
      for (const room of left) {
        const hit = pairUp(room, pass);
        if (!hit) continue;
        await client.query('UPDATE channel_booking_rooms SET external_room_id = $3 WHERE channel_booking_id = $1 AND external_room_id = $2',
          [cb.id, hit.m.external_room_id, room.id]);
        byRoom.delete(hit.m.external_room_id);
        byRoom.set(room.id, hit.m.booking_id);
        hit.m.external_room_id = room.id;
      }
    }
    for (const room of r.rooms) {
      const bookingId = byRoom.get(room.id);
      const b = bookingId && await loadBooking(client, bookingId);
      if (b && room.cancelled) {
        if (await cancelBooking(client, b, r, problems)) { changes.push(`room ${b.unit_name} cancelled`); touched.push(b.id); }
      } else if (b) {
        if (['cancelled', 'no_show'].includes(b.status)) { problems.push(`Room ${b.unit_name}: changed on ${r.ota} but the booking is ${b.status.replace('_', ' ')} in the PMS — check it`); continue; }
        const done = await changeRoom(client, propertyId, r, room, b, L, defaultPlan, problems, takenUnits);
        if (done) { changes.push(`room ${done.unitName}: ${done.diff.join('; ')}`); touched.push(b.id); }
        else takenUnits.push(b.unit_id);
      } else if (!room.cancelled && !bookingId) {
        // A room added to the reservation.
        const type = L.roomType(room.roomType);
        const unit = type && await freeUnit(client, propertyId, type.room_type_id, room.ci, room.co, { taken: takenUnits });
        if (!type || !unit) { problems.push(`A room was added on ${r.ota} (${type?.name || 'unlinked room type'} ${span(room.ci, room.co)}) but no room is free — enter it by hand`); continue; }
        takenUnits.push(unit.id);
        const { rows: [first] } = await client.query('SELECT guest_id, source, special_requests, internal_notes FROM bookings WHERE id = $1', [mapped[0].booking_id]);
        const plan = L.ratePlan(room.ratePlan);
        const made = await bookingCreate.createBooking(client, { propertyId, userId: null, input: {
          guest_id: first.guest_id, unit_id: unit.id, check_in_date: room.ci, check_out_date: room.co,
          num_guests: room.adults, children: room.children, rate_plan_id: plan?.rate_plan_id || defaultPlan?.id || null,
          total_amount: room.amount, night_prices: nightPricesOf(room) || undefined, deposit_amount: 0,
          source: first.source, special_requests: first.special_requests, internal_notes: first.internal_notes } });
        if (made.status) throw new Error(made.error.error || 'Room not saved');
        const points = [`Room picked automatically: ${unit.name} (${type.name}) — added on ${r.ota}${r.code ? ` (${r.code})` : ''}`];
        const cp = collectPoint(r); if (cp) points.push(cp);
        await client.query('UPDATE bookings SET payment_collect = $2, to_check = $3::jsonb, reservation_group_id = $4 WHERE id = $1',
          [made.booking.id, bookingCollect(r), JSON.stringify(points), cb.reservation_group_id]);
        await recomputeBookingStatus(client, made.booking.id);
        await client.query('INSERT INTO channel_booking_rooms (channel_booking_id, external_room_id, booking_id) VALUES ($1, $2, $3)', [cb.id, room.id, made.booking.id]);
        await note(client, made.booking.id, `Room added on ${r.ota} via the channel manager (reservation ${r.code}). ${fmtIDR(room.amount)}.`);
        changes.push(`room ${unit.name} added`); touched.push(made.booking.id);
      }
    }
    // Rooms no longer in the reservation.
    const present = new Set(r.rooms.map(x => x.id));
    for (const m of mapped.filter(x => !present.has(x.external_room_id))) {
      const b = m.booking_id && await loadBooking(client, m.booking_id);
      if (b && await cancelBooking(client, b, r, problems)) { changes.push(`room ${b.unit_name} removed`); touched.push(b.id); }
    }
    // Who collects may change (e.g. a virtual card added later).
    if (r.collect !== cb.payment_collect) {
      const ids = mapped.map(m => m.booking_id).filter(Boolean);
      await client.query('UPDATE bookings SET payment_collect = $2 WHERE id = ANY($1::uuid[])', [ids, bookingCollect(r)]);
      for (const id of ids) {
        await recomputeBookingStatus(client, id);
        await note(client, id, `${r.ota} changed who collects the money: ${r.collect === 'property' ? 'the hotel collects now' : r.collect === 'ota' ? `paid to ${r.ota} now` : 'not given — the hotel collects'} (channel manager, reservation ${r.code}).`);
      }
      const cp = collectPoint(r);
      if (cp) problems.push(cp);
      else changes.push(`paid to ${r.ota} now — nothing to collect from the guest`);
      touched.push(...ids);
    }
  }
  await closeGroupIfEmpty(client, cb.reservation_group_id);
  await client.query('UPDATE channel_bookings SET status = $2, payment_collect = $3, last_revision_id = $4, updated_at = NOW() WHERE id = $1',
    [cb.id, r.status, r.collect, r.revisionId]);

  // Problems also go on the bookings' To check list.
  if (problems.length) {
    for (const id of mapped.map(m => m.booking_id).filter(Boolean)) {
      await client.query(
        `UPDATE bookings SET to_check = COALESCE(to_check, '[]'::jsonb) || $2::jsonb, to_check_done_at = NULL, to_check_done_by = NULL WHERE id = $1`,
        [id, JSON.stringify(problems.map(p => `${r.ota}: ${p}`))]);
    }
  }
  const verb = r.status === 'cancelled' ? 'cancelled' : 'changed';
  return {
    result: problems.length ? 'attention' : changes.length ? 'applied' : 'ignored',
    message: [changes.length ? changes.join(' · ') : (problems.length ? '' : 'Nothing to change in the PMS'), ...problems].filter(Boolean).join(' · '),
    bookingIds: [...new Set([...touched, ...mapped.map(m => m.booking_id).filter(Boolean)])],
    channelBookingId: cb.id,
    alert: changes.length || problems.length ? { title: `Booking ${verb} on ${r.ota}`, text: [r.code, ...changes, ...problems.map(p => `⚠️ ${p}`)] } : null,
  };
}

// ── One revision ─────────────────────────────────────────────

async function processRevision(client, propertyId, r) {
  const L = await links(client, propertyId);
  const { rows: [cb] } = await client.query(
    'SELECT * FROM channel_bookings WHERE property_id = $1 AND provider = $2 AND external_booking_id = $3', [propertyId, PROVIDER, r.bookingId]);
  if (!cb) {
    if (r.status === 'cancelled') return cancelUnlinked(client, propertyId, r);
    const made = await placeUnlinked(client, propertyId, r, L);
    if (made.result === 'attention' && !made.channelBookingId) {
      // Remember the reservation, so its later changes aren't booked automatically either.
      const { rows: [row] } = await client.query(
        `INSERT INTO channel_bookings (property_id, provider, external_booking_id, ota_name, ota_code, status, payment_collect, last_revision_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [propertyId, PROVIDER, r.bookingId, r.ota, r.code, r.status, r.collect, r.revisionId]);
      made.channelBookingId = row.id;
    }
    return made;
  }
  return applyChange(client, propertyId, r, cb, L);
}

function alertText(r, out) {
  const h = telegramService.escapeHtml;
  const lines = [];
  if (out.result === 'attention' && !out.alert) {
    lines.push(`⚠️ <b>${h(r.ota)} booking needs you</b>`, `${h(r.customer.name || 'Guest')} · ${h(r.code)}`);
    if (r.rooms[0]) lines.push(`${h(span(r.rooms[0].ci, r.rooms[0].co))}`);
    lines.push('', h(out.message));
    return lines.join('\n');
  }
  const a = out.alert;
  if (a.text) return [`🌐 <b>${h(a.title)}</b>`, h(r.customer.name || ''), ...a.text.map(h)].filter(Boolean).join('\n');
  const nights = Math.round((Date.parse(a.checkOut) - Date.parse(a.checkIn)) / 86400000);
  return [`🌐 <b>${h(a.title)}</b>`, `<b>${h(a.guest)}</b>`, '',
    `🛏 ${h(a.rooms.join(', '))}`, `• ${h(span(a.checkIn, a.checkOut))} · ${nights} night${nights === 1 ? '' : 's'}`,
    `• ${a.guests} guest${a.guests === 1 ? '' : 's'}`, `• ${h(fmtIDR(a.total))}`, a.extra ? `• ${h(a.extra)}` : ''].filter(s => s !== '').join('\n');
}

async function saveRevisionRow(client, propertyId, r, raw, out) {
  await client.query(
    `INSERT INTO channel_revisions (property_id, provider, external_revision_id, external_booking_id, channel_booking_id, revision_status,
                                    ota_name, ota_code, guest_name, arrival, departure, result, message, booking_ids, raw, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
     ON CONFLICT (property_id, provider, external_revision_id) DO UPDATE SET
       result = EXCLUDED.result, message = EXCLUDED.message, booking_ids = EXCLUDED.booking_ids,
       channel_booking_id = EXCLUDED.channel_booking_id, processed_at = NOW(), tries = channel_revisions.tries + 1`,
    [propertyId, PROVIDER, r.revisionId, r.bookingId, out.channelBookingId || null, r.status, r.ota, r.code, r.customer.name || null,
     r.arrival || r.rooms[0]?.ci || null, r.departure || r.rooms[r.rooms.length - 1]?.co || null,
     out.result, (out.message || '').slice(0, 2000), out.bookingIds || null, JSON.stringify(raw)]);
}

// Returns true when the revision is done (saved and confirmed).
async function handleRevision(propertyId, raw) {
  const r = parseRevision(raw);
  r.ota = await otaLabel(propertyId, r.ota);
  const { rows: [seen] } = await db.query(
    'SELECT result, acked_at FROM channel_revisions WHERE property_id = $1 AND provider = $2 AND external_revision_id = $3', [propertyId, PROVIDER, r.revisionId]);
  if (seen && seen.result !== 'error') {
    if (!seen.acked_at) await ack(propertyId, r.revisionId);
    return true;
  }
  let client;
  try { client = await db.pool.connect(); }
  catch (err) { console.error('[CHANNEL BOOKINGS]', r.revisionId, 'no database:', err.message); return false; }   // not acknowledged — tried again
  let out;
  try {
    await client.query('BEGIN');
    out = await processRevision(client, propertyId, r);
    if (out.result === 'error') throw new Error(out.message);
    await saveRevisionRow(client, propertyId, r, raw, out);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    out = { result: 'error', message: err.message };
    await saveRevisionRow(db, propertyId, r, raw, out).catch(e => console.error('[CHANNEL BOOKINGS] save error row', e.message));
    if (!seen) {
      telegramService.sendAlert(propertyId, 'alert_new_booking',
        `⚠️ <b>${telegramService.escapeHtml(r.ota)} booking could not be saved</b>\n${telegramService.escapeHtml(r.customer.name || '')} · ${telegramService.escapeHtml(r.code)}\n\n${telegramService.escapeHtml(err.message)}\n\nThe PMS tries again every minute — see Settings → Channel Manager.`, { html: true }).catch(() => {});
    }
    console.error('[CHANNEL BOOKINGS]', r.revisionId, err.message);
    return false;
  } finally {
    client.release();
  }
  await ack(propertyId, r.revisionId);
  if (out.result !== 'ignored' && (out.alert || out.result === 'attention')) {
    telegramService.sendAlert(propertyId, 'alert_new_booking', alertText(r, out), { html: true }).catch(() => {});
  }
  return true;
}

async function ack(propertyId, revisionId) {
  try {
    await channex.ackBookingRevision(revisionId);
    await db.query('UPDATE channel_revisions SET acked_at = NOW() WHERE property_id = $1 AND provider = $2 AND external_revision_id = $3',
      [propertyId, PROVIDER, revisionId]);
  } catch (err) {
    console.error('[CHANNEL BOOKINGS] ack', revisionId, err.message);   // confirmed on a later read
  }
}

// ── Reading the feed ─────────────────────────────────────────
//
// Channex's rules (PMS certification): the feed is read in ONE call for every
// property of the account, not property by property; with the webhook on it
// is only the safety net (every 15 minutes), without it every minute. A
// revision is handled under its property's lock, so the webhook and a read
// never book the same revision twice.

const BACKUP_MS = 15 * 60_000;     // with a working webhook
const locks = new Map();
function withLock(propertyId, fn) {
  const prev = locks.get(propertyId) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(propertyId, run.catch(() => {}));
  return run;
}

// Linked properties with the module on: Channex property id → PMS property.
async function linkedProperties() {
  const { rows } = await db.query(`
    SELECT p.id, p.channex_property_id, s.webhook_id, s.last_webhook_at
      FROM properties p
      JOIN property_modules pm ON pm.property_id = p.id AND pm.module = 'channel_manager' AND pm.is_enabled = true
      LEFT JOIN channel_sync_state s ON s.property_id = p.id
     WHERE p.channex_property_id IS NOT NULL AND p.is_active = true`);
  return rows;
}

const revProperty = raw => (raw.attributes || raw).property_id || raw.relationships?.property?.data?.id || null;

let pulling = null;      // the read running now (a promise)
let again = false;       // something came in while reading — read once more after
let lastPullAt = 0;
let pullFails = 0;
let pullPausedUntil = 0;
let retrySoon = false;   // a revision failed to save — read again on the next minute, not in 15

async function readFeed() {
  const props = await linkedProperties();
  const byCx = new Map(props.map(p => [p.channex_property_id, p.id]));
  const counts = new Map(props.map(p => [p.id, { handled: 0, failed: 0 }]));
  try {
    for (let round = 0; round < 20 && props.length; round++) {
      const revs = await channex.pullBookingRevisions();
      if (!revs.length) break;
      let progressed = false;
      for (const rev of revs) {
        const pid = byCx.get(revProperty(rev));
        if (!pid) continue;   // a property not linked here (or module off) — left in the feed
        const done = await withLock(pid, () => handleRevision(pid, rev));
        const c = counts.get(pid);
        if (done) { c.handled++; progressed = true; } else c.failed++;
      }
      if (!progressed) break;   // only revisions that keep failing (or aren't ours) are left
    }
    lastPullAt = Date.now(); pullFails = 0; pullPausedUntil = 0;
    retrySoon = [...counts.values()].some(c => c.failed > 0);
    for (const p of props) {
      await db.query(
        `INSERT INTO channel_sync_state (property_id, last_pull_at, last_pull_error) VALUES ($1, NOW(), NULL)
         ON CONFLICT (property_id) DO UPDATE SET last_pull_at = NOW(), last_pull_error = NULL`, [p.id]);
      await health.recovered(p.id, 'pull').catch(() => {});
    }
    return counts;
  } catch (err) {
    // Back off: 1, 2, 4 … 15 minutes after failures in a row (also a 429).
    pullFails++;
    pullPausedUntil = Date.now() + Math.min(15, 2 ** (pullFails - 1)) * 60_000;
    for (const p of props) {
      await db.query(
        `INSERT INTO channel_sync_state (property_id, last_pull_error) VALUES ($1, $2)
         ON CONFLICT (property_id) DO UPDATE SET last_pull_error = $2`, [p.id, String(err.message).slice(0, 1000)]).catch(() => {});
      await health.failed(p.id, 'pull').catch(() => {});
    }
    throw err;
  }
}

// Read the feed now (one read at a time; a read asked for while one runs
// happens right after it).
async function pullAll() {
  if (pulling) { again = true; return pulling; }
  pulling = (async () => {
    try { return await readFeed(); }
    finally {
      pulling = null;
      if (again) { again = false; setTimeout(() => pullAll().catch(() => {}), 500); }
    }
  })();
  return pulling;
}

// Check now (a page) for one property: the same single read for everyone,
// this property's counts back.
async function pullProperty(propertyId) {
  const { rows: [p] } = await db.query('SELECT channex_property_id FROM properties WHERE id = $1', [propertyId]);
  if (!p?.channex_property_id) return { skipped: 'not linked' };
  if (pulling) { again = true; await pulling.catch(() => {}); }
  const counts = await pullAll();
  return counts?.get(propertyId) || { handled: 0, failed: 0 };
}

// The webhook: fetch the one revision Channex names and handle it; anything
// unexpected falls back to a read of the feed.
async function handleWebhook(propertyId, revisionId) {
  try {
    if (!revisionId) return void pullAll().catch(() => {});
    const { rows: [p] } = await db.query('SELECT channex_property_id FROM properties WHERE id = $1', [propertyId]);
    const rev = await channex.getBookingRevision(revisionId);
    if (!rev || !p || revProperty(rev) !== p.channex_property_id) return void pullAll().catch(() => {});
    const done = await withLock(propertyId, () => handleRevision(propertyId, rev));
    if (!done) retrySoon = true;   // not saved, not acknowledged — the next minute's read tries again
  } catch (err) {
    console.error('[CHANNEL BOOKINGS] webhook', propertyId, err.message);
    retrySoon = true;
    pullAll().catch(() => {});
  }
}

// Every minute: read when some linked property has no working webhook yet (a
// webhook counts once Channex has called it) or a revision failed to save,
// else every 15 minutes.
async function tick() {
  try {
    if (Date.now() < pullPausedUntil) return;
    const props = await linkedProperties();
    if (!props.length) return;
    const allInstant = props.every(p => p.webhook_id && p.last_webhook_at);
    if (allInstant && !retrySoon && Date.now() - lastPullAt < BACKUP_MS) return;
    await pullAll();
  } catch (err) {
    console.error('[CHANNEL BOOKINGS] read', err.message);
  }
}

let timer = null;
function start() {
  if (!channex.isConfigured() || timer) return;
  timer = setInterval(tick, PULL_MS);
  setTimeout(tick, 5000);
}

// For the Channel Manager page: open items first, then the latest.
async function list(propertyId, { limit = 30 } = {}) {
  const cols = `r.id, r.revision_status, ${OTA_LABEL_SQL} AS ota_name, r.ota_code, r.guest_name, to_char(r.arrival, 'YYYY-MM-DD') AS arrival,
                to_char(r.departure, 'YYYY-MM-DD') AS departure, r.result, r.message, r.booking_ids, r.tries,
                r.received_at, r.processed_at, r.acked_at, r.handled_at, hu.name AS handled_by_name`;
  const [{ rows: open }, { rows: recent }, { rows: [st] }] = await Promise.all([
    db.query(`SELECT ${cols} FROM channel_revisions r LEFT JOIN users hu ON hu.id = r.handled_by
               WHERE r.property_id = $1 AND r.result IN ('attention', 'error') AND r.handled_at IS NULL
               ORDER BY r.received_at`, [propertyId]),
    db.query(`SELECT ${cols} FROM channel_revisions r LEFT JOIN users hu ON hu.id = r.handled_by
               WHERE r.property_id = $1 ORDER BY r.received_at DESC LIMIT $2`, [propertyId, limit]),
    db.query('SELECT last_pull_at, last_pull_error FROM channel_sync_state WHERE property_id = $1', [propertyId]),
  ]);
  return { open, recent, last_pull_at: st?.last_pull_at || null, last_pull_error: st?.last_pull_error || null };
}

// FO dealt with it by hand. An error revision is then confirmed to Channex too.
async function markHandled(propertyId, id, userId) {
  const { rows: [row] } = await db.query(
    `UPDATE channel_revisions SET handled_at = NOW(), handled_by = $3
      WHERE id = $1 AND property_id = $2 AND result IN ('attention', 'error') AND handled_at IS NULL
      RETURNING external_revision_id, result, acked_at`, [id, propertyId, userId]);
  if (!row) { const e = new Error('Nothing to mark — already handled or not found'); e.status = 404; throw e; }
  if (!row.acked_at) await ack(propertyId, row.external_revision_id);
  return row;
}

module.exports = { OTA_LABEL_SQL, parseRevision, handleRevision, pullProperty, pullAll, handleWebhook, tick, start, list, markHandled };
