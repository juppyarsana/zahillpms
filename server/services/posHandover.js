// Kitchen handover (migration 152). A restaurant line received on a PO is sent
// to the POS (posPurchases.js), where it waits for the chef. The chef's answer
// comes back on POST /api/pos/purchase-handovers: the kitchen's stock got only
// what was accepted, and the rest shows on the PO as a handover shortfall. The
// supplier's bill doesn't change, the hotel did receive it all.
const db = require('../db');
const telegram = require('./telegramService');
const { fmtIDR, qtyText } = require('./poFormat');

const num = v => parseFloat(v) || 0;
const NO_HANDOVER = 'POS (no handover)';   // a POS too old to hold goods: it booked them at once

// A line's deliveries as a JSON column; `item` = the purchase_order_items alias.
const handoversSql = item => `(SELECT COALESCE(json_agg(json_build_object(
    'id', h.id, 'sent_qty', h.sent_qty, 'unit_cost', h.unit_cost, 'sent_at', h.sent_at, 'accepted_qty', h.accepted_qty,
    'note', h.note, 'confirmed_by', h.confirmed_by, 'confirmed_at', h.confirmed_at) ORDER BY h.sent_at), '[]')
  FROM pos_handovers h WHERE h.po_item_id = ${item}.id)`;

// Written when the POS has taken a delivery. `pending` = it holds the goods for the chef.
// A delivery is a PO line's (poItemId) or a transfer line's from Main Store
// (transferLineId, migration 158).
async function recordSent(propertyId, { poItemId = null, transferLineId = null, ref, qty, unitCost, pending }) {
  await db.query(
    `INSERT INTO pos_handovers (property_id, po_item_id, transfer_line_id, ref, sent_qty, unit_cost, accepted_qty, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (ref) DO NOTHING`,
    [propertyId, poItemId, transferLineId, ref, qty, unitCost, pending ? null : qty, pending ? null : NO_HANDOVER, pending ? null : new Date()]);
}

// { ref, accepted_qty, note, by, confirmed_at } from the POS. The same ref again changes nothing.
async function confirm(propertyId, body) {
  const ref = String(body?.ref || '').trim();
  const accepted = parseFloat(body?.accepted_qty);
  if (!ref) return { status: 400, error: 'ref required' };
  if (!(accepted >= 0)) return { status: 400, error: 'accepted_qty must be 0 or more' };
  const note = String(body?.note || '').trim().slice(0, 500) || null;
  const by = String(body?.by || 'Kitchen').slice(0, 120);
  const at = body?.confirmed_at && !Number.isNaN(Date.parse(body.confirmed_at)) ? new Date(body.confirmed_at) : new Date();
  const { rows: [kind] } = await db.query(
    'SELECT transfer_line_id FROM pos_handovers WHERE ref = $1 AND property_id = $2', [ref, propertyId]);
  if (kind?.transfer_line_id) {
    return require('./transferService').confirmFromPos(propertyId, { ref, accepted, note, by, at });
  }
  const client = await db.pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    const { rows: [h] } = await client.query(
      `SELECT h.*, i.description, i.unit, i.purchase_order_id, po.po_number,
              CASE pr.section WHEN 'kitchen' THEN 'Kitchen' WHEN 'resto' THEN 'Resto' END AS section
       FROM pos_handovers h
       JOIN purchase_order_items i ON i.id = h.po_item_id
       JOIN purchase_orders po ON po.id = i.purchase_order_id
       LEFT JOIN purchase_request_lines prl ON prl.id = i.request_line_id
       LEFT JOIN purchase_requests pr ON pr.id = prl.request_id
       WHERE h.ref = $1 AND h.property_id = $2 FOR UPDATE OF h`, [ref, propertyId]);
    if (!h) { await client.query('ROLLBACK'); return { status: 404, error: 'Delivery not found' }; }
    if (h.confirmed_at) { await client.query('ROLLBACK'); return { ok: true, replayed: true }; }
    const sent = num(h.sent_qty);
    if (accepted > sent + 0.0005) { await client.query('ROLLBACK'); return { status: 400, error: 'accepted_qty is more than was sent' }; }
    const got = Math.min(accepted, sent);
    await client.query(
      'UPDATE pos_handovers SET accepted_qty = $2, note = $3, confirmed_by = $4, confirmed_at = $5 WHERE id = $1',
      [h.id, got, note, by, at]);
    const { logEvent } = require('./purchasingService');   // lazy: purchasingService reads handoversSql from here
    await logEvent(client, h.purchase_order_id, got < sent
      ? `${by} confirmed ${h.description}: ${qtyText(got, h.unit)} of ${qtyText(sent, h.unit)}${note ? ` — ${note}` : ''}`
      : `${by} confirmed ${h.description}: all ${qtyText(sent, h.unit)}${note ? ` — ${note}` : ''}`);
    await client.query('COMMIT');
    row = { ...h, got, sent, note, by };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  if (row.got < row.sent) {
    const short = row.sent - row.got;
    telegram.sendAlert(propertyId, 'alert_kitchen_handover', [
      `⚠️ Kitchen got less than purchasing received: ${row.po_number}`,
      `${row.description}${row.section ? ` (for ${row.section})` : ''}`,
      `Received from the supplier ${qtyText(row.sent, row.unit)}, kitchen got ${qtyText(row.got, row.unit)}`,
      `Short ${qtyText(short, row.unit)} · ${fmtIDR(short * num(row.unit_cost))}`,
      row.note ? `Why: ${row.note}` : null,
      `By ${row.by}`,
    ].filter(Boolean).join('\n')).catch(() => {});
  }
  return { ok: true, replayed: false };
}

