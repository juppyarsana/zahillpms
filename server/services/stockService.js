// Operations → Stock (migration 136): everything kept in stock in one place —
// stock items (raw_materials: rice, eggs, soap…) and Sales items with Track
// stock (products: bottled water, minibar…) — with Adjust, Stock opname,
// Usage and Stock value. Buying stays on Purchasing (purchasingService /
// directPurchaseService), which adds stock through addStock().
//
// An item is addressed as 'rm:<uuid>' (stock item) or 'p:<uuid>' (Sales item).
// Each kind keeps its own ledger (raw_material_movements / stock_movements);
// this file reads both the same way.
//
// Adjust and stock opname stay apart (owner, 2026-10-23):
//   Adjust  — one item, a known event: 'waste' (spoiled / broken), 'used'
//             (not sold — e.g. welcome drinks), or a correction ('adjustment',
//             + or −). The stock changes at once.
//   Opname  — every item counted on one day. Finishing it sets each counted
//             item to what was counted; the difference is the unexplained
//             part (reason 'opname'). Finished = fixed (never edited).
// Usage between two opnames: opening + bought − closing, split by reason.
const db = require('../db');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');
const { CATEGORY_KEYS, CATEGORY_LABEL } = require('./costCategories');

const num = v => parseFloat(v) || 0;
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const fail = (status, error, code) => ({ status, error, code });
const opnameNo = n => `SO-${String(n).padStart(4, '0')}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUCT_CATEGORY_LABEL = {
  drinks: 'Drinks (for sale)', food: 'Food (for sale)', minibar: 'Minibar', merchandise: 'Merchandise',
  room_addon: 'Room add-ons', transport: 'Transport', laundry: 'Laundry', service: 'Service', other: 'Other (for sale)',
};
const REASON_LABEL = {
  purchase: 'Bought', restock: 'Added', sale: 'Sold', waste: 'Waste / spoiled', used: 'Used (not sold)',
  adjustment: 'Correction', opname: 'Stock opname',
};
const WRITEOFF_DEFAULT = { amount: 500000 };

function parseKey(key) {
  const m = /^(rm|p):(.+)$/.exec(String(key || ''));
  if (!m || !UUID_RE.test(m[2])) return null;
  return m[1] === 'rm' ? { kind: 'rm', id: m[2], table: 'raw_materials', ledger: 'raw_material_movements', col: 'raw_material_id' }
    : { kind: 'p', id: m[2], table: 'products', ledger: 'stock_movements', col: 'product_id' };
}

// ── The list ──
const ITEMS_SQL = `
  SELECT 'rm:' || id AS key, 'rm' AS kind, id, name, unit_of_measure AS unit, COALESCE(category, 'other') AS category,
         stock_quantity AS on_hand, cost_per_unit AS avg_cost, low_stock_threshold AS low_threshold, is_active
  FROM raw_materials WHERE property_id = $1
  UNION ALL
  SELECT 'p:' || id, 'p', id, name, 'pcs', category, stock_quantity, cost_per_unit, low_stock_threshold, COALESCE(is_available, true)
  FROM products WHERE property_id = $1 AND track_stock AND NOT COALESCE(per_night, false) AND NOT COALESCE(open_price, false)`;

function shapeItem(r) {
  const onHand = num(r.on_hand);
  const avg = r.avg_cost != null ? num(r.avg_cost) : null;
  return {
    key: r.key, kind: r.kind, id: r.id, name: r.name, unit: r.unit, category: r.category,
    category_label: r.kind === 'rm' ? (CATEGORY_LABEL[r.category] || 'Other') : (PRODUCT_CATEGORY_LABEL[r.category] || r.category),
    kind_label: r.kind === 'rm' ? 'Stock item' : 'Sales item',
    on_hand: onHand, avg_cost: avg, value: avg != null ? r2(onHand * avg) : null,
    low_threshold: r.low_threshold != null ? num(r.low_threshold) : null,
    low: r.low_threshold != null && onHand <= num(r.low_threshold), out: onHand <= 0, is_active: r.is_active,
  };
}

async function listItems(propertyId, { inactive = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM (${ITEMS_SQL}) x ${inactive ? '' : 'WHERE is_active'} ORDER BY is_active DESC, lower(name)`, [propertyId]);
  return rows.map(shapeItem);
}

