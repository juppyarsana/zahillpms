// Housekeeping, step 1 (migration 132): the room's cleaning state and the
// Telegram messages that go with it. Replaces the Operations task cards.
//
// State of a room (board()):
//   out_of_order — units.status 'out_of_order'
//   dnd          — guest in the room with Do Not Disturb on (an open DND task)
//   request      — guest in the room, a clean asked for (units.clean_request_*)
//   occupied     — guest in the room
//   to_clean     — empty, housekeeping_status 'dirty' (after check-out …)
//   ready        — empty and clean
//
// Messages (each recipient's own language, English / Bahasa Indonesia):
//   alert_housekeeping — room to clean after check-out, clean on request (who
//                        asked), Do Not Disturb (also to alert_guest_requests)
//   alert_room_clean   — a room marked clean (to front desk)
// Messages go out after the change is saved and never hold up the screen.
const db = require('../db');
const sse = require('../sse');
const telegram = require('./telegramService');
const { TODAY_WITA_SQL } = require('./occupancySql');

const esc = s => telegram.escapeHtml(String(s ?? ''));
const hm = d => d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit' }) : '';

const T = {
  en: {
    toClean: 'Room to clean', checkedOut: 'checked out', arriving: 'Guest arriving today', cleanFirst: 'clean first',
    nights: n => `${n} night${n === 1 ? '' : 's'}`,
    still: (n, a) => `Still to clean: ${n} room${n === 1 ? '' : 's'}${a ? ` (${a} with arrivals today)` : ''}`,
    request: 'Clean on request', guestIn: 'guest in room', askedBy: 'Asked by',
    byGuest: 'the guest (room tablet)', byFd: name => `front desk${name ? ` (${name})` : ''}`,
    clean: 'Room clean', onTablet: 'marked clean on the room tablet', inPms: name => `marked clean in the PMS${name ? ` by ${name}` : ''}`,
    onRequest: 'cleaned on request — guest in room', canCheckIn: g => `${g} arriving today can check in.`,
    dnd: 'Do not disturb', dndText: "Don't knock until the guest switches it off.",
  },
  id: {
    toClean: 'Kamar perlu dibersihkan', checkedOut: 'check-out', arriving: 'Tamu datang hari ini', cleanFirst: 'bersihkan dulu',
    nights: n => `${n} malam`,
    still: (n, a) => `Masih perlu dibersihkan: ${n} kamar${a ? ` (${a} dengan tamu datang hari ini)` : ''}`,
    request: 'Minta dibersihkan', guestIn: 'tamu di kamar', askedBy: 'Diminta oleh',
    byGuest: 'tamu (tablet kamar)', byFd: name => `front desk${name ? ` (${name})` : ''}`,
    clean: 'Kamar sudah bersih', onTablet: 'ditandai bersih di tablet kamar', inPms: name => `ditandai bersih di PMS${name ? ` oleh ${name}` : ''}`,
    onRequest: 'dibersihkan atas permintaan — tamu di kamar', canCheckIn: g => `${g} yang datang hari ini bisa check-in.`,
    dnd: 'Jangan diganggu', dndText: 'Jangan ketuk pintu sampai tamu mematikannya.',
  },
};

