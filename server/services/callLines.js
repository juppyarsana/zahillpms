// Call lines (migration 160): which screens ring for a call.
//   front_desk — every PMS staff session (the channel used since migration 018)
//   restaurant — the POS, through its server (routes/posCalls.js)
// Ringing, the 45-second timeout and "missed" live here so the PMS and POS
// routes share them.
const db = require('../db');
const sse = require('../sse');

const LINES = ['front_desk', 'restaurant'];
const RING_TIMEOUT_MS = 45_000;
const ringTimeouts = new Map();   // callId -> timeout handle

const channelFor = (propertyId, line = 'front_desk') =>
  line === 'restaurant' ? `staff:restaurant:${propertyId}` : `staff:broadcast:${propertyId}`;
const LINE_LABEL = { front_desk: 'Front Desk', restaurant: 'Restaurant' };

// Calls have no property_id of their own — resolved through their unit.
async function callInfo(callId) {
  const { rows } = await db.query(
    `SELECT c.id, c.line, c.direction, c.status, u.id AS unit_id, u.name AS unit_name, u.controller_id, u.property_id
     FROM calls c JOIN units u ON u.id = c.unit_id WHERE c.id = $1`, [callId]);
  return rows[0] || null;
}

function clearRing(callId) {
  const h = ringTimeouts.get(callId);
  if (h) { clearTimeout(h); ringTimeouts.delete(callId); }
}

async function markMissed(callId) {
  ringTimeouts.delete(callId);
  const { rows } = await db.query(
    `UPDATE calls SET status = 'missed' WHERE id = $1 AND status = 'ringing' RETURNING id`, [callId]);
  if (!rows[0]) return;
  const c = await callInfo(callId);
  if (!c) return;
  if (c.controller_id) sse.notify('room:' + c.controller_id, { type: 'missed', callId });
  sse.notify(channelFor(c.property_id, c.line), { type: 'missed', callId });
  // A room nobody answered: on Telegram, so someone calls back.
  if (c.line === 'front_desk' && c.direction === 'room_to_staff') {
    require('./telegramService').sendAlertLocalized(c.property_id, ['alert_guest_requests'], lang => lang === 'id'
      ? `📞 Panggilan tak terjawab — Kamar ${c.unit_name} menelepon front desk. Tolong telepon balik kamarnya.`
      : `📞 Missed call — Room ${c.unit_name} called the front desk. Please call the room back.`).catch(() => {});
  }
  if (c.line === 'restaurant' && c.direction === 'room_to_staff') {
    require('./telegramService').sendAlertLocalized(c.property_id, ['alert_room_service'], lang => lang === 'id'
      ? `📞 Panggilan tak terjawab — Kamar ${c.unit_name} menelepon restoran. Tolong telepon balik kamarnya.`
      : `📞 Missed call — Room ${c.unit_name} called the restaurant. Please call the room back.`).catch(() => {});
  }
}

function startRing(callId) {
  clearRing(callId);
  ringTimeouts.set(callId, setTimeout(() => markMissed(callId).catch(() => {}), RING_TIMEOUT_MS));
}