async function getItem(propertyId, key, q = db) {
  const k = parseKey(key);
  if (!k) return null;
  const { rows: [r] } = await q.query(`SELECT * FROM (${ITEMS_SQL}) x WHERE id = $2 AND kind = $3`, [propertyId, k.id, k.kind]);
  return r ? shapeItem(r) : null;
}

// ── Stock items (raw_materials) — the Sales items are edited in Sales → Items ──
async function saveStockItem(propertyId, body, id = null) {
  const name = String(body.name || '').trim().slice(0, 255);
  if (!name) return fail(400, 'Enter the name');
  const unit = ['kg', 'g', 'l', 'ml', 'pcs'].includes(body.unit) ? body.unit : 'pcs';
  const category = body.category || null;
  if (category && !CATEGORY_KEYS.includes(category)) return fail(400, 'Choose a category');
  const low = body.low_threshold === '' || body.low_threshold == null ? null : Number(body.low_threshold);
  if (low != null && !(low >= 0)) return fail(400, 'Low stock must be 0 or more');
  const { rows: [dup] } = await db.query(
    'SELECT id FROM raw_materials WHERE property_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3', [propertyId, name, id]);
  if (dup) return fail(409, 'A stock item with this name already exists', 'DUPLICATE');
  if (id) {
    const { rows: [r] } = await db.query(
      `UPDATE raw_materials SET name = $1, unit_of_measure = $2, category = $3, low_stock_threshold = $4,
         is_active = COALESCE($5, is_active) WHERE id = $6 AND property_id = $7 RETURNING id`,
      [name, unit, category, low, typeof body.is_active === 'boolean' ? body.is_active : null, id, propertyId]);
    return r ? { item: await getItem(propertyId, `rm:${id}`) } : fail(404, 'Stock item not found');
  }
  const { rows: [r] } = await db.query(
    `INSERT INTO raw_materials (property_id, name, unit_of_measure, category, low_stock_threshold) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [propertyId, name, unit, category, low]);
  return { item: await getItem(propertyId, `rm:${r.id}`) };
}

// ── History of one item ──
async function history(propertyId, key) {
  const k = parseKey(key);
  const item = await getItem(propertyId, key);
  if (!k || !item) return null;
  const { rows } = await db.query(
    `SELECT m.id, m.change_qty, m.reason, m.note, m.created_at, m.reference_id, u.name AS by_name, po.po_number, po.is_direct
     FROM ${k.ledger} m LEFT JOIN users u ON u.id = m.created_by
     LEFT JOIN purchase_orders po ON po.id = m.purchase_order_id
     WHERE m.${k.col} = $1 AND m.property_id = $2 ORDER BY m.created_at DESC, m.id DESC LIMIT 200`, [k.id, propertyId]);
  let after = item.on_hand;
  const lines = rows.map(m => {
    const line = { ...m, change_qty: num(m.change_qty), bucket: bucketOf(m), reason_label: labelOf(m), after: r3(after) };
    after -= num(m.change_qty);
    return line;
  });
  return { item, lines };
}

// Which column of the usage report a movement belongs to.
function bucketOf(m) {
  if (m.po_number || m.purchase_order_id) return 'bought';
  if (m.reason === 'purchase') return 'bought';
  if (m.reason === 'sale') return 'sold';
  if (m.reason === 'adjustment' && m.reference_id) return 'sold';   // a sale voided / order rejected — stock back
  if (m.reason === 'used') return 'used';
  if (m.reason === 'waste') return 'waste';
  if (m.reason === 'opname') return 'opname';
  return 'correction';                                               // corrections, Sales items added by hand
}
function labelOf(m) {
  if (m.po_number) return m.is_direct ? `Bought without a PO · ${m.po_number}` : `Purchase order · ${m.po_number}`;
  if (m.reason === 'adjustment' && m.reference_id) return 'Sale voided — back in stock';
  return REASON_LABEL[m.reason] || m.reason;
}

// ── Adjust ──
// { reason: 'waste' | 'used' | 'correction', quantity (> 0), direction: 'down' | 'up' (correction only), note }
async function adjust(propertyId, key, body, user) {
  const k = parseKey(key);
  if (!k) return fail(404, 'Item not found');
  const reason = body.reason;
  if (!['waste', 'used', 'correction'].includes(reason)) return fail(400, 'Choose why');
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0 || qty >= 1e7) return fail(400, 'Enter how many');
  if (k.kind === 'p' && !Number.isInteger(qty)) return fail(400, 'Sales items are counted in whole units');
  if (k.kind === 'rm' && Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) return fail(400, 'At most 3 decimals');
  const note = String(body.note || '').trim().slice(0, 500);
  if (reason === 'correction' && !note) return fail(400, 'Say why the stock is corrected', 'REASON_REQUIRED');
  const up = reason === 'correction' && body.direction === 'up';
  const change = up ? qty : -qty;
  const client = await db.pool.connect();
  let item, value;
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query(
      `SELECT name, stock_quantity, cost_per_unit FROM ${k.table} WHERE id = $1 AND property_id = $2 FOR UPDATE`, [k.id, propertyId]);
    if (!row) { await client.query('ROLLBACK'); return fail(404, 'Item not found'); }
    if (num(row.stock_quantity) + change < -1e-9) {
      await client.query('ROLLBACK');
      return fail(400, `Only ${+num(row.stock_quantity).toFixed(3)} in stock — correct it with a stock opname if the count is wrong`, 'BELOW_ZERO');
    }
    await client.query(`UPDATE ${k.table} SET stock_quantity = stock_quantity + $1 WHERE id = $2`, [change, k.id]);
    await client.query(
      `INSERT INTO ${k.ledger} (property_id, ${k.col}, change_qty, reason, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [propertyId, k.id, change, reason === 'correction' ? 'adjustment' : reason, note || null, user.id || null]);
    await client.query('COMMIT');
    value = row.cost_per_unit != null ? r2(qty * num(row.cost_per_unit)) : null;
    item = await getItem(propertyId, key);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }

  // A big write-off (waste, or a correction down) goes to Telegram.
  if ((reason === 'waste' || (reason === 'correction' && !up)) && value != null) {
    writeoffSettings(propertyId).then(s => {
      if (!(s.amount > 0 && value >= s.amount)) return;
      const e = telegram.escapeHtml;
      return telegram.sendAlert(propertyId, 'alert_stock_writeoff', [
        `🗑 <b>Stock written off — ${e(idr(value))}</b>`,
        `${e(item.name)}: −${e(qtyText(qty, item.unit))} (${reason === 'waste' ? 'waste / spoiled' : 'correction'})`,
        note ? `Why: ${e(note)}` : '',
        `<i>by ${e(user.name || 'someone')} · ${e(qtyText(item.on_hand, item.unit))} left</i>`,
      ].filter(Boolean).join('\n'), { html: true });
    }).catch(() => {});
  }
  return { item };
}

