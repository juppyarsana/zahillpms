// Moving stock between stores (migration 157, STORES_PLAN.md step 2).
//
//   send     — items leave the sending store at once and sit in the hidden
//              "on the way" store (storeService.transitStoreId).
//   confirm  — the receiving store says what arrived; that goes into it, and
//              anything short goes back to the sending store (most often a
//              miscount when sending; a real loss shows at the next opname).
//   cancel   — only while not confirmed: everything goes back.
//
// Every step is movements (reason 'transfer', reference_id = the transfer)
// between stores, so the item's total never changes. PMS stores only for now;
// Kitchen / Resto (POS) come in step 3.
const db = require('../db');
const telegram = require('./telegramService');
const storeSvc = require('./storeService');

const num = v => parseFloat(v) || 0;
const r3 = v => Math.round(v * 1000) / 1000;
const fail = (status, error, code) => ({ status, error, code });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const transferNo = n => `TR-${String(n).padStart(4, '0')}`;
const qtyText = (q, unit) => `${+num(q).toFixed(3)}${unit ? ' ' + unit : ''}`;
const MAX_LINES = 100;

function itemKey(key) {
  const m = /^(rm|p):(.+)$/.exec(String(key || ''));
  if (!m || !UUID_RE.test(m[2])) return null;
  return m[1] === 'rm' ? { kind: 'rm', id: m[2], table: 'raw_materials', ledger: 'raw_material_movements', col: 'raw_material_id' }
    : { kind: 'p', id: m[2], table: 'products', ledger: 'stock_movements', col: 'product_id' };
}
const lineKey = l => (l.raw_material_id ? itemKey(`rm:${l.raw_material_id}`) : itemKey(`p:${l.product_id}`));

async function move(client, propertyId, k, storeId, qty, transferId, note, userId) {
  if (Math.abs(qty) < 1e-9) return;
  await client.query(
    `INSERT INTO ${k.ledger} (property_id, ${k.col}, change_qty, reason, reference_id, note, created_by, store_id)
     VALUES ($1, $2, $3, 'transfer', $4, $5, $6, $7)`, [propertyId, k.id, qty, transferId, note, userId || null, storeId]);
}

// ── Reading ──
const COLS = `t.id, t.transfer_no, t.status, t.note, t.sent_at, t.confirmed_at, t.cancelled_at, t.cancel_reason,
  t.from_store_id, fs.name AS from_store, t.to_store_id, ts.name AS to_store,
  su.name AS sent_by_name, cu.name AS confirmed_by_name, xu.name AS cancelled_by_name`;
const FROM = `FROM stock_transfers t JOIN stores fs ON fs.id = t.from_store_id JOIN stores ts ON ts.id = t.to_store_id
  LEFT JOIN users su ON su.id = t.sent_by LEFT JOIN users cu ON cu.id = t.confirmed_by LEFT JOIN users xu ON xu.id = t.cancelled_by`;

function shapeLine(l) {
  const sent = num(l.sent_qty);
  const accepted = l.accepted_qty != null ? num(l.accepted_qty) : null;
  const cost = l.unit_cost != null ? num(l.unit_cost) : null;
  return {
    id: l.id, key: l.raw_material_id ? `rm:${l.raw_material_id}` : `p:${l.product_id}`, kind: l.raw_material_id ? 'rm' : 'p',
    description: l.description, unit: l.unit, sent, accepted, short: accepted != null ? r3(sent - accepted) : null,
    note: l.note, unit_cost: cost, value: cost != null ? Math.round(sent * cost * 100) / 100 : null,
  };
}
function shape(t, lines) {
  const ls = lines.map(shapeLine);
  return {
    ...t, no_text: transferNo(t.transfer_no), lines: ls,
    items: ls.length, value: Math.round(ls.reduce((s, l) => s + (l.value || 0), 0) * 100) / 100,
    short_lines: ls.filter(l => l.short > 0).length,
  };
}

