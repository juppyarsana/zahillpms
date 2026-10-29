// Purchase requests (migration 144): a department asks for what it needs,
// hotel purchasing orders it on a normal purchase order.
//
// Two ways in: hotel departments from the PMS (routes/purchaseRequests.js),
// the restaurant from its POS (routes/posIntegration.js, POS key) because its
// stock lives there. A request line names a PMS stock item ('rm:<id>'), a
// Sales item kept in stock ('p:<id>'), a POS inventory item (pos_item_id) or
// free text. One approval only — the PO's own. Receiving stays on the PO;
// a request is "done" once everything asked for has come in, or when
// purchasing closes it. Its progress is read from the PO lines that point at
// its lines (purchase_order_items.request_line_id), never stored.
const db = require('../db');
const telegram = require('./telegramService');
const stock = require('./stockService');
const { DEPARTMENT_KEYS, DEPARTMENT_LABEL } = require('./costCategories');

const num = v => parseFloat(v) || 0;
const r3 = v => Math.round(v * 1000) / 1000;
const fail = (status, error, code) => ({ status, error, code });
const requestNo = n => `PR-${String(n).padStart(4, '0')}`;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const clip = (s, n) => String(s || '').trim().slice(0, n);
const MAX_LINES = 50;

const PROGRESS_LABEL = {
  waiting: 'Waiting', partly_ordered: 'Partly ordered', ordered: 'Ordered', partly_received: 'Partly received',
  received: 'Received', closed: 'Closed', declined: 'Declined', cancelled: 'Cancelled',
};

// lines: [{ item_key? | pos_item_id?, description, unit, quantity, note, stock? }]
async function parseLines(client, propertyId, lines, { source }) {
  if (!Array.isArray(lines) || !lines.length) return fail(400, 'Add at least one item');
  if (lines.length > MAX_LINES) return fail(400, `At most ${MAX_LINES} items in one request`);
  const out = [];
  for (const [i, l] of lines.entries()) {
    const qty = r3(num(l.quantity));
    if (!(qty > 0)) return fail(400, 'Every item needs a quantity above 0');
    const note = clip(l.note, 300) || null;
    if (l.item_key) {
      if (source === 'pos') return fail(400, 'The restaurant asks for its own items');
      const item = await stock.getItem(propertyId, l.item_key, client);
      if (!item) return fail(400, 'An item was not found in Stock');
      out.push({ raw_material_id: item.kind === 'rm' ? item.id : null, product_id: item.kind === 'p' ? item.id : null,
        pos_item_id: null, description: item.name, unit: item.unit, quantity: item.kind === 'p' ? Math.ceil(qty) : qty,
        stock_when_asked: item.on_hand, note, sort_order: i });
      continue;
    }
    const description = clip(l.description, 255);
    if (!description) return fail(400, 'Every item needs a name');
    const posId = l.pos_item_id ? clip(l.pos_item_id, 64) : null;
    const stockNow = l.stock != null && Number.isFinite(Number(l.stock)) ? r3(Number(l.stock)) : null;
    out.push({ raw_material_id: null, product_id: null, pos_item_id: posId, description,
      unit: clip(l.unit, 20) || null, quantity: qty, stock_when_asked: posId ? stockNow : null, note, sort_order: i });
  }
  return { lines: out };
}