const idr = n => `Rp ${Math.round(num(n)).toLocaleString('id-ID')}`;
const qtyText = (q, unit) => `${+num(q).toFixed(3)}${unit ? ' ' + unit : ''}`;

async function writeoffSettings(propertyId) {
  const { rows: [r] } = await db.query('SELECT stock_alerts AS a FROM property_settings WHERE property_id = $1', [propertyId]);
  return { ...WRITEOFF_DEFAULT, ...(r?.a || {}) };
}
async function saveWriteoffSettings(propertyId, body) {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1e12) return fail(400, 'Enter a whole number, 0 or more');
  await db.query('UPDATE property_settings SET stock_alerts = $1 WHERE property_id = $2', [{ amount }, propertyId]);
  return { settings: { amount } };
}

// ── Stock opname ──
const OPNAME_COLS = `o.id, o.opname_no, to_char(o.count_date, 'YYYY-MM-DD') AS count_date, o.status, o.notes, o.created_at,
  o.finished_at, o.cancelled_at, cu.name AS created_by_name, fu.name AS finished_by_name`;
const OPNAME_FROM = `FROM stock_opnames o LEFT JOIN users cu ON cu.id = o.created_by LEFT JOIN users fu ON fu.id = o.finished_by`;

async function listOpnames(propertyId) {
  const { rows } = await db.query(
    `SELECT ${OPNAME_COLS},
       (SELECT COUNT(*) FROM stock_opname_lines l WHERE l.opname_id = o.id)::int AS items,
       (SELECT COUNT(*) FROM stock_opname_lines l WHERE l.opname_id = o.id AND l.counted_qty IS NOT NULL)::int AS counted,
       (SELECT COALESCE(SUM((l.counted_qty - l.expected_qty) * COALESCE(l.unit_cost, 0)), 0) FROM stock_opname_lines l
         WHERE l.opname_id = o.id AND l.counted_qty IS NOT NULL AND l.expected_qty IS NOT NULL) AS difference_value,
       (SELECT COALESCE(SUM(l.counted_qty * COALESCE(l.unit_cost, 0)), 0) FROM stock_opname_lines l
         WHERE l.opname_id = o.id AND l.counted_qty IS NOT NULL) AS counted_value
     ${OPNAME_FROM} WHERE o.property_id = $1 AND o.status <> 'cancelled' ORDER BY o.opname_no DESC LIMIT 200`, [propertyId]);
  return rows.map(o => ({ ...o, no_text: opnameNo(o.opname_no), difference_value: r2(num(o.difference_value)), counted_value: r2(num(o.counted_value)) }));
}