async function list(propertyId, { status = 'open', storeId = null } = {}) {
  const where = ['t.property_id = $1'];
  const params = [propertyId];
  if (status === 'open') where.push(`t.status = 'sent'`);
  else if (status === 'done') where.push(`t.status <> 'sent'`);
  if (storeId && UUID_RE.test(String(storeId))) { params.push(storeId); where.push(`(t.from_store_id = $${params.length} OR t.to_store_id = $${params.length})`); }
  const { rows } = await db.query(
    `SELECT ${COLS} ${FROM} WHERE ${where.join(' AND ')} ORDER BY (t.status = 'sent') DESC, t.transfer_no DESC LIMIT 200`, params);
  if (!rows.length) return [];
  const { rows: lines } = await db.query(
    'SELECT * FROM stock_transfer_lines WHERE transfer_id = ANY($1) ORDER BY lower(description)', [rows.map(r => r.id)]);
  return rows.map(t => shape(t, lines.filter(l => l.transfer_id === t.id)));
}

async function get(propertyId, id, q = db) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows: [t] } = await q.query(`SELECT ${COLS} ${FROM} WHERE t.id = $1 AND t.property_id = $2`, [id, propertyId]);
  if (!t) return null;
  const { rows: lines } = await q.query('SELECT * FROM stock_transfer_lines WHERE transfer_id = $1 ORDER BY lower(description)', [id]);
  return shape(t, lines);
}

async function openCount(propertyId) {
  const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS n FROM stock_transfers WHERE property_id = $1 AND status = 'sent'`, [propertyId]);
  return r.n;
}

// ── Send ──
// { from_store_id, to_store_id, note, lines: [{ key: 'rm:<id>' | 'p:<id>', quantity }] }
async function create(propertyId, body, user) {
  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (!raw.length) return fail(400, 'Add at least one item');
  if (raw.length > MAX_LINES) return fail(400, `At most ${MAX_LINES} lines`);
  const wanted = new Map();
  for (const l of raw) {
    const k = itemKey(l.key);
    if (!k) return fail(400, 'Choose the item on every line');
    const qty = Number(l.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty >= 1e7) return fail(400, 'Every line needs how many');
    if (k.kind === 'p' && !Number.isInteger(qty)) return fail(400, 'Sales items are counted in whole units');
    if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) return fail(400, 'At most 3 decimals');
    const key = `${k.kind}:${k.id}`;
    wanted.set(key, { k, qty: r3((wanted.get(key)?.qty || 0) + qty) });   // the same item twice = one line
  }
  const note = String(body.note || '').trim().slice(0, 1000) || null;
  const client = await db.pool.connect();
  let transfer;
  try {
    await client.query('BEGIN');
    const a = await storeSvc.pmsStore(propertyId, body.from_store_id, client);
    if (a.error) { await client.query('ROLLBACK'); return a; }
    if (!body.to_store_id) { await client.query('ROLLBACK'); return fail(400, 'Choose where it goes'); }
    const b = await storeSvc.pmsStore(propertyId, body.to_store_id, client);
    if (b.error) { await client.query('ROLLBACK'); return b; }
    const from = a.store; const to = b.store;
    if (from.id === to.id) { await client.query('ROLLBACK'); return fail(400, 'Choose two different stores'); }
    const transit = await storeSvc.transitStoreId(propertyId, client);

    // Lock the items (in a fixed order, so two transfers can't deadlock) and
    // check the sending store has enough of each.
    const lines = [];
    for (const { k, qty } of [...wanted.values()].sort((x, y) => (x.k.id < y.k.id ? -1 : 1))) {
      const { rows: [row] } = await client.query(
        `SELECT name, ${k.kind === 'rm' ? 'unit_of_measure' : `'pcs'`} AS unit, cost_per_unit FROM ${k.table} WHERE id = $1 AND property_id = $2 FOR UPDATE`,
        [k.id, propertyId]);
      if (!row) { await client.query('ROLLBACK'); return fail(400, 'An item was not found'); }
      const have = await storeSvc.storeQty(client, from.id, k.kind, k.id);
      if (have + 1e-9 < qty) {
        await client.query('ROLLBACK');
        return fail(400, `Only ${qtyText(have, row.unit)} of ${row.name} in ${from.name}`, 'NOT_ENOUGH');
      }
      lines.push({ k, qty, row });
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stock_transfer:${propertyId}`]);
    const { rows: [n] } = await client.query('SELECT COALESCE(MAX(transfer_no), 0) + 1 AS no FROM stock_transfers WHERE property_id = $1', [propertyId]);
    const { rows: [t] } = await client.query(
      `INSERT INTO stock_transfers (property_id, transfer_no, from_store_id, to_store_id, note, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [propertyId, n.no, from.id, to.id, note, user.id || null]);
    const text = `${transferNo(n.no)} ${from.name} → ${to.name}`;
    for (const { k, qty, row } of lines) {
      await client.query(
        `INSERT INTO stock_transfer_lines (transfer_id, raw_material_id, product_id, description, unit, sent_qty, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [t.id, k.kind === 'rm' ? k.id : null, k.kind === 'p' ? k.id : null, row.name, row.unit, qty, row.cost_per_unit]);
      await move(client, propertyId, k, from.id, -qty, t.id, `${text} — sent`, user.id);
      await move(client, propertyId, k, transit, qty, t.id, `${text} — on the way`, user.id);
    }
    await client.query('COMMIT');
    transfer = await get(propertyId, t.id);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  alertSent(propertyId, transfer, user).catch(() => {});
  return { transfer };
}