// actor: { userId?, name, source: 'pms' | 'pos' }
async function create(propertyId, body, actor) {
  const source = actor.source === 'pos' ? 'pos' : 'pms';
  const department = source === 'pos' ? 'fnb' : body.department;
  if (!DEPARTMENT_KEYS.includes(department)) return fail(400, 'Choose the department');
  if (body.needed_by && !isDate(body.needed_by)) return fail(400, 'Needed by must be a date');
  const clientRef = body.client_ref ? clip(body.client_ref, 80) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (clientRef) {
      const { rows: [had] } = await client.query(
        'SELECT id FROM purchase_requests WHERE property_id = $1 AND client_ref = $2', [propertyId, clientRef]);
      if (had) { await client.query('ROLLBACK'); return { request: await get(propertyId, had.id), replayed: true }; }
    }
    const parsed = await parseLines(client, propertyId, body.lines, { source });
    if (parsed.error) { await client.query('ROLLBACK'); return parsed; }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr-no:${propertyId}`]);
    const { rows: [{ n }] } = await client.query(
      'SELECT COALESCE(MAX(request_no), 0) + 1 AS n FROM purchase_requests WHERE property_id = $1', [propertyId]);
    const { rows: [pr] } = await client.query(
      `INSERT INTO purchase_requests (property_id, request_no, department, source, needed_by, note, requested_by, requested_by_name, client_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [propertyId, n, department, source, body.needed_by || null, clip(body.note, 1000) || null,
       actor.userId || null, clip(actor.name, 120) || null, clientRef]);
    for (const l of parsed.lines) {
      await client.query(
        `INSERT INTO purchase_request_lines (request_id, raw_material_id, product_id, pos_item_id, description, unit, quantity, stock_when_asked, note, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [pr.id, l.raw_material_id, l.product_id, l.pos_item_id, l.description, l.unit, l.quantity, l.stock_when_asked, l.note, l.sort_order]);
    }
    await client.query('COMMIT');
    const request = await get(propertyId, pr.id);
    alertNew(propertyId, request).catch(err => console.error('[purchase request alert]', err.message));
    return { request, replayed: false };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && clientRef) return { request: await getByRef(propertyId, clientRef), replayed: true };
    throw err;
  } finally {
    client.release();
  }
}

async function getByRef(propertyId, ref) {
  const { rows: [r] } = await db.query('SELECT id FROM purchase_requests WHERE property_id = $1 AND client_ref = $2', [propertyId, ref]);
  return r ? get(propertyId, r.id) : null;
}

const LIST_SQL = `
  SELECT r.*, u.name AS user_name, cu.name AS closed_by_user
  FROM purchase_requests r
  LEFT JOIN users u ON u.id = r.requested_by
  LEFT JOIN users cu ON cu.id = r.closed_by`;

const LINES_SQL = `
  SELECT l.*, COALESCE(rm.unit_of_measure, l.unit, CASE WHEN l.product_id IS NOT NULL THEN 'pcs' END) AS unit_text,
         COALESCE(SUM(i.quantity) FILTER (WHERE po.status <> 'cancelled'), 0) AS ordered_qty,
         COALESCE(SUM(i.received_quantity) FILTER (WHERE po.status <> 'cancelled'), 0) AS received_qty,
         COALESCE(json_agg(json_build_object('po_id', po.id, 'po_number', po.po_number, 'status', po.status,
           'quantity', i.quantity, 'received', i.received_quantity))
           FILTER (WHERE po.id IS NOT NULL AND po.status <> 'cancelled'), '[]') AS orders
  FROM purchase_request_lines l
  LEFT JOIN raw_materials rm ON rm.id = l.raw_material_id
  LEFT JOIN purchase_order_items i ON i.request_line_id = l.id
  LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
  WHERE l.request_id = ANY($1::uuid[])
  GROUP BY l.id, rm.unit_of_measure
  ORDER BY l.sort_order, l.description`;

function kindOf(l) {
  return l.raw_material_id ? 'rm' : l.product_id ? 'p' : l.pos_item_id ? 'pos' : 'text';
}

function shape(r, lines) {
  const ls = lines.map(l => {
    const quantity = num(l.quantity);
    return {
      id: l.id, kind: kindOf(l), item_key: l.raw_material_id ? `rm:${l.raw_material_id}` : l.product_id ? `p:${l.product_id}` : null,
      raw_material_id: l.raw_material_id, product_id: l.product_id, pos_item_id: l.pos_item_id,
      description: l.description, unit: l.unit_text || null, quantity,
      stock_when_asked: l.stock_when_asked != null ? num(l.stock_when_asked) : null, note: l.note,
      ordered_qty: num(l.ordered_qty), received_qty: num(l.received_qty), orders: l.orders || [],
      left_to_order: r3(Math.max(0, quantity - num(l.ordered_qty))),
    };
  });
  let progress;
  if (r.status === 'declined' || r.status === 'cancelled') progress = r.status;
  else if (r.status === 'done') progress = ls.every(l => l.received_qty >= l.quantity) ? 'received' : 'closed';
  else if (ls.some(l => l.received_qty > 0)) progress = 'partly_received';
  else if (ls.every(l => l.ordered_qty >= l.quantity)) progress = 'ordered';
  else if (ls.some(l => l.ordered_qty > 0)) progress = 'partly_ordered';
  else progress = 'waiting';
  return {
    id: r.id, request_no: r.request_no, request_no_text: requestNo(r.request_no),
    department: r.department, department_label: DEPARTMENT_LABEL[r.department] || r.department,
    source: r.source, source_label: r.source === 'pos' ? 'Restaurant (POS)' : 'PMS',
    needed_by: r.needed_by, note: r.note, status: r.status, progress, progress_label: PROGRESS_LABEL[progress],
    requested_by: r.requested_by, requested_by_name: r.user_name || r.requested_by_name || '—',
    closed_by_name: r.closed_by_user || r.closed_by_name || null, closed_at: r.closed_at, close_reason: r.close_reason,
    created_at: r.created_at, lines: ls,
  };
}

async function withLines(rows) {
  if (!rows.length) return [];
  const { rows: lines } = await db.query(LINES_SQL, [rows.map(r => r.id)]);
  const by = new Map(rows.map(r => [r.id, []]));
  for (const l of lines) by.get(l.request_id).push(l);
  return rows.map(r => shape(r, by.get(r.id)));
}

async function get(propertyId, id) {
  const { rows } = await db.query(`${LIST_SQL} WHERE r.property_id = $1 AND r.id = $2`, [propertyId, id]);
  return (await withLines(rows))[0] || null;
}

// show: 'open' (default) | 'closed' | 'all'; source: 'pos' for the POS's own list
async function list(propertyId, { show = 'open', source, department, days } = {}) {
  const where = ['r.property_id = $1'];
  const P = [propertyId];
  if (show === 'open') where.push("r.status = 'open'");
  else if (show === 'closed') where.push("r.status <> 'open'");
  if (source) { P.push(source); where.push(`r.source = $${P.length}`); }
  if (department && DEPARTMENT_KEYS.includes(department)) { P.push(department); where.push(`r.department = $${P.length}`); }
  if (days) { P.push(Math.min(366, Math.max(1, parseInt(days, 10) || 60))); where.push(`(r.status = 'open' OR r.created_at > NOW() - make_interval(days => $${P.length}))`); }
  const { rows } = await db.query(
    `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY (r.status = 'open') DESC, r.needed_by NULLS LAST, r.created_at DESC LIMIT 300`, P);
  return withLines(rows);
}

// Cancel (the requester, or purchasing), decline (purchasing, with a reason),
// close (purchasing: done although something was not bought — reason).
async function closeRequest(propertyId, id, kind, { reason, userId, name }) {
  const why = clip(reason, 500);
  if ((kind === 'declined' || kind === 'done') && !why) return fail(400, 'Say why');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [r] } = await client.query(
      'SELECT id, status FROM purchase_requests WHERE id = $1 AND property_id = $2 FOR UPDATE', [id, propertyId]);
    if (!r) { await client.query('ROLLBACK'); return fail(404, 'Request not found'); }
    if (r.status !== 'open') { await client.query('ROLLBACK'); return fail(409, 'This request is already closed', 'NOT_OPEN'); }
    if (kind !== 'done') {
      const { rows: [o] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM purchase_request_lines l
         JOIN purchase_order_items i ON i.request_line_id = l.id
         JOIN purchase_orders po ON po.id = i.purchase_order_id AND po.status <> 'cancelled'
         WHERE l.request_id = $1`, [id]);
      if (o.n) {
        await client.query('ROLLBACK');
        return fail(409, 'Something on this request is already on a purchase order — cancel that PO first, or close the request', 'ORDERED');
      }
    }
    await client.query(
      `UPDATE purchase_requests SET status = $2, closed_by = $3, closed_by_name = $4, closed_at = NOW(), close_reason = $5 WHERE id = $1`,
      [id, kind, userId || null, clip(name, 120) || null, why || null]);
    await client.query('COMMIT');
    return { request: await get(propertyId, id) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// After PO lines are received: a request whose every line has come in is done.
async function refreshAfterReceive(client, poId) {
  await client.query(
    `UPDATE purchase_requests r SET status = 'done', closed_at = NOW()
     WHERE r.status = 'open'
       AND r.id IN (SELECT l.request_id FROM purchase_order_items i JOIN purchase_request_lines l ON l.id = i.request_line_id
                    WHERE i.purchase_order_id = $1)
       AND NOT EXISTS (
         SELECT 1 FROM purchase_request_lines l
         WHERE l.request_id = r.id
           AND l.quantity > COALESCE((SELECT SUM(i.received_quantity) FROM purchase_order_items i
                                      JOIN purchase_orders po ON po.id = i.purchase_order_id AND po.status <> 'cancelled'
                                      WHERE i.request_line_id = l.id), 0))`, [poId]);
}

// A PO line pointing at a request line: the line must be on an open request of this property.
async function checkRequestLine(client, propertyId, lineId) {
  const { rows: [l] } = await client.query(
    `SELECT l.id, r.department FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
     WHERE l.id = $1 AND r.property_id = $2 AND r.status = 'open'`, [lineId, propertyId]);
  return l || null;
}

async function alertNew(propertyId, r) {
  const h = telegram.escapeHtml;
  const lines = r.lines.slice(0, 15).map(l =>
    `• ${h(l.description)} — ${l.quantity}${l.unit ? ' ' + h(l.unit) : ''}${l.stock_when_asked != null ? ` <i>(${l.stock_when_asked} left)</i>` : ''}`);
  if (r.lines.length > 15) lines.push(`• … and ${r.lines.length - 15} more`);
  const msg = [
    [`🛒 <b>Purchase request ${r.request_no_text} — ${h(r.department_label)}</b>`,
     `<i>by ${h(r.requested_by_name)}${r.source === 'pos' ? ' (restaurant app)' : ''}${r.needed_by ? ` · needed by ${r.needed_by}` : ''}</i>`],
    lines,
    r.note ? [`📝 ${h(r.note)}`] : [],
  ].filter(s => s.length).map(s => s.join('\n')).join('\n\n');
  await telegram.sendAlert(propertyId, 'alert_purchase_request', msg, { html: true });
}

module.exports = { requestNo, create, get, list, closeRequest, refreshAfterReceive, checkRequestLine, PROGRESS_LABEL };