async function getOpname(propertyId, id) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows: [o] } = await db.query(`SELECT ${OPNAME_COLS} ${OPNAME_FROM} WHERE o.id = $1 AND o.property_id = $2`, [id, propertyId]);
  if (!o) return null;
  // A draft shows what the PMS has now; a finished one what it had when finished.
  const { rows } = await db.query(
    `SELECT l.*, COALESCE(rm.stock_quantity, p.stock_quantity) AS live_qty, COALESCE(rm.cost_per_unit, p.cost_per_unit) AS live_cost,
            COALESCE(rm.category, p.category) AS category
     FROM stock_opname_lines l LEFT JOIN raw_materials rm ON rm.id = l.raw_material_id LEFT JOIN products p ON p.id = l.product_id
     WHERE l.opname_id = $1 ORDER BY lower(l.description)`, [id]);
  const lines = rows.map(l => {
    const expected = o.status === 'finished' ? num(l.expected_qty) : num(l.live_qty);
    const cost = o.status === 'finished' ? (l.unit_cost != null ? num(l.unit_cost) : null) : (l.live_cost != null ? num(l.live_cost) : null);
    const counted = l.counted_qty != null ? num(l.counted_qty) : null;
    const diff = counted != null ? r3(counted - expected) : null;
    return {
      id: l.id, key: l.raw_material_id ? `rm:${l.raw_material_id}` : `p:${l.product_id}`, kind: l.raw_material_id ? 'rm' : 'p',
      description: l.description, unit: l.unit,
      category_label: l.raw_material_id ? (CATEGORY_LABEL[l.category] || 'Other') : (PRODUCT_CATEGORY_LABEL[l.category] || l.category),
      expected, counted, difference: diff, unit_cost: cost,
      difference_value: diff != null && cost != null ? r2(diff * cost) : null,
      counted_value: counted != null && cost != null ? r2(counted * cost) : null,
    };
  });
  const counted = lines.filter(l => l.counted != null);
  return {
    ...o, no_text: opnameNo(o.opname_no), lines,
    totals: {
      items: lines.length, counted: counted.length,
      short: counted.filter(l => l.difference < 0).length, over: counted.filter(l => l.difference > 0).length,
      difference_value: r2(counted.reduce((t, l) => t + (l.difference_value || 0), 0)),
      counted_value: r2(counted.reduce((t, l) => t + (l.counted_value || 0), 0)),
    },
  };
}

