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

// Settings → "Test": the menu call with the address / key just typed.
async function test(url, key) {
  const m = await call({ url: String(url || '').trim().replace(/\/+$/, ''), key }, 'GET', '/api/hotel/menu');
  return { ok: true, status: m.status, items: (m.menu || []).length };
}

module.exports = { PosError, config, linked, menu, placeOrder, ordersFor, test };