// One room with what the board and the messages need.
const ROOM_SQL = `
  SELECT u.id, u.name, u.controller_id, u.status, u.housekeeping_status, u.housekeeping_updated_at,
         u.clean_request_at, u.clean_request_via, ru.name AS clean_request_by_name,
         u.status_reason, to_char(u.status_expected_back, 'YYYY-MM-DD') AS status_expected_back,
         COALESCE(rt.name, u.type, '') AS room_type, COALESCE(rt.sort_order, 999) AS type_order,
         cur.guest_name AS current_guest, to_char(cur.check_out_date, 'YYYY-MM-DD') AS current_check_out,
         (cur.check_out_date <= ${TODAY_WITA_SQL}) AS due_out,
         arr.id AS arrival_booking_id, arr.guest_name AS arrival_guest, arr.nights AS arrival_nights,
         co.checkout_time AS checked_out_at, dnd.id AS dnd_task_id, dnd.created_at AS dnd_since
  FROM units u
  LEFT JOIN room_types rt ON rt.id = u.room_type_id
  LEFT JOIN users ru ON ru.id = u.clean_request_by
  LEFT JOIN LATERAL (
    SELECT g.name AS guest_name, b.check_out_date FROM bookings b JOIN guests g ON g.id = b.guest_id
    WHERE b.unit_id = u.id AND b.property_id = u.property_id AND b.status = 'checked_in'
    ORDER BY b.check_in_date DESC LIMIT 1) cur ON true
  LEFT JOIN LATERAL (
    SELECT b.id, g.name AS guest_name, (b.check_out_date - b.check_in_date) AS nights
    FROM bookings b JOIN guests g ON g.id = b.guest_id
    WHERE b.unit_id = u.id AND b.property_id = u.property_id
      AND b.status IN ('pending', 'deposit_paid', 'confirmed') AND b.check_in_date = ${TODAY_WITA_SQL}
    ORDER BY b.created_at LIMIT 1) arr ON true
  LEFT JOIN LATERAL (
    SELECT cr.checkout_time FROM checkin_records cr JOIN bookings b ON b.id = cr.booking_id
    WHERE b.unit_id = u.id AND b.property_id = u.property_id AND cr.checkout_time IS NOT NULL
      AND (cr.checkout_time AT TIME ZONE 'Asia/Makassar')::date = ${TODAY_WITA_SQL}
    ORDER BY cr.checkout_time DESC LIMIT 1) co ON true
  LEFT JOIN LATERAL (
    SELECT t.id, t.created_at FROM tasks t
    WHERE t.unit_id = u.id AND t.property_id = u.property_id AND t.type = 'guest_request'
      AND t.title LIKE 'Do Not Disturb%' AND t.status <> 'done'
    ORDER BY t.created_at DESC LIMIT 1) dnd ON true`;

function stateOf(r) {
  if (r.status === 'out_of_order') return 'out_of_order';
  if (r.status === 'occupied' || r.current_guest) {
    if (r.dnd_task_id) return 'dnd';
    if (r.clean_request_at) return 'request';
    return 'occupied';
  }
  return r.housekeeping_status === 'dirty' ? 'to_clean' : 'ready';
}

function shape(r) {
  return {
    id: r.id, name: r.name, controller_id: r.controller_id, room_type: r.room_type, type_order: r.type_order,
    state: stateOf(r),
    housekeeping_status: r.housekeeping_status, since: r.housekeeping_updated_at,
    checked_out_at: r.checked_out_at,
    request: r.clean_request_at ? { at: r.clean_request_at, via: r.clean_request_via, by_name: r.clean_request_by_name } : null,
    dnd_since: r.dnd_since,
    current_guest: r.current_guest, current_check_out: r.current_check_out, due_out: !!r.due_out,
    arrival: r.arrival_booking_id ? { booking_id: r.arrival_booking_id, guest: r.arrival_guest, nights: r.arrival_nights } : null,
    out_of_order: r.status === 'out_of_order' ? { reason: r.status_reason, expected_back: r.status_expected_back } : null,
  };
}

async function loadRoom(propertyId, unitId) {
  const { rows: [r] } = await db.query(`${ROOM_SQL} WHERE u.id = $1 AND u.property_id = $2`, [unitId, propertyId]);
  return r ? shape(r) : null;
}