async function startOpname(propertyId, body, user) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stock_opname:${propertyId}`]);
    const { rows: [open] } = await client.query(`SELECT opname_no FROM stock_opnames WHERE property_id = $1 AND status = 'draft'`, [propertyId]);
    if (open) { await client.query('ROLLBACK'); return fail(409, `${opnameNo(open.opname_no)} is still being counted — finish or cancel it first`, 'OPEN'); }
    const { rows: [n] } = await client.query('SELECT COALESCE(MAX(opname_no), 0) + 1 AS no FROM stock_opnames WHERE property_id = $1', [propertyId]);
    const { rows: [o] } = await client.query(
      `INSERT INTO stock_opnames (property_id, opname_no, count_date, notes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [propertyId, n.no, todayWITA(), String(body.notes || '').trim().slice(0, 1000) || null, user.id || null]);
    const { rows: items } = await client.query(`SELECT * FROM (${ITEMS_SQL}) x WHERE is_active`, [propertyId]);
    if (!items.length) { await client.query('ROLLBACK'); return fail(400, 'Nothing is kept in stock yet — add stock items first'); }
    for (const it of items) {
      await client.query(
        `INSERT INTO stock_opname_lines (opname_id, product_id, raw_material_id, description, unit) VALUES ($1, $2, $3, $4, $5)`,
        [o.id, it.kind === 'p' ? it.id : null, it.kind === 'rm' ? it.id : null, it.name, it.unit]);
    }
    await client.query('COMMIT');
    return { opname: await getOpname(propertyId, o.id) };
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
}

// counts: [{ line_id, counted }] — counted '' / null = not counted.
async function saveCounts(propertyId, id, counts) {
  const { rows: [o] } = await db.query('SELECT status FROM stock_opnames WHERE id = $1 AND property_id = $2', [id, propertyId]);
  if (!o) return fail(404, 'Stock opname not found');
  if (o.status !== 'draft') return fail(409, 'This stock opname is finished — it can\'t be changed', 'FINISHED');
  if (!Array.isArray(counts)) return fail(400, 'Nothing to save');
  for (const c of counts) {
    const v = c.counted === '' || c.counted == null ? null : Number(c.counted);
    if (v != null && (!Number.isFinite(v) || v < 0 || v >= 1e7)) return fail(400, 'A count must be 0 or more');
    await db.query(
      `UPDATE stock_opname_lines l SET counted_qty = CASE WHEN l.product_id IS NOT NULL AND $1::numeric IS NOT NULL THEN round($1::numeric) ELSE round($1::numeric, 3) END
       WHERE l.id = $2 AND l.opname_id = $3`, [v, c.line_id, id]);
  }
  return { opname: await getOpname(propertyId, id) };
}

async function cancelOpname(propertyId, id, user) {
  const { rows: [o] } = await db.query(
    `UPDATE stock_opnames SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1
     WHERE id = $2 AND property_id = $3 AND status = 'draft' RETURNING id`, [user.id || null, id, propertyId]);
  return o ? { ok: true } : fail(409, 'Only a stock opname still being counted can be cancelled');
}

