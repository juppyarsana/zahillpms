// OTA bookings for front desk (migration 123). What the channel manager did
// with each reservation Channex sent — booked, changed, cancelled, or left for
// FO — as the pop-up on every page (not seen yet), the Dashboard box (today)
// and the 🌐 OTA bookings page. The rows are channel_revisions
// (channelBookings.js); this only reads them and marks them seen / handled.
const db = require('../db');

const SHOWN = "('applied', 'attention', 'error')";

const COLS = `
  r.id, r.revision_status, r.result, r.ota_name, r.ota_code, r.guest_name, r.message, r.received_at,
  to_char(r.arrival, 'YYYY-MM-DD') AS arrival, to_char(r.departure, 'YYYY-MM-DD') AS departure,
  r.seen_at, su.name AS seen_by_name, r.handled_at, hu.name AS handled_by_name,
  r.booking_ids[1] AS booking_id, cb.reservation_group_id AS group_id,
  (SELECT array_agg(u.name ORDER BY u.name) FROM bookings b JOIN units u ON u.id = b.unit_id
    WHERE b.id = ANY(r.booking_ids)) AS rooms`;

const FROM = `
  FROM channel_revisions r
  LEFT JOIN channel_bookings cb ON cb.id = r.channel_booking_id
  LEFT JOIN users su ON su.id = r.seen_by
  LEFT JOIN users hu ON hu.id = r.handled_by`;

// What kind of notice a row is: new / changed / cancelled / attention.
function kind(row) {
  if (row.result !== 'applied') return 'attention';
  if (row.revision_status === 'cancelled') return 'cancelled';
  if (row.revision_status === 'modified') return 'changed';
  return 'new';
}
const withKind = rows => rows.map(r => ({ ...r, kind: kind(r) }));

// The pop-up: everything not seen yet (last 7 days), oldest first, and how
// many items still need someone.
async function unseen(propertyId) {
  const [{ rows }, { rows: [{ open }] }] = await Promise.all([
    db.query(`SELECT ${COLS} ${FROM}
               WHERE r.property_id = $1 AND r.seen_at IS NULL AND r.result IN ${SHOWN}
                 AND r.received_at > NOW() - INTERVAL '7 days'
               ORDER BY r.received_at LIMIT 20`, [propertyId]),
    db.query(`SELECT count(*)::int AS open FROM channel_revisions
               WHERE property_id = $1 AND result IN ('attention', 'error') AND handled_at IS NULL`, [propertyId]),
  ]);
  return { unseen: withKind(rows), open };
}

// The page / Dashboard box: today's (WITA), the open items, the latest.
async function overview(propertyId, { limit = 50 } = {}) {
  const today = `(r.received_at AT TIME ZONE 'Asia/Makassar')::date = (NOW() AT TIME ZONE 'Asia/Makassar')::date`;
  const [{ rows: todayRows }, { rows: open }, { rows: recent }, { rows: [st] }] = await Promise.all([
    db.query(`SELECT ${COLS} ${FROM} WHERE r.property_id = $1 AND r.result IN ${SHOWN} AND ${today} ORDER BY r.received_at DESC`, [propertyId]),
    db.query(`SELECT ${COLS} ${FROM} WHERE r.property_id = $1 AND r.result IN ('attention', 'error') AND r.handled_at IS NULL ORDER BY r.received_at`, [propertyId]),
    db.query(`SELECT ${COLS} ${FROM} WHERE r.property_id = $1 AND r.result IN ${SHOWN} ORDER BY r.received_at DESC LIMIT $2`, [propertyId, limit]),
    db.query('SELECT last_pull_at, last_webhook_at FROM channel_sync_state WHERE property_id = $1', [propertyId]),
  ]);
  const t = withKind(todayRows);
  const count = k => t.filter(r => r.kind === k).length;
  return {
    today: { new: count('new'), changed: count('changed'), cancelled: count('cancelled'), attention: count('attention'), items: t },
    open: withKind(open), recent: withKind(recent),
    last_pull_at: st?.last_pull_at || null, last_webhook_at: st?.last_webhook_at || null,
  };
}

// OK on the pop-up (ids) or "All seen" (all: true).
async function markSeen(propertyId, userId, { ids, all }) {
  if (all) {
    const { rowCount } = await db.query(
      'UPDATE channel_revisions SET seen_at = NOW(), seen_by = $2 WHERE property_id = $1 AND seen_at IS NULL', [propertyId, userId]);
    return rowCount;
  }
  const list = (Array.isArray(ids) ? ids : []).filter(id => /^[0-9a-f-]{36}$/i.test(String(id))).slice(0, 100);
  if (!list.length) return 0;
  const { rowCount } = await db.query(
    'UPDATE channel_revisions SET seen_at = NOW(), seen_by = $2 WHERE property_id = $1 AND id = ANY($3::uuid[]) AND seen_at IS NULL',
    [propertyId, userId, list]);
  return rowCount;
}

module.exports = { unseen, overview, markSeen, kind };