// The restaurant line works when the owner switched it on and the calling and
// POS integration modules are on.
async function restaurantLineOn(propertyId) {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(ps.restaurant_line, false) AS on,
            EXISTS (SELECT 1 FROM property_modules WHERE property_id = $1 AND module = 'calling' AND is_enabled) AS calling,
            EXISTS (SELECT 1 FROM property_modules WHERE property_id = $1 AND module = 'pos_integration' AND is_enabled) AS pos
     FROM properties p LEFT JOIN property_settings ps ON ps.property_id = p.id WHERE p.id = $1`, [propertyId]);
  return !!(r && r.on && r.calling && r.pos);
}

// Best-effort guest in the room now, for the ringing screen.
async function guestInRoom(unitId) {
  const { rows } = await db.query(
    `SELECT g.name FROM bookings b JOIN guests g ON g.id = b.guest_id
     WHERE b.unit_id = $1 AND b.status IN ('confirmed', 'checked_in')
       AND b.check_in_date <= CURRENT_DATE AND b.check_out_date >= CURRENT_DATE
     ORDER BY b.check_in_date DESC LIMIT 1`, [unitId]);
  return rows[0]?.name || null;
}


// ─── Staff-side actions, shared by the PMS (routes/calls.js) and the POS
// (routes/posCalls.js). `line` is the side doing it; a call on another line is
// not found. who = { userId?, name }.

class CallError extends Error { constructor(status, message) { super(message); this.status = status; } }

// A room calling the staff on a line → ring. Returns { callId, unitName, guestName }.
async function placeFromRoom(propertyId, roomId, line) {
  if (!LINES.includes(line)) throw new CallError(400, 'Unknown line');
  if (line === 'restaurant' && !(await restaurantLineOn(propertyId))) throw new CallError(409, 'The restaurant line is not set up');
  const { rows: [unit] } = await db.query('SELECT id, name FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, propertyId]);
  if (!unit) throw new CallError(404, 'Room not found');
  const guestName = await guestInRoom(unit.id);
  const { rows: [c] } = await db.query('INSERT INTO calls (unit_id, line) VALUES ($1, $2) RETURNING id', [unit.id, line]);
  startRing(c.id);
  sse.notify(channelFor(propertyId, line), { type: 'incoming_call', callId: c.id, unitName: unit.name, roomId, guestName, line });
  return { callId: c.id, unitName: unit.name, guestName };
}

// Staff calls a room (unitId or roomId). Returns { callId, unitName, roomId }.
async function placeToRoom(propertyId, { unitId, roomId }, line, who) {
  const { rows: [unit] } = await db.query(
    `SELECT id, name, controller_id FROM units WHERE property_id = $1 AND ${unitId ? 'id = $2' : 'controller_id = $2'}`,
    [propertyId, unitId || roomId]);
  if (!unit) throw new CallError(404, 'Room not found');
  if (!unit.controller_id) throw new CallError(400, 'Room has no Room ID assigned');
  const { rows: [c] } = await db.query(
    `INSERT INTO calls (unit_id, direction, initiated_by, initiated_by_name, line)
     VALUES ($1, 'staff_to_room', $2, $3, $4) RETURNING id`,
    [unit.id, who.userId || null, who.name || null, line]);
  startRing(c.id);
  sse.notify('room:' + unit.controller_id, { type: 'incoming_call_from_staff', callId: c.id, staffName: who.name, line, lineLabel: LINE_LABEL[line] });
  return { callId: c.id, unitName: unit.name, roomId: unit.controller_id };
}

// First to answer a ringing room call wins.
async function answer(propertyId, callId, line, who) {
  const { rows: [call] } = await db.query(
    `UPDATE calls SET status = 'answered', answered_by = $2, answered_by_name = $3, answered_at = NOW()
     WHERE id = $1 AND status = 'ringing' AND direction = 'room_to_staff' AND line = $4
       AND unit_id IN (SELECT id FROM units WHERE property_id = $5)
     RETURNING *`, [callId, who.userId || null, who.name || null, line, propertyId]);
  if (!call) throw new CallError(409, 'Call already answered');
  clearRing(callId);
  const c = await callInfo(callId);
  if (c?.controller_id) sse.notify('room:' + c.controller_id, { type: 'answered', callId, staffName: who.name });
  sse.notify(channelFor(propertyId, line), { type: 'call_taken', callId, staffName: who.name });
  return call;
}

async function end(propertyId, callId, line) {
  const { rows: [call] } = await db.query(
    `UPDATE calls SET status = 'ended', ended_at = NOW()
     WHERE id = $1 AND status IN ('ringing', 'answered') AND line = $3
       AND unit_id IN (SELECT id FROM units WHERE property_id = $2)
     RETURNING unit_id`, [callId, propertyId, line]);
  if (!call) return;
  clearRing(callId);
  const c = await callInfo(callId);
  if (c?.controller_id) sse.notify('room:' + c.controller_id, { type: 'ended', callId });
  sse.notify(channelFor(propertyId, line), { type: 'ended', callId });
}

async function signalToRoom(propertyId, callId, roomId, payload) {
  if (!roomId || !payload) throw new CallError(400, 'roomId and payload required');
  const { rows } = await db.query('SELECT id FROM units WHERE controller_id = $1 AND property_id = $2', [roomId, propertyId]);
  if (!rows[0]) throw new CallError(404, 'Room not found');
  sse.notify('room:' + roomId, { type: 'signal', callId, payload });
}

// Polling fallback: the oldest room call ringing on this line.
async function pending(propertyId, line) {
  const { rows: [c] } = await db.query(
    `SELECT c.id, c.unit_id, u.name AS unit_name, u.controller_id AS room_id
     FROM calls c JOIN units u ON u.id = c.unit_id
     WHERE u.property_id = $1 AND c.status = 'ringing' AND c.direction = 'room_to_staff' AND c.line = $2
     ORDER BY c.created_at ASC LIMIT 1`, [propertyId, line]);
  if (!c) return null;
  return { callId: c.id, unitName: c.unit_name, roomId: c.room_id, guestName: await guestInRoom(c.unit_id), line };
}

// Missed calls of the last 24 hours on a line, newest first. A call is handled
// once anyone talked to that room afterwards on this line (either direction),
// or staff pressed Done. { open: n, calls: [{ callId, unitId, unitName, roomId,
// guestName, at, handled: null | { how: 'talked' | 'done', at, by } }] }
async function missedCalls(propertyId, line) {
  const { rows } = await db.query(
    `SELECT c.id, c.created_at, c.missed_done_at, c.missed_done_by_name, u.id AS unit_id, u.name AS unit_name, u.controller_id,
            (SELECT g.name FROM bookings b JOIN guests g ON g.id = b.guest_id
              WHERE b.unit_id = u.id AND b.status IN ('confirmed', 'checked_in')
                AND b.check_in_date <= CURRENT_DATE AND b.check_out_date >= CURRENT_DATE
              ORDER BY b.check_in_date DESC LIMIT 1) AS guest_name,
            later.answered_at AS talked_at,
            COALESCE(later.answered_by_name, au.name, later.initiated_by_name, iu.name) AS talked_by,
            later.direction AS talked_direction
     FROM calls c
     JOIN units u ON u.id = c.unit_id
     LEFT JOIN LATERAL (
       SELECT c2.answered_at, c2.answered_by_name, c2.answered_by, c2.initiated_by, c2.initiated_by_name, c2.direction
       FROM calls c2 WHERE c2.unit_id = c.unit_id AND c2.line = c.line AND c2.created_at > c.created_at AND c2.answered_at IS NOT NULL
       ORDER BY c2.created_at LIMIT 1) later ON true
     LEFT JOIN users au ON au.id = later.answered_by
     LEFT JOIN users iu ON iu.id = later.initiated_by
     WHERE u.property_id = $1 AND c.line = $2 AND c.status = 'missed' AND c.direction = 'room_to_staff'
       AND c.created_at > NOW() - INTERVAL '24 hours'
     ORDER BY c.created_at DESC LIMIT 50`, [propertyId, line]);
  const calls = rows.map(r => ({
    callId: r.id, unitId: r.unit_id, unitName: r.unit_name, roomId: r.controller_id, guestName: r.guest_name, at: r.created_at,
    handled: r.talked_at ? { how: r.talked_direction === 'staff_to_room' ? 'called_back' : 'rang_again', at: r.talked_at, by: r.talked_by || null }
      : r.missed_done_at ? { how: 'done', at: r.missed_done_at, by: r.missed_done_by_name } : null,
  }));
  return { open: calls.filter(c => !c.handled).length, calls };
}

async function missedDone(propertyId, callId, line, who) {
  const { rows } = await db.query(
    `UPDATE calls SET missed_done_at = NOW(), missed_done_by_name = $4
     WHERE id = $1 AND line = $3 AND status = 'missed' AND missed_done_at IS NULL
       AND unit_id IN (SELECT id FROM units WHERE property_id = $2) RETURNING id`,
    [callId, propertyId, line, who.name || null]);
  if (!rows[0]) throw new CallError(404, 'Missed call not found');
  sse.notify(channelFor(propertyId, line), { type: 'missed_changed' });
}

// SSE stream for one line's staff screens.
function stream(req, res, key) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  sse.addClient(key, res);
  // A real `data:` event (not an SSE comment) so the client can tell a dead link.
  const heartbeat = setInterval(() => { try { res.write('data: {"type":"heartbeat"}\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(heartbeat); sse.removeClient(key, res); });
}

function sendError(res, err) {
  if (err instanceof CallError) return res.status(err.status).json({ error: err.message });
  res.status(500).json({ error: err.message });
}

module.exports = { missedCalls, missedDone, CallError, placeFromRoom, placeToRoom, answer, end, signalToRoom, pending, stream, sendError,
   LINES, LINE_LABEL, RING_TIMEOUT_MS, channelFor, callInfo, clearRing, startRing, markMissed, restaurantLineOn, guestInRoom };
