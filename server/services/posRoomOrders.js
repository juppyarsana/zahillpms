// Room tablet orders through the property's POS (migration 094; POS repo
// HOTEL_POS_PLAN.md phase 7). The tablet only talks to the PMS
// (routes/display.js, display token); the PMS checks the room has a
// checked-in guest and passes the order on to the POS with the key the POS
// made for the hotel. The POS prices it from its own menu, prints the kitchen
// ticket and — when staff accept it — charges it to the room through the
// usual POS room charge (POST /api/pos/transactions), so it reaches the folio
// like any other restaurant bill.
//
//   POS GET  /api/hotel/menu                     room-service menu + open / off / paused / closed
//   POS POST /api/hotel/room-orders              { clientRef, booking_id, room, guest, items, note }
//   POS GET  /api/hotel/room-orders?booking_id=  this stay's orders
const db = require('../db');

const TIMEOUT_MS = 10000;

class PosError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function config(propertyId) {
  const { rows: [p] } = await db.query(
    `SELECT p.pos_url, p.pos_hotel_key, COALESCE(pm.is_enabled, false) AS module_on
     FROM properties p
     LEFT JOIN property_modules pm ON pm.property_id = p.id AND pm.module = 'pos_integration'
     WHERE p.id = $1`, [propertyId]);
  const url = (p?.pos_url || '').trim().replace(/\/+$/, '');
  return { url, key: p?.pos_hotel_key || '', moduleOn: !!p?.module_on };
}

// The tablet orders from the POS when the link is set and POS Integration is on.
const linked = cfg => !!(cfg.moduleOn && cfg.url && cfg.key);

async function call(cfg, method, path, body) {
  if (!cfg.url || !cfg.key) throw new PosError('The POS link is not set up', 503, 'NOT_LINKED');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new PosError(err.name === 'AbortError' ? 'The restaurant system did not answer in time' : 'Cannot reach the restaurant system', 502, 'POS_DOWN');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* not JSON */ }
  if (!res.ok) {
    if (res.status === 401) throw new PosError('The restaurant system rejected the hotel key', 502, 'POS_KEY');
    throw new PosError(data?.error || `Restaurant system error (${res.status})`, res.status >= 500 ? 502 : res.status, data?.code);
  }
  return data;
}

const menu = cfg => call(cfg, 'GET', '/api/hotel/menu');
const placeOrder = (cfg, order) => call(cfg, 'POST', '/api/hotel/room-orders', order);
const ordersFor = (cfg, bookingId) => call(cfg, 'GET', `/api/hotel/room-orders?booking_id=${encodeURIComponent(bookingId)}`);

// Front desk voided the folio line of a POS room charge (migration 095): tell
// the POS, which reopens that bill as unpaid. Recorded on the sale either way;
// returns { told, error }. Never throws — the void itself already happened.
async function tellPosVoid(propertyId, saleId, { reason, by }) {
  const { rows: [s] } = await db.query(
    `SELECT id, external_ref, order_source FROM sales WHERE id = $1 AND property_id = $2`, [saleId, propertyId]);
  if (!s || s.order_source !== 'external_pos' || !s.external_ref) return null;   // not a POS bill
  const cfg = await config(propertyId);
  let error = null;
  if (!cfg.url || !cfg.key) {
    error = 'The POS link is not set up (Property Details → POS Integration → Room tablet orders)';
  } else {
    try {
      await call(cfg, 'POST', '/api/hotel/room-charges/void', { external_ref: s.external_ref, sale_id: s.id, reason, by });
    } catch (err) { error = err.message; }
  }
  await db.query(
    `UPDATE sales SET pos_void_sent_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE pos_void_sent_at END,
                      pos_void_error = $2 WHERE id = $1`, [s.id, error]);
  return { told: !error, error };
}

// Settings → "Test": the menu call with the address / key just typed.
async function test(url, key) {
  const m = await call({ url: String(url || '').trim().replace(/\/+$/, ''), key }, 'GET', '/api/hotel/menu');
  return { ok: true, status: m.status, items: (m.menu || []).length };
}

module.exports = { PosError, config, linked, menu, placeOrder, ordersFor, test, tellPosVoid };
