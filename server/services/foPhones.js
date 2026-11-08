// Front desk phones (migration 162): the Android app in fo-phone/.
// Owner: add a phone → a pairing code (8 characters, 30 minutes); the phone
// sends it once to POST /api/public/fo-phone/pair and gets its own key. Only
// sha256(key) is stored. A request from the phone carries the key as
// "Authorization: Bearer <key>" (or ?key= for the event stream).
const crypto = require('crypto');
const db = require('../db');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_MINUTES = 30;
const hash = k => crypto.createHash('sha256').update(String(k)).digest('hex');
const newCode = () => Array.from(crypto.randomBytes(8), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
const fmtCode = c => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : null);

const view = r => ({
  id: r.id, name: r.name, line: r.line,
  paired: !!r.paired_at, paired_at: r.paired_at, last_seen_at: r.last_seen_at, app_version: r.app_version,
  pair_code: r.paired_at ? null : fmtCode(r.pair_code),
  pair_expires_at: r.paired_at ? null : r.pair_expires_at,
  created_at: r.created_at,
});

async function list(propertyId) {
  const { rows } = await db.query(
    'SELECT * FROM call_devices WHERE property_id = $1 AND removed_at IS NULL ORDER BY created_at', [propertyId]);
  return rows.map(view);
}

async function add(propertyId, name, userId) {
  const n = String(name || '').trim().slice(0, 60) || 'Front desk phone';
  const { rows: [r] } = await db.query(
    `INSERT INTO call_devices (property_id, name, pair_code, pair_expires_at, created_by)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4), $5) RETURNING *`,
    [propertyId, n, newCode(), CODE_MINUTES, userId || null]);
  return view(r);
}

// A new code (expired, or moving the app to another phone: the old key stops).
async function newPairCode(propertyId, id) {
  const { rows: [r] } = await db.query(
    `UPDATE call_devices SET pair_code = $3, pair_expires_at = NOW() + make_interval(mins => $4),
            key_hash = NULL, paired_at = NULL
     WHERE id = $1 AND property_id = $2 AND removed_at IS NULL RETURNING *`,
    [id, propertyId, newCode(), CODE_MINUTES]);
  return r ? view(r) : null;
}

async function remove(propertyId, id) {
  const { rowCount } = await db.query(
    `UPDATE call_devices SET removed_at = NOW(), key_hash = NULL, pair_code = NULL
     WHERE id = $1 AND property_id = $2 AND removed_at IS NULL`, [id, propertyId]);
  return rowCount > 0;
}

// The phone trades a code for its key. Returns null for a wrong / used / expired code.
async function pair(code, appVersion) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 8) return null;
  const key = crypto.randomBytes(32).toString('hex');
  const { rows: [r] } = await db.query(
    `UPDATE call_devices SET key_hash = $2, pair_code = NULL, pair_expires_at = NULL, paired_at = NOW(),
            last_seen_at = NOW(), app_version = $3
     WHERE pair_code = $1 AND pair_expires_at > NOW() AND removed_at IS NULL
     RETURNING id, property_id, name, line`, [c, hash(key), String(appVersion || '').slice(0, 20) || null]);
  if (!r) return null;
  const { rows: [p] } = await db.query(
    `SELECT COALESCE(ps.property_name, p.name) AS name FROM properties p
     LEFT JOIN property_settings ps ON ps.property_id = p.id WHERE p.id = $1`, [r.property_id]);
  return { key, device: { id: r.id, name: r.name, line: r.line }, property: { name: p?.name || null } };
}

// Middleware: Bearer <key> or ?key=. Sets req.propertyId, req.device.
const lastSeenWrite = new Map();   // device id → last time last_seen_at was written
async function authDevice(req, res, next) {
  const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.query.key || '');
  if (!key) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { rows: [d] } = await db.query(
      `SELECT d.id, d.property_id, d.name, d.line FROM call_devices d JOIN properties p ON p.id = d.property_id
       WHERE d.key_hash = $1 AND d.removed_at IS NULL AND p.is_active`, [hash(key)]);
    if (!d) return res.status(401).json({ error: 'This phone was removed or its key changed — pair it again', code: 'DEVICE_UNKNOWN' });
    req.propertyId = d.property_id;
    req.device = d;
    if (Date.now() - (lastSeenWrite.get(d.id) || 0) > 60000) {
      lastSeenWrite.set(d.id, Date.now());
      const v = String(req.headers['x-app-version'] || '').slice(0, 20) || null;
      db.query('UPDATE call_devices SET last_seen_at = NOW(), app_version = COALESCE($2, app_version) WHERE id = $1', [d.id, v]).catch(() => {});
    }
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}

module.exports = { list, add, newPairCode, remove, pair, authDevice, hash };