async function finishOpname(propertyId, id, user) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [o] } = await client.query(
      'SELECT id, opname_no, status FROM stock_opnames WHERE id = $1 AND property_id = $2 FOR UPDATE', [id, propertyId]);
    if (!o) { await client.query('ROLLBACK'); return fail(404, 'Stock opname not found'); }
    if (o.status !== 'draft') { await client.query('ROLLBACK'); return fail(409, 'This stock opname is already finished or cancelled', 'FINISHED'); }
    const { rows: lines } = await client.query('SELECT * FROM stock_opname_lines WHERE opname_id = $1', [id]);
    if (!lines.some(l => l.counted_qty != null)) { await client.query('ROLLBACK'); return fail(400, 'Count at least one item first'); }
    const note = `Stock opname ${opnameNo(o.opname_no)}`;
    for (const l of lines) {
      const k = l.raw_material_id ? parseKey(`rm:${l.raw_material_id}`) : parseKey(`p:${l.product_id}`);
      const { rows: [row] } = await client.query(`SELECT stock_quantity, cost_per_unit FROM ${k.table} WHERE id = $1 FOR UPDATE`, [k.id]);
      const expected = num(row.stock_quantity);
      await client.query('UPDATE stock_opname_lines SET expected_qty = $1, unit_cost = $2 WHERE id = $3', [expected, row.cost_per_unit, l.id]);
      if (l.counted_qty == null) continue;
      const diff = r3(num(l.counted_qty) - expected);
      if (Math.abs(diff) < 1e-9) continue;
      await client.query(`UPDATE ${k.table} SET stock_quantity = $1 WHERE id = $2`, [num(l.counted_qty), k.id]);
      await client.query(
        `INSERT INTO ${k.ledger} (property_id, ${k.col}, change_qty, reason, reference_id, note, created_by) VALUES ($1, $2, $3, 'opname', $4, $5, $6)`,
        [propertyId, k.id, diff, id, note, user.id || null]);
    }
    await client.query(`UPDATE stock_opnames SET status = 'finished', finished_at = NOW(), finished_by = $1 WHERE id = $2`, [user.id || null, id]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  const opname = await getOpname(propertyId, id);
  sendOpnameReport(propertyId, opname).catch(err => console.error('[Stock] opname report failed:', err.message));
  return { opname };
}

