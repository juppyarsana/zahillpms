// Channex webhook (migration 123): Channex calls the PMS the moment a booking
// comes in, is changed or is cancelled. The PMS fetches that one revision from
// Channex (channelBookings.handleWebhook — never trusting the call's body),
// saves it and acknowledges it: a booking reaches front desk in seconds. The
// feed read stays as the safety net (every 15 minutes once the webhook has
// been called, every minute before), so a missed call only delays a booking.
// The PMS always answers 200 (Channex's rule), even when it can't save.
//
// Callback: <SERVER_PUBLIC_URL>/api/public/channex/webhook/<token> — the token
// (random, per property) is the secret. Needs a public https address, so it
// is off on a laptop (the page says so).
const crypto = require('crypto');
const db = require('../db');
const channex = require('./channexAdapter');

function publicBase() {
  const u = String(process.env.SERVER_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(u) || /\/\/(localhost|127\.|10\.|192\.168\.)/i.test(u)) return null;
  return u;
}

async function stateOf(propertyId) {
  const { rows: [s] } = await db.query(
    'SELECT webhook_id, webhook_token, webhook_url, webhook_error, last_webhook_at FROM channel_sync_state WHERE property_id = $1', [propertyId]);
  return s || {};
}

async function save(propertyId, fields) {
  const keys = Object.keys(fields);
  await db.query(
    `INSERT INTO channel_sync_state (property_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (property_id) DO UPDATE SET ${keys.map(k => `${k} = EXCLUDED.${k}`).join(', ')}`,
    [propertyId, ...keys.map(k => fields[k])]);
}

// Make sure Channex has this property's webhook, pointing at this server.
// Returns { state: 'on' | 'no_url' | 'not_linked' | 'error', ... }.
async function ensure(propertyId) {
  if (!channex.isConfigured()) return { state: 'error', error: 'The channel manager is not configured' };
  const { rows: [p] } = await db.query('SELECT channex_property_id FROM properties WHERE id = $1', [propertyId]);
  if (!p?.channex_property_id) return { state: 'not_linked' };
  const base = publicBase();
  if (!base) return { state: 'no_url' };
  const s = await stateOf(propertyId);
  const token = s.webhook_token || crypto.randomBytes(24).toString('hex');
  const url = `${base}/api/public/channex/webhook/${token}`;
  if (s.webhook_id && s.webhook_url === url) {
    // Still there in Channex? (someone may have deleted it there)
    const hooks = await channex.listWebhooks(p.channex_property_id).catch(() => null);
    if (!hooks || hooks.some(h => h.id === s.webhook_id && h.is_active)) return { state: 'on', url };
  }
  try {
    if (s.webhook_id) await channex.deleteWebhook(s.webhook_id).catch(() => {});
    const id = await channex.createWebhook(p.channex_property_id, url);
    await save(propertyId, { webhook_id: id, webhook_token: token, webhook_url: url, webhook_error: null });
    return { state: 'on', url };
  } catch (err) {
    await save(propertyId, { webhook_token: token, webhook_error: String(err.message).slice(0, 1000) });
    return { state: 'error', error: err.message };
  }
}

// Before unlinking the property: take the webhook off Channex.
async function remove(propertyId) {
  const s = await stateOf(propertyId);
  if (s.webhook_id) await channex.deleteWebhook(s.webhook_id).catch(err => console.error('[CHANNEL WEBHOOK] delete', err.message));
  await db.query(
    'UPDATE channel_sync_state SET webhook_id = NULL, webhook_url = NULL, webhook_error = NULL WHERE property_id = $1', [propertyId]);
}

// For the page and the checklist.
async function status(propertyId) {
  const s = await stateOf(propertyId);
  const base = publicBase();
  return {
    on: !!s.webhook_id && !!base && !!s.webhook_url?.startsWith(base),
    public_url: !!base,
    error: s.webhook_error || null,
    last_webhook_at: s.last_webhook_at || null,
  };
}

// Channex called. Returns false for an unknown token (logged; the route still
// answers 200). The work runs after the answer.
async function receive(token, body) {
  if (!/^[a-f0-9]{48}$/.test(String(token))) return false;
  const { rows: [s] } = await db.query(
    `UPDATE channel_sync_state SET last_webhook_at = NOW() WHERE webhook_token = $1 RETURNING property_id`, [token]);
  if (!s) return false;
  const event = String(body?.event || '');
  if (event && !event.startsWith('booking')) return true;
  const revisionId = body?.payload?.revision_id || body?.revision_id || null;
  setImmediate(() => require('./channelBookings').handleWebhook(s.property_id, revisionId));
  return true;
}

// At server start: every linked property with the module on.
async function ensureAll() {
  if (!channex.isConfigured() || !publicBase()) return;
  const { rows } = await db.query(`
    SELECT p.id FROM properties p
      JOIN property_modules pm ON pm.property_id = p.id AND pm.module = 'channel_manager' AND pm.is_enabled = true
     WHERE p.channex_property_id IS NOT NULL AND p.is_active = true`);
  for (const r of rows) {
    const out = await ensure(r.id).catch(err => ({ state: 'error', error: err.message }));
    if (out.state === 'error') console.error('[CHANNEL WEBHOOK]', r.id, out.error);
  }
}

module.exports = { ensure, remove, status, receive, ensureAll, publicBase };