// One Telegram message per property listing what has waited too long. Every 15
// minutes from cron; quiet from 22:00 to 07:00 WITA.
async function remindAll(now = new Date()) {
  const hour = (now.getUTCHours() + 8) % 24;
  if (hour < 7 || hour >= 22) return 0;
  const { rows } = await db.query(
    `SELECT h.id, h.property_id, h.sent_qty, h.sent_at, COALESCE(i.description, tl.description) AS description,
            COALESCE(i.unit, tl.unit) AS unit, COALESCE(po.po_number, 'TR-' || lpad(t.transfer_no::text, 4, '0')) AS po_number,
            CASE COALESCE(pr.section, ts.section) WHEN 'kitchen' THEN 'Kitchen' WHEN 'resto' THEN 'Resto' END AS section
     FROM pos_handovers h
     JOIN property_settings ps ON ps.property_id = h.property_id
     LEFT JOIN purchase_order_items i ON i.id = h.po_item_id
     LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
     LEFT JOIN purchase_request_lines prl ON prl.id = i.request_line_id
     LEFT JOIN purchase_requests pr ON pr.id = prl.request_id
     LEFT JOIN stock_transfer_lines tl ON tl.id = h.transfer_line_id
     LEFT JOIN stock_transfers t ON t.id = tl.transfer_id
     LEFT JOIN stores ts ON ts.id = t.to_store_id
     WHERE h.confirmed_at IS NULL
       AND h.sent_at <= $1::timestamptz - make_interval(hours => ps.kitchen_handover_reminder_hours)
       AND (h.last_reminded_at IS NULL OR h.last_reminded_at <= $1::timestamptz - make_interval(hours => ps.kitchen_handover_reminder_hours))
     ORDER BY h.sent_at`, [now]);
  const byProperty = new Map();
  for (const r of rows) {
    if (!byProperty.has(r.property_id)) byProperty.set(r.property_id, []);
    byProperty.get(r.property_id).push(r);
  }
  let sent = 0;
  for (const [propertyId, list] of byProperty) {
    const lines = list.map(r => {
      const hours = Math.floor((now - new Date(r.sent_at)) / 3600e3);
      return `• ${r.po_number}: ${r.description} ${qtyText(r.sent_qty, r.unit)}${r.section ? ` (for ${r.section})` : ''}, sent ${hours} h ago`;
    });
    const n = await telegram.sendAlert(propertyId, 'alert_kitchen_handover',
      `📦 Waiting for the kitchen to confirm, in the POS under Inventory → Incoming:\n${lines.join('\n')}`);
    if (!n) continue;   // nobody got it: try again next time, when someone may have ticked the alert
    await db.query('UPDATE pos_handovers SET last_reminded_at = $2, reminders_sent = reminders_sent + 1 WHERE id = ANY($1)', [list.map(r => r.id), now]);
    sent++;
  }
  return sent;
}

async function settings(propertyId) {
  const { rows: [r] } = await db.query('SELECT kitchen_handover_reminder_hours AS hours FROM property_settings WHERE property_id = $1', [propertyId]);
  return { hours: r ? r.hours : 3 };
}
async function saveSettings(propertyId, body) {
  const hours = Number(body?.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) return { status: 400, error: 'Remind after 1 to 24 hours' };
  await db.query('UPDATE property_settings SET kitchen_handover_reminder_hours = $2 WHERE property_id = $1', [propertyId, hours]);
  return { settings: { hours } };
}

// Delivered by purchasing before `at` but not yet in the POS stock at that moment.
// Transfers from Main Store are left out: until confirmed they are still in the
// PMS's "on the way" store, so the PMS stock value already counts them.
async function waitingAt(propertyId, at) {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(sent_qty * unit_cost), 0) AS value FROM pos_handovers
     WHERE property_id = $1 AND po_item_id IS NOT NULL AND sent_at < $2 AND (confirmed_at IS NULL OR confirmed_at >= $2)`, [propertyId, at]);
  return { count: r.n, value: num(r.value) };
}

module.exports = { handoversSql, recordSent, confirm, remindAll, settings, saveSettings, waitingAt };