// ── Confirm ──
// { lines: [{ line_id, accepted, note }] } — a line left out = all of it arrived.
async function confirm(propertyId, id, body, user) {
  if (!UUID_RE.test(String(id))) return fail(404, 'Transfer not found');
  const given = new Map((Array.isArray(body.lines) ? body.lines : []).map(l => [String(l.line_id), l]));
  const client = await db.pool.connect();
  let transfer;
  try {
    await client.query('BEGIN');
    const { rows: [t] } = await client.query(
      `SELECT t.*, fs.name AS from_name, ts.name AS to_name FROM stock_transfers t
       JOIN stores fs ON fs.id = t.from_store_id JOIN stores ts ON ts.id = t.to_store_id
       WHERE t.id = $1 AND t.property_id = $2 FOR UPDATE OF t`, [id, propertyId]);
    if (!t) { await client.query('ROLLBACK'); return fail(404, 'Transfer not found'); }
    if (t.status !== 'sent') { await client.query('ROLLBACK'); return fail(409, `${transferNo(t.transfer_no)} is already ${t.status}`, 'NOT_OPEN'); }
    const transit = await storeSvc.transitStoreId(propertyId, client);
    const { rows: lines } = await client.query('SELECT * FROM stock_transfer_lines WHERE transfer_id = $1 ORDER BY raw_material_id, product_id', [id]);
    const text = `${transferNo(t.transfer_no)} ${t.from_name} → ${t.to_name}`;
    for (const l of lines) {
      const k = lineKey(l);
      const sent = num(l.sent_qty);
      const g = given.get(l.id);
      const accepted = g && g.accepted !== '' && g.accepted != null ? Number(g.accepted) : sent;
      if (!Number.isFinite(accepted) || accepted < 0 || accepted > sent + 1e-9) {
        await client.query('ROLLBACK');
        return fail(400, `${l.description}: what arrived must be between 0 and ${qtyText(sent, l.unit)}`);
      }
      if (k.kind === 'p' && !Number.isInteger(accepted)) { await client.query('ROLLBACK'); return fail(400, `${l.description}: whole units only`); }
      const short = r3(sent - accepted);
      const why = String(g?.note || '').trim().slice(0, 500);
      if (short > 0 && !why) {
        await client.query('ROLLBACK');
        return fail(400, `${l.description}: say why less arrived`, 'REASON_REQUIRED');
      }
      await client.query(`SELECT 1 FROM ${k.table} WHERE id = $1 FOR UPDATE`, [k.id]);
      await client.query('UPDATE stock_transfer_lines SET accepted_qty = $1, note = $2 WHERE id = $3', [accepted, why || null, l.id]);
      await move(client, propertyId, k, transit, -sent, id, `${text} — arrived`, user.id);
      await move(client, propertyId, k, t.to_store_id, accepted, id, `${text} — received`, user.id);
      await move(client, propertyId, k, t.from_store_id, short, id, `${text} — ${qtyText(short, l.unit)} did not arrive, back here: ${why}`, user.id);
    }
    await client.query(`UPDATE stock_transfers SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1 WHERE id = $2`, [user.id || null, id]);
    await client.query('COMMIT');
    transfer = await get(propertyId, id);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  if (transfer.short_lines) alertShort(propertyId, transfer, user).catch(() => {});
  return { transfer };
}

// ── Cancel ── (sender's side: nothing confirmed yet, everything goes back)
async function cancel(propertyId, id, reason, user) {
  if (!UUID_RE.test(String(id))) return fail(404, 'Transfer not found');
  const why = String(reason || '').trim().slice(0, 500);
  if (!why) return fail(400, 'Say why it is cancelled', 'REASON_REQUIRED');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [t] } = await client.query(
      `SELECT t.*, fs.name AS from_name, ts.name AS to_name FROM stock_transfers t
       JOIN stores fs ON fs.id = t.from_store_id JOIN stores ts ON ts.id = t.to_store_id
       WHERE t.id = $1 AND t.property_id = $2 FOR UPDATE OF t`, [id, propertyId]);
    if (!t) { await client.query('ROLLBACK'); return fail(404, 'Transfer not found'); }
    if (t.status !== 'sent') { await client.query('ROLLBACK'); return fail(409, `${transferNo(t.transfer_no)} is already ${t.status}`, 'NOT_OPEN'); }
    const transit = await storeSvc.transitStoreId(propertyId, client);
    const { rows: lines } = await client.query('SELECT * FROM stock_transfer_lines WHERE transfer_id = $1 ORDER BY raw_material_id, product_id', [id]);
    const text = `${transferNo(t.transfer_no)} ${t.from_name} → ${t.to_name} cancelled: ${why}`;
    for (const l of lines) {
      const k = lineKey(l);
      await client.query(`SELECT 1 FROM ${k.table} WHERE id = $1 FOR UPDATE`, [k.id]);
      await move(client, propertyId, k, transit, -num(l.sent_qty), id, text, user.id);
      await move(client, propertyId, k, t.from_store_id, num(l.sent_qty), id, text, user.id);
    }
    await client.query(
      `UPDATE stock_transfers SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancel_reason = $2 WHERE id = $3`,
      [user.id || null, why, id]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  return { transfer: await get(propertyId, id) };
}

// ── Telegram (alert_store_transfer) ──
function linesText(t, e, field = 'sent') {
  const shown = t.lines.slice(0, 15).map(l => `• ${e(l.description)} ×${e(qtyText(l[field], l.unit))}`);
  if (t.lines.length > 15) shown.push(`<i>…and ${t.lines.length - 15} more</i>`);
  return shown;
}
async function alertSent(propertyId, t, user) {
  const e = telegram.escapeHtml;
  await telegram.sendAlert(propertyId, 'alert_store_transfer', [
    `📦 <b>${e(t.no_text)}: ${e(t.from_store)} → ${e(t.to_store)}</b>`,
    ...linesText(t, e),
    t.note ? `Note: ${e(t.note)}` : '',
    `${e(t.to_store)}: confirm what arrived in Stock → Transfers.`,
    `<i>sent by ${e(user.name || 'someone')}</i>`,
  ].filter(Boolean).join('\n'), { html: true });
}
async function alertShort(propertyId, t, user) {
  const e = telegram.escapeHtml;
  const short = t.lines.filter(l => l.short > 0);
  await telegram.sendAlert(propertyId, 'alert_store_transfer', [
    `⚠️ <b>${e(t.no_text)}: less arrived in ${e(t.to_store)}</b>`,
    ...short.map(l => `• ${e(l.description)}: ${e(qtyText(l.accepted, l.unit))} of ${e(qtyText(l.sent, l.unit))} — ${e(l.note || '')}`),
    `The rest is back in ${e(t.from_store)}.`,
    `<i>confirmed by ${e(user.name || 'someone')}</i>`,
  ].join('\n'), { html: true });
}

module.exports = { list, get, openCount, create, confirm, cancel, transferNo };