async function board(propertyId) {
  const { rows } = await db.query(`${ROOM_SQL} WHERE u.property_id = $1`, [propertyId]);
  const rooms = rows.map(shape).sort((a, b) => a.type_order - b.type_order || a.room_type.localeCompare(b.room_type)
    || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const counts = {};
  for (const r of rooms) counts[r.state] = (counts[r.state] || 0) + 1;
  // Clean these first: empty rooms to clean with a guest arriving today, the
  // longest waiting first.
  const waitFrom = r => new Date(r.checked_out_at || r.since || 0).getTime();
  const first = rooms.filter(r => r.state === 'to_clean' && r.arrival).sort((a, b) => waitFrom(a) - waitFrom(b));
  const later = rooms.filter(r => (r.state === 'to_clean' && !r.arrival) || r.state === 'request')
    .sort((a, b) => waitFrom(a) - waitFrom(b));
  const { rows: [t] } = await db.query(`SELECT to_char(${TODAY_WITA_SQL}, 'YYYY-MM-DD') AS today`);
  return {
    today: t.today, rooms, counts, first: first.map(r => r.id), later: later.map(r => r.id),
    arrivals_today: rooms.filter(r => r.arrival).length,
    departures_today: rooms.filter(r => r.due_out).length,
  };
}

// ── Messages ──
async function stillToClean(propertyId) {
  const { rooms } = await board(propertyId);
  const dirty = rooms.filter(r => r.state === 'to_clean' || r.state === 'request');
  return { n: dirty.length, a: dirty.filter(r => r.arrival).length };
}

function arrivalLine(t, room) {
  return room.arrival ? `\n<b>${t.arriving}: ${esc(room.arrival.guest)} · ${t.nights(room.arrival.nights)} — ${t.cleanFirst}</b>` : '';
}

async function notifyToClean(propertyId, unitId) {
  const room = await loadRoom(propertyId, unitId);
  if (!room) return;
  const left = await stillToClean(propertyId);
  return telegram.sendAlertLocalized(propertyId, ['alert_housekeeping'], lang => {
    const t = T[lang];
    return `🧹 <b>${t.toClean} — ${esc(room.name)}</b>\n${esc(room.room_type)} · ${t.checkedOut} ${hm(room.checked_out_at || new Date())}`
      + arrivalLine(t, room) + `\n${t.still(left.n, left.a)}`;
  }, { html: true });
}

async function notifyRequest(propertyId, unitId) {
  const room = await loadRoom(propertyId, unitId);
  if (!room?.request) return;
  return telegram.sendAlertLocalized(propertyId, ['alert_housekeeping'], lang => {
    const t = T[lang];
    const by = room.request.via === 'guest' ? t.byGuest : t.byFd(room.request.by_name);
    return `🙋 <b>${t.request} — ${esc(room.name)}</b>\n${esc(room.room_type)} · ${t.guestIn}\n${t.askedBy}: <b>${esc(by)}</b> · ${hm(room.request.at)}`;
  }, { html: true });
}

async function notifyClean(propertyId, unitId, { source, byName, wasRequest }) {
  const room = await loadRoom(propertyId, unitId);
  if (!room) return;
  return telegram.sendAlertLocalized(propertyId, ['alert_room_clean'], lang => {
    const t = T[lang];
    const how = wasRequest ? t.onRequest : source === 'tablet' ? t.onTablet : t.inPms(byName);
    return `✅ <b>${t.clean} — ${esc(room.name)}</b>\n${esc(room.room_type)} · ${how}`
      + (room.arrival && !wasRequest ? `\n<b>${esc(t.canCheckIn(room.arrival.guest))}</b>` : '');
  }, { html: true });
}

async function notifyDnd(propertyId, unitName) {
  return telegram.sendAlertLocalized(propertyId, ['alert_housekeeping', 'alert_guest_requests'], lang => {
    const t = T[lang];
    return `🔕 <b>${t.dnd} — ${esc(unitName)}</b>\n${t.dndText}`;
  }, { html: true });
}

// ── Changes ──
async function unitRow(propertyId, unitId) {
  const { rows: [u] } = await db.query('SELECT id, name, controller_id, status FROM units WHERE id = $1 AND property_id = $2', [unitId, propertyId]);
  return u || null;
}

// Mark a room clean: from the tablet (source 'tablet') or the PMS ('pms').
async function markClean(propertyId, unitId, { source = 'pms', userId = null } = {}) {
  const u = await unitRow(propertyId, unitId);
  if (!u) return { status: 404, error: 'Room not found' };
  const { rows: [before] } = await db.query(
    `SELECT housekeeping_status, clean_request_at FROM units WHERE id = $1`, [unitId]);
  await db.query(
    `UPDATE units SET housekeeping_status = 'clean', housekeeping_updated_at = NOW(),
       clean_request_at = NULL, clean_request_via = NULL, clean_request_by = NULL
     WHERE id = $1 AND property_id = $2`, [unitId, propertyId]);
  // Cards from before migration 132, if any are still open.
  await db.query(`UPDATE tasks SET status = 'done', updated_at = NOW()
    WHERE unit_id = $1 AND property_id = $2 AND type = 'housekeeping' AND status <> 'done'`, [unitId, propertyId]);
  if (u.controller_id) sse.notify(u.controller_id, { type: 'housekeeping' });
  const wasWork = before.housekeeping_status === 'dirty' || !!before.clean_request_at;
  if (wasWork) {
    let byName = null;
    if (userId) ({ rows: [{ name: byName } = {}] } = await db.query('SELECT name FROM users WHERE id = $1', [userId]));
    notifyClean(propertyId, unitId, { source, byName, wasRequest: !!before.clean_request_at }).catch(() => {});
  }
  return { room: await loadRoom(propertyId, unitId) };
}

// An empty room that needs cleaning again (e.g. flagged by front desk).
async function markToClean(propertyId, unitId) {
  const u = await unitRow(propertyId, unitId);
  if (!u) return { status: 404, error: 'Room not found' };
  await db.query(`UPDATE units SET housekeeping_status = 'dirty', housekeeping_updated_at = NOW() WHERE id = $1 AND property_id = $2`,
    [unitId, propertyId]);
  if (u.controller_id) sse.notify(u.controller_id, { type: 'housekeeping' });
  return { room: await loadRoom(propertyId, unitId) };
}

// After check-out (routes/checkin.js has already set the room dirty).
function afterCheckout(propertyId, unitId) {
  notifyToClean(propertyId, unitId).catch(() => {});
}

// A clean asked for while a guest is in the room: by the guest on the tablet
// (via 'guest') or by front desk (via 'front_desk', userId). Asking again
// while one is open changes nothing and sends nothing.
async function requestClean(propertyId, unitId, { via, userId = null }) {
  const u = await unitRow(propertyId, unitId);
  if (!u) return { status: 404, error: 'Room not found' };
  const { rowCount } = await db.query(
    `UPDATE units SET clean_request_at = NOW(), clean_request_via = $3, clean_request_by = $4,
       housekeeping_status = 'dirty', housekeeping_updated_at = NOW()
     WHERE id = $1 AND property_id = $2 AND clean_request_at IS NULL`,
    [unitId, propertyId, via, via === 'front_desk' ? userId : null]);
  if (rowCount) {
    if (u.controller_id) sse.notify(u.controller_id, { type: 'housekeeping' });
    notifyRequest(propertyId, unitId).catch(() => {});
  }
  return { room: await loadRoom(propertyId, unitId), already: !rowCount };
}

async function cancelRequest(propertyId, unitId) {
  const u = await unitRow(propertyId, unitId);
  if (!u) return { status: 404, error: 'Room not found' };
  await db.query(
    `UPDATE units SET clean_request_at = NULL, clean_request_via = NULL, clean_request_by = NULL,
       housekeeping_status = CASE WHEN status = 'occupied' THEN 'clean' ELSE housekeeping_status END,
       housekeeping_updated_at = NOW()
     WHERE id = $1 AND property_id = $2`, [unitId, propertyId]);
  return { room: await loadRoom(propertyId, unitId) };
}

module.exports = { board, loadRoom, markClean, markToClean, requestClean, cancelRequest, afterCheckout, notifyDnd, T };