// Telegram: the short summary; email: every item counted.
async function sendOpnameReport(propertyId, o) {
  const e = telegram.escapeHtml;
  const counted = o.lines.filter(l => l.counted != null);
  const diffs = counted.filter(l => l.difference).sort((a, b) => (a.difference_value || 0) - (b.difference_value || 0));
  const { rows: [ps] } = await db.query('SELECT property_name FROM property_settings WHERE property_id = $1', [propertyId]);
  const t = o.totals;
  const tg = [
    `📦 <b>Stock opname ${e(o.no_text)} finished</b> · ${e(dayText(o.count_date))}`,
    `${t.counted} of ${t.items} items counted · value on hand ${e(idr(t.counted_value))}`,
    `Difference <b>${e(signedIdr(t.difference_value))}</b> — ${t.short} short, ${t.over} over`,
    ...diffs.slice(0, 5).map(l => `• ${e(l.description)}: ${l.difference > 0 ? '+' : ''}${e(qtyText(l.difference, l.unit))}${l.difference_value != null ? ` (${e(signedIdr(l.difference_value))})` : ''}`),
    diffs.length > 5 ? `<i>…and ${diffs.length - 5} more — the full list is in the email and in Stock → Stock opname.</i>` : '',
    `<i>by ${e(o.finished_by_name || 'someone')}</i>`,
  ].filter(Boolean).join('\n');
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:11px;text-transform:uppercase;"';
  const td = (v, right, color) => `<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;${right ? 'text-align:right;' : ''}${color ? `color:${color};` : ''}">${v}</td>`;
  const rows = counted.map(l => `<tr>${td(e(l.description))}${td(e(qtyText(l.expected, l.unit)), true)}${td(e(qtyText(l.counted, l.unit)), true)}
    ${td(l.difference ? `${l.difference > 0 ? '+' : ''}${e(qtyText(l.difference, l.unit))}` : '—', true, l.difference < 0 ? '#b91c1c' : l.difference > 0 ? '#15803d' : '')}
    ${td(l.difference_value ? e(signedIdr(l.difference_value)) : '—', true, l.difference_value < 0 ? '#b91c1c' : '')}${td(l.counted_value != null ? e(idr(l.counted_value)) : '—', true)}</tr>`).join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;color:#111827;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Stock opname</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px;">${e(ps?.property_name || '')} — ${e(o.no_text)}</div>
    <div style="font-size:14px;color:#6b7280;margin-bottom:14px;">Counted ${e(dayText(o.count_date))} · finished by ${e(o.finished_by_name || '—')}</div>
    <div style="font-size:14px;margin-bottom:14px;">${t.counted} of ${t.items} items counted · value on hand <b>${e(idr(t.counted_value))}</b> ·
      difference <b style="color:${t.difference_value < 0 ? '#b91c1c' : '#111827'}">${e(signedIdr(t.difference_value))}</b> (${t.short} short, ${t.over} over)</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;"><tr><th ${th}>Item</th><th ${th}>Expected</th><th ${th}>Counted</th><th ${th}>Difference</th><th ${th}>Value</th><th ${th}>On hand</th></tr>${rows}</table>
    <div style="font-size:12px;color:#6b7280;margin-top:10px;">Difference = counted − what the PMS expected after every purchase, sale and adjustment; valued at each item's average cost. Items not counted were left as they were.</div>
  </div>`;
  const smart = require('./smartReports');   // lazy: smartReports loads many services
  await smart.sendEvent(propertyId, 'alert_stock_opname', {
    telegram: tg, email: { subject: `📦 Stock opname ${o.no_text} — difference ${signedIdr(t.difference_value)}`, html },
  });
}
const signedIdr = n => `${n < 0 ? '−' : n > 0 ? '+' : ''}${idr(Math.abs(n))}`;
const dayText = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ── Usage between two opnames ──
// from: a finished opname; to: a later finished opname, or null = until now.
async function usage(propertyId, fromId, toId = null) {
  if (!UUID_RE.test(String(fromId || ''))) return fail(400, 'Choose a finished stock opname to start from');
  if (toId && !UUID_RE.test(String(toId))) return fail(400, 'Choose a finished stock opname to end on');
  const { rows: [a] } = await db.query(
    `SELECT id, opname_no, finished_at, to_char(count_date, 'YYYY-MM-DD') AS count_date FROM stock_opnames
     WHERE id = $1 AND property_id = $2 AND status = 'finished'`, [fromId, propertyId]);
  if (!a) return fail(400, 'Choose a finished stock opname to start from');
  let b = null;
  if (toId) {
    ({ rows: [b] } = await db.query(
      `SELECT id, opname_no, finished_at, to_char(count_date, 'YYYY-MM-DD') AS count_date FROM stock_opnames
       WHERE id = $1 AND property_id = $2 AND status = 'finished'`, [toId, propertyId]));
    if (!b) return fail(400, 'Choose a finished stock opname to end on');
    if (new Date(b.finished_at) <= new Date(a.finished_at)) return fail(400, 'The end must be a later stock opname');
  }
  // Compared inside the database: JavaScript dates drop the microseconds.
  const startSql = '(SELECT finished_at FROM stock_opnames WHERE id = $2)';
  const afterEnd = b ? 'created_at > (SELECT finished_at FROM stock_opnames WHERE id = $3)' : 'false';
  const params = b ? [propertyId, a.id, b.id] : [propertyId, a.id];
  const items = await listItems(propertyId, { inactive: true });
  const byKey = new Map(items.map(i => [i.key, { ...i, opening: i.on_hand, closing: i.on_hand,
    bought: 0, sold: 0, used: 0, waste: 0, correction: 0, opname: 0 }]));
  // Every movement after the start: undo it to get the opening; after the end
  // also undo it for the closing. Movements in between fill the columns.
  const [{ rows: rm }, { rows: pm }] = await Promise.all([
    db.query(`SELECT 'rm:' || raw_material_id AS key, change_qty, reason, purchase_order_id, reference_id, ${afterEnd} AS after_end
              FROM raw_material_movements WHERE property_id = $1 AND created_at > ${startSql}`, params),
    db.query(`SELECT 'p:' || product_id AS key, change_qty, reason, purchase_order_id, reference_id, ${afterEnd} AS after_end
              FROM stock_movements WHERE property_id = $1 AND created_at > ${startSql}`, params),
  ]);
  for (const m of [...rm, ...pm]) {
    const it = byKey.get(m.key);
    if (!it) continue;
    const q = num(m.change_qty);
    it.opening -= q;
    if (m.after_end) { it.closing -= q; continue; }
    const bucket = bucketOf(m);
    // Out-going columns are shown as positive amounts used up.
    if (bucket === 'bought') it.bought += q;
    else if (bucket === 'sold') it.sold -= q;
    else if (bucket === 'used') it.used -= q;
    else if (bucket === 'waste') it.waste -= q;
    else if (bucket === 'opname') it.opname += q;
    else it.correction += q;
  }
  const rows = [...byKey.values()].map(i => {
    const usedTotal = r3(i.opening + i.bought - i.closing);
    const cost = i.avg_cost;
    const v = q => (cost != null ? r2(q * cost) : null);
    return {
      key: i.key, name: i.name, unit: i.unit, kind_label: i.kind_label, category_label: i.category_label, avg_cost: cost,
      opening: r3(i.opening), bought: r3(i.bought), sold: r3(i.sold), used: r3(i.used), waste: r3(i.waste),
      correction: r3(i.correction), opname: r3(i.opname), closing: r3(i.closing), used_total: usedTotal,
      value: { used_total: v(usedTotal), sold: v(i.sold), used: v(i.used), waste: v(i.waste), opname: v(i.opname), closing: v(i.closing) },
    };
  }).filter(r => r.opening || r.bought || r.sold || r.used || r.waste || r.correction || r.opname || r.closing);
  rows.sort((x, y) => x.category_label.localeCompare(y.category_label) || x.name.localeCompare(y.name));
  const categories = new Map();
  for (const r of rows) {
    const c = categories.get(r.category_label) || { category_label: r.category_label, items: 0, used_total: 0, sold: 0, used: 0, waste: 0, opname: 0, closing: 0 };
    c.items++;
    for (const f of ['used_total', 'sold', 'used', 'waste', 'opname', 'closing']) c[f] = r2(c[f] + (r.value[f] || 0));
    categories.set(r.category_label, c);
  }
  const cats = [...categories.values()];
  const sum = f => r2(cats.reduce((t, c) => t + c[f], 0));
  return {
    from: { id: a.id, no_text: opnameNo(a.opname_no), count_date: a.count_date, finished_at: a.finished_at },
    to: b ? { id: b.id, no_text: opnameNo(b.opname_no), count_date: b.count_date, finished_at: b.finished_at } : null,
    rows, categories: cats,
    totals: { used_total: sum('used_total'), sold: sum('sold'), used: sum('used'), waste: sum('waste'), opname: sum('opname'), closing: sum('closing') },
    uncosted: rows.filter(r => r.avg_cost == null).length,
  };
}

module.exports = {
  REASON_LABEL, WRITEOFF_DEFAULT, parseKey, listItems, getItem, saveStockItem, history, adjust,
  writeoffSettings, saveWriteoffSettings, listOpnames, getOpname, startOpname, saveCounts, cancelOpname, finishOpname, usage, opnameNo,
};
