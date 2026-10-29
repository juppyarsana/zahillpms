// Buy without a PO (migration 135, accounting's request 2026-10-23).
//
// Stock bought at the market or a shop, with no purchase order. One save:
//   - the stock goes up and its average cost is blended in, exactly as
//     receiving a PO does (purchasingService.addStock)
//   - the money is recorded with it:
//       paid already → an expense row (Finance → Expenses), tied to it by
//                      expenses.purchase_order_id
//       pay later    → a supplier bill (Finance → Payables, createBillTx)
//     — so the journal, Reports and the cashier closing need nothing new
//   - it is kept as a purchase order that is already received, marked
//     is_direct, so it shows in the PO list and the stock history.
// A mistake is voided here, never in Expenses / Payables (they refuse), so
// the stock always follows: the stock comes back out, the expense / bill is
// voided. Refused when the stock has been used below the amount bought, or
// when something is already paid on its bill.
//
// Telegram alert_direct_purchase (free, owner by default) only for the
// exceptions — a big purchase, a price well above the item's average cost, a
// purchase dated well in the past or on a closed accounting day — and voids.
// Every purchase is counted in the Daily Close (dailyClose.directPurchases).
//
// Restaurant goods (a POS inventory item, `pos_item_id`) are not PMS stock:
// after the save they are sent to the POS as a purchase batch, exactly like a
// received PO line (posPurchases.sendToPos — retry-safe, "Send to the POS"
// when it was down). Such a purchase can't be voided once the POS has the
// goods: the POS stock is corrected there (stock opname).
const db = require('../db');
const posPurchases = require('./posPurchases');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');
const { addStock, logEvent, nextPoNumber } = require('./purchasingService');
const { createBillTx } = require('./payablesService');
const { COST_CATEGORIES, CATEGORY_KEYS, CATEGORY_LABEL, DEPARTMENTS, DEPARTMENT_KEYS, departmentFor } = require('./costCategories');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = d => DAY_RE.test(d || '') && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const num = v => parseFloat(v) || 0;
const r2 = v => Math.round(v * 100) / 100;
const fail = (status, error, code) => ({ status, error, code });
const MAX_LINES = 50;

// The alert's amounts — Settings → Notifications (property_settings.direct_purchase_alerts).
const ALERT_DEFAULTS = { amount: 2000000, price_pct: 20, days: 7 };

async function alertSettings(propertyId, q = db) {
  const { rows: [r] } = await q.query('SELECT direct_purchase_alerts AS a FROM property_settings WHERE property_id = $1', [propertyId]);
  return { ...ALERT_DEFAULTS, ...(r?.a || {}) };
}

// amount / price_pct / days: a whole number ≥ 0, 0 = that check is off.
async function saveAlertSettings(propertyId, body) {
  const out = {};
  for (const [k, max] of [['amount', 1e12], ['price_pct', 1000], ['days', 366]]) {
    const v = Number(body[k]);
    if (!Number.isInteger(v) || v < 0 || v > max) return fail(400, 'Enter whole numbers, 0 or more');
    out[k] = v;
  }
  await db.query('UPDATE property_settings SET direct_purchase_alerts = $1 WHERE property_id = $2', [out, propertyId]);
  return { settings: out };
}

async function closedThrough(propertyId, q = db) {
  const { rows: [r] } = await q.query(`SELECT to_char(MAX(business_date), 'YYYY-MM-DD') AS d FROM gl_closed_days WHERE property_id = $1`, [propertyId]);
  return r?.d || null;
}

// ── What the window needs ──
async function setup(propertyId) {
  const [{ rows: suppliers }, { rows: materials }, { rows: products }, { rows: methods }] = await Promise.all([
    db.query(`SELECT id, name, payment_terms_days, default_category, default_department FROM suppliers
              WHERE property_id = $1 AND is_active ORDER BY name`, [propertyId]),
    db.query(`SELECT id, name, unit_of_measure, stock_quantity, cost_per_unit FROM raw_materials
              WHERE property_id = $1 AND is_active ORDER BY name`, [propertyId]),
    db.query(`SELECT id, name, stock_quantity, cost_per_unit FROM products
              WHERE property_id = $1 AND track_stock AND NOT COALESCE(per_night, false) AND NOT COALESCE(open_price, false)
              ORDER BY name`, [propertyId]),
    db.query(`SELECT id, label FROM payment_methods WHERE property_id = $1 AND is_active AND id NOT LIKE 'ota%'
              ORDER BY sort_order, label`, [propertyId]),
  ]);
  let pos = { linked: false, items: [] };
  try { pos = await posPurchases.inventory(propertyId); } catch (err) { pos = { linked: true, items: [], error: err.message }; }
  return {
    suppliers, materials, products, payment_methods: methods, pos,
    categories: COST_CATEGORIES.map(([key, label, , department]) => ({ key, label, department })),
    departments: DEPARTMENTS.map(([key, label]) => ({ key, label })),
    today: todayWITA(), closed_through: await closedThrough(propertyId),
  };
}

// ── Checks the form ──
async function clean(client, propertyId, body) {
  const today = todayWITA();
  const day = body.purchased_on;
  if (!validDay(day)) return fail(400, 'Enter the date it was bought');
  if (day > today) return fail(400, 'The date bought can\'t be in the future');
  if (!CATEGORY_KEYS.includes(body.category)) return fail(400, 'Choose what it is for (the cost category)');
  if (body.department && !DEPARTMENT_KEYS.includes(body.department)) return fail(400, 'Choose a department');

  let supplier = null;
  if (body.supplier_id) {
    ({ rows: [supplier] } = await client.query(
      'SELECT id, name, payment_terms_days, default_department FROM suppliers WHERE id = $1 AND property_id = $2', [body.supplier_id, propertyId]));
    if (!supplier) return fail(400, 'Supplier not found');
  }
  const boughtFrom = supplier ? null : (String(body.bought_from || '').trim().slice(0, 200) || null);

  const pay = body.pay === 'later' ? 'later' : 'paid';
  let method = null;
  if (pay === 'paid') {
    const { rows: [m] } = await client.query(
      'SELECT id, label FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active', [String(body.method || ''), propertyId]);
    if (!m) return fail(400, 'Choose how it was paid');
    method = m;
  } else {
    if (!supplier) return fail(400, 'Pay later needs the supplier — the bill is owed to them');
    if (body.due_date && !validDay(body.due_date)) return fail(400, 'Enter a valid due date');
    if (body.due_date && body.due_date < day) return fail(400, 'The due date can\'t be before the date bought');
  }

  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return fail(400, 'Add at least one item');
  if (raw.length > MAX_LINES) return fail(400, `At most ${MAX_LINES} lines`);
  const items = [];
  let posItems = null;
  for (const l of raw) {
    if ([l.product_id, l.raw_material_id, l.pos_item_id].filter(Boolean).length !== 1) return fail(400, 'Choose the item on every line');
    const qty = Number(l.quantity);
    const amount = Number(l.amount);
    if (!Number.isFinite(qty) || qty <= 0 || qty >= 1e7) return fail(400, 'Every line needs how many');
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) return fail(400, 'Every line needs the price paid');
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return fail(400, 'At most 2 decimals');
    if (l.pos_item_id) {
      if (!posItems) {
        try { posItems = (await posPurchases.inventory(propertyId)).items; }
        catch (err) { return fail(502, `The restaurant app (POS) can't be reached: ${err.message}`); }
      }
      const it = posItems.find(x => x.id === String(l.pos_item_id));
      if (!it) return fail(400, 'A restaurant item was not found in the POS');
      if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) return fail(400, 'At most 3 decimals in how many');
      items.push({ product_id: null, raw_material_id: null, pos_item_id: it.id, description: it.name, unit: it.unit || null, quantity: qty, amount: r2(amount) });
    } else if (l.product_id) {
      if (!Number.isInteger(qty)) return fail(400, 'Sales items are counted in whole units');
      const { rows: [p] } = await client.query(
        'SELECT id, name, track_stock, per_night, open_price FROM products WHERE id = $1 AND property_id = $2', [l.product_id, propertyId]);
      if (!p) return fail(400, 'An item was not found');
      if (!p.track_stock || p.per_night || p.open_price) return fail(400, `${p.name} is not kept in stock`);
      items.push({ product_id: p.id, raw_material_id: null, description: p.name, unit: null, quantity: qty, amount: r2(amount) });
    } else {
      if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) return fail(400, 'At most 3 decimals in how many');
      const { rows: [m] } = await client.query(
        'SELECT id, name, unit_of_measure FROM raw_materials WHERE id = $1 AND property_id = $2', [l.raw_material_id, propertyId]);
      if (!m) return fail(400, 'An item was not found');
      items.push({ product_id: null, raw_material_id: m.id, description: m.name, unit: m.unit_of_measure, quantity: qty, amount: r2(amount) });
    }
  }
  return { value: {
    day, supplier, bought_from: boughtFrom, pay, method, due_date: body.due_date || null, category: body.category,
    department: departmentFor(body.department, supplier?.default_department, body.category),
    reference: String(body.reference || '').trim().slice(0, 100) || null,
    notes: String(body.notes || '').trim().slice(0, 2000) || null,
    items, total: r2(items.reduce((t, i) => t + i.amount, 0)),
  } };
}

// The same receipt entered twice: a live expense or direct purchase with this
// reference (paid ones) — asked once, like a supplier's invoice number.
async function sameReceipt(client, propertyId, v) {
  if (!v.reference) return null;
  const { rows: [d] } = await client.query(
    `SELECT po_number AS what FROM purchase_orders
       WHERE property_id = $1 AND is_direct AND voided_at IS NULL AND lower(reference) = lower($2)
     UNION ALL
     SELECT 'an expense of ' || to_char(incurred_on, 'DD Mon') FROM expenses
       WHERE property_id = $1 AND NOT is_voided AND purchase_order_id IS NULL AND lower(reference) = lower($2)
     LIMIT 1`, [propertyId, v.reference]);
  return d?.what || null;
}

const itemText = i => `${i.description} ${+i.quantity}${i.unit ? ' ' + i.unit : ''}`;

async function create(propertyId, body, user) {
  const client = await db.pool.connect();
  let result, alert;
  try {
    await client.query('BEGIN');
    const c = await clean(client, propertyId, body);
    if (c.error) { await client.query('ROLLBACK'); return c; }
    const v = c.value;
    const dup = await sameReceipt(client, propertyId, v);
    if (dup && !body.confirm_duplicate) {
      await client.query('ROLLBACK');
      return fail(409, `Receipt ${v.reference} is already recorded (${dup}). Save it again anyway?`, 'DUPLICATE_REF');
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`po_number:${propertyId}`]);
    const poNumber = await nextPoNumber(client, propertyId);
    const { rows: [po] } = await client.query(
      `INSERT INTO purchase_orders (property_id, supplier_id, po_number, status, total_amount, notes, requested_by,
         is_direct, bought_from, purchased_on, reference, category)
       VALUES ($1, $2, $3, 'received', $4, $5, $6, true, $7, $8, $9, $10) RETURNING id, po_number`,
      [propertyId, v.supplier?.id || null, poNumber, v.total, v.notes, user.id || null, v.bought_from, v.day, v.reference, v.category]);

    const priceJumps = [];
    for (const it of v.items) {
      const unitCost = it.amount / it.quantity;
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, raw_material_id, pos_item_id, unit, description, quantity, unit_cost, received_quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9)`,
        [po.id, it.product_id, it.raw_material_id, it.pos_item_id || null, it.pos_item_id ? it.unit : null, it.description, it.quantity, r2(unitCost), it.amount]);
      if (it.pos_item_id) continue;   // sent to the POS after the commit
      const { oldAvg } = await addStock(client, propertyId, it, it.quantity, unitCost, po.id, user.id);
      if (oldAvg > 0) priceJumps.push({ ...it, unit_cost: unitCost, usual: oldAvg, pct: Math.round((unitCost / oldAvg - 1) * 100) });
    }

    const what = v.items.map(itemText).join(', ');
    let money;
    if (v.pay === 'paid') {
      const { rows: [e] } = await client.query(
        `INSERT INTO expenses (property_id, category, amount, incurred_on, payment_method, supplier_id, description, reference, created_by, department, purchase_order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [propertyId, v.category, v.total, v.day, v.method.id, v.supplier?.id || null,
          `Stock bought (${po.po_number}): ${what}`.slice(0, 2000), v.reference, user.id || null, v.department, po.id]);
      money = { kind: 'expense', expense_id: e.id, text: `paid ${v.method.label}` };
      await logEvent(client, po.id, `Bought without a PO — paid ${v.method.label}, recorded in Expenses`, user.id);
    } else {
      const b = await createBillTx(client, propertyId, {
        supplier_id: v.supplier.id, bill_date: v.day, due_date: v.due_date, supplier_ref: v.reference,
        notes: `Stock bought (${po.po_number}): ${what}${v.notes ? `\n${v.notes}` : ''}`.slice(0, 2000),
        purchase_order_id: po.id, category: v.category, department: v.department, amount: v.total,
        confirm_duplicate: body.confirm_duplicate,
      }, user.id);
      if (b.error) { await client.query('ROLLBACK'); return b; }
      money = { kind: 'bill', bill_id: b.bill_id, bill_no_text: b.bill_no_text, text: `to pay by ${b.due_date} — ${b.bill_no_text}` };
      await logEvent(client, po.id, `Bought without a PO — to pay later, bill ${b.bill_no_text} in Payables`, user.id);
    }
    await client.query('COMMIT');
    const posSync = v.items.some(i => i.pos_item_id) ? await posPurchases.sendToPos(propertyId, po.id) : null;
    result = { purchase: await get(propertyId, po.id), money, pos_sync: posSync };

    // What the alert looks at — worked out now, sent after the commit.
    const s = await alertSettings(propertyId);
    const reasons = [];
    if (s.amount > 0 && v.total >= s.amount) reasons.push(`over Rp ${s.amount.toLocaleString('id-ID')}`);
    const jumps = s.price_pct > 0 ? priceJumps.filter(j => j.pct >= s.price_pct) : [];
    if (jumps.length) reasons.push(`price above usual`);
    const today = todayWITA();
    const through = await closedThrough(propertyId);
    if (through && v.day <= through) reasons.push('on a day already closed in Accounting');
    else if (s.days > 0 && v.day < addDays(today, -s.days)) {
      reasons.push(`dated ${Math.round((Date.parse(today) - Date.parse(v.day)) / 86400000)} days back`);
    }
    if (reasons.length) alert = { v, po, money, jumps, reasons, by: user.name };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (alert) sendCreateAlert(propertyId, alert).catch(() => {});
  return result;
}

const idr = n => `Rp ${Math.round(num(n)).toLocaleString('id-ID')}`;
const dayText = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

async function sendCreateAlert(propertyId, { v, po, money, jumps, reasons, by }) {
  const e = telegram.escapeHtml;
  const from = v.supplier?.name || v.bought_from || 'no supplier';
  const jumpById = new Map(jumps.map(j => [j.product_id || j.raw_material_id, j]));
  const lines = v.items.map(i => {
    const j = jumpById.get(i.product_id || i.raw_material_id);
    const per = i.unit ? ` / ${i.unit}` : ' each';
    return `• ${e(itemText(i))} — ${e(idr(i.amount))}${j ? ` <b>(${e(idr(j.unit_cost))}${per}, usual ${e(idr(j.usual))}, +${j.pct}%)</b>` : ''}`;
  });
  const msg = [
    `🧾 <b>Bought without a PO — ${e(idr(v.total))}</b>`,
    `${e(from)} · ${e(dayText(v.day))} · ${e(money.text)}`,
    ...lines,
    `⚠️ ${e(reasons.join(' · '))}`,
    `<i>${e(CATEGORY_LABEL[v.category] || v.category)} · ${e(po.po_number)} · entered by ${e(by || 'someone')}</i>`,
  ].join('\n');
  await telegram.sendAlert(propertyId, 'alert_direct_purchase', msg, { html: true });
}

// ── Void: stock back out, expense / bill voided ──
async function voidPurchase(propertyId, poId, reason, user) {
  reason = String(reason || '').trim();
  if (!reason) return fail(400, 'Say why this purchase is voided', 'REASON_REQUIRED');
  const client = await db.pool.connect();
  let po;
  try {
    await client.query('BEGIN');
    ({ rows: [po] } = await client.query(
      `SELECT po.*, COALESCE(s.name, po.bought_from, 'no supplier') AS supplier_name
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.property_id = $2 AND po.is_direct FOR UPDATE OF po`, [poId, propertyId]));
    if (!po) { await client.query('ROLLBACK'); return fail(404, 'Purchase not found'); }
    if (po.voided_at) { await client.query('ROLLBACK'); return fail(409, 'This purchase is already voided', 'VOIDED'); }

    const { rows: [bill] } = await client.query(
      `SELECT b.id, b.bill_no, COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a
          JOIN supplier_payments p ON p.id = a.payment_id AND NOT p.is_voided WHERE a.bill_id = b.id), 0) AS paid
       FROM supplier_bills b WHERE b.purchase_order_id = $1 AND NOT b.is_voided FOR UPDATE OF b`, [poId]);
    if (bill && num(bill.paid) > 0) {
      await client.query('ROLLBACK');
      return fail(409, `Something is already paid on its bill BILL-${String(bill.bill_no).padStart(4, '0')} — void that payment in Payables first`, 'BILL_PAID');
    }

    const { rows: items } = await client.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    const atPos = items.filter(it => it.pos_item_id && num(it.pos_sent_qty) > 0);
    if (atPos.length) {
      await client.query('ROLLBACK');
      return fail(409, `${atPos.map(it => it.description).join(', ')} ${atPos.length > 1 ? 'are' : 'is'} already in the restaurant's stock (POS) — a purchase with restaurant goods can't be voided. Correct the POS stock with a stock opname there.`, 'AT_POS');
    }
    const note = `${po.po_number} voided: ${reason}`.slice(0, 500);
    for (const it of items) {
      const qty = num(it.received_quantity);
      if (qty <= 0 || it.pos_item_id) continue;
      const cost = it.line_total != null ? num(it.line_total) / num(it.quantity) : num(it.unit_cost);
      const table = it.product_id ? 'products' : 'raw_materials';
      const id = it.product_id || it.raw_material_id;
      const { rows: [row] } = await client.query(`SELECT stock_quantity, cost_per_unit FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      const onHand = num(row.stock_quantity);
      if (onHand + 1e-9 < qty) {
        await client.query('ROLLBACK');
        return fail(409, `Only ${+onHand.toFixed(3)} of ${it.description} left in stock — ${+qty} were bought. If it was really used, correct it first on Stock (Adjust or a stock opname).`, 'STOCK_USED');
      }
      const left = onHand - qty;
      const avg = row.cost_per_unit != null ? num(row.cost_per_unit) : null;
      // Take this purchase back out of the average; keep the average when nothing sensible is left.
      let newAvg = avg;
      if (left > 0 && avg != null) {
        const back = (onHand * avg - qty * cost) / left;
        if (back > 0) newAvg = r2(back);
      }
      await client.query(`UPDATE ${table} SET stock_quantity = $1, cost_per_unit = $2 WHERE id = $3`, [left, newAvg, id]);
      if (it.product_id) {
        await client.query(
          `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, purchase_order_id, note, created_by)
           VALUES ($1, $2, $3, 'adjustment', $4, $5, $6)`, [propertyId, id, -qty, poId, note, user.id || null]);
      } else {
        await client.query(
          `INSERT INTO raw_material_movements (property_id, raw_material_id, change_qty, reason, purchase_order_id, note, created_by)
           VALUES ($1, $2, $3, 'adjustment', $4, $5, $6)`, [propertyId, id, -qty, poId, note, user.id || null]);
      }
    }

    await client.query(
      `UPDATE expenses SET is_voided = true, voided_by = $1, voided_at = NOW(), void_reason = $2
       WHERE purchase_order_id = $3 AND NOT is_voided`, [user.id || null, note, poId]);
    if (bill) {
      await client.query(
        `UPDATE supplier_bills SET is_voided = true, voided_at = NOW(), voided_by = $1, void_reason = $2, updated_at = NOW() WHERE id = $3`,
        [user.id || null, note, bill.id]);
    }
    await client.query(
      `UPDATE purchase_orders SET status = 'cancelled', voided_at = NOW(), voided_by = $1, void_reason = $2, updated_at = NOW() WHERE id = $3`,
      [user.id || null, reason.slice(0, 500), poId]);
    await logEvent(client, poId, `Voided — stock taken back out${bill ? ', bill voided' : ', expense voided'}. Reason: ${reason}`.slice(0, 1000), user.id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const e = telegram.escapeHtml;
  telegram.sendAlert(propertyId, 'alert_direct_purchase', [
    `↩️ <b>Purchase without a PO voided — ${e(idr(po.total_amount))}</b>`,
    `${e(po.supplier_name)} · ${e(dayText(String(po.purchased_on).slice(0, 10)))} · ${e(po.po_number)}`,
    `Stock taken back out, its expense / bill voided.`,
    `Reason: ${e(reason)}`,
    `<i>by ${e(user.name || 'someone')}</i>`,
  ].join('\n'), { html: true }).catch(() => {});
  return { purchase: await get(propertyId, poId) };
}

// ── Reading ──
const LIST_COLS = `po.id, po.po_number, to_char(po.purchased_on, 'YYYY-MM-DD') AS purchased_on, po.total_amount, po.reference,
  po.category, po.notes, po.supplier_id, COALESCE(s.name, po.bought_from) AS supplier_name, po.bought_from,
  po.voided_at, po.void_reason, vu.name AS voided_by_name, cu.name AS created_by_name, po.created_at,
  ex.id AS expense_id, COALESCE(pm.label, ex.payment_method) AS paid_with,
  sb.id AS bill_id, sb.bill_no, to_char(sb.due_date, 'YYYY-MM-DD') AS bill_due,
  sb.total AS bill_total, COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a
    JOIN supplier_payments p ON p.id = a.payment_id AND NOT p.is_voided WHERE a.bill_id = sb.id), 0) AS bill_paid,
  (SELECT string_agg(i.description || ' ' || trim(trailing '.' from trim(trailing '0' from i.quantity::text))
     || COALESCE(' ' || COALESCE(rm.unit_of_measure, i.unit), ''), ', ' ORDER BY i.description)
   FROM purchase_order_items i LEFT JOIN raw_materials rm ON rm.id = i.raw_material_id WHERE i.purchase_order_id = po.id) AS items_text`;
const LIST_FROM = `FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  LEFT JOIN users cu ON cu.id = po.requested_by
  LEFT JOIN users vu ON vu.id = po.voided_by
  LEFT JOIN LATERAL (SELECT * FROM expenses x WHERE x.purchase_order_id = po.id ORDER BY x.created_at DESC LIMIT 1) ex ON true
  LEFT JOIN payment_methods pm ON pm.id = ex.payment_method AND pm.property_id = po.property_id
  LEFT JOIN LATERAL (SELECT * FROM supplier_bills b WHERE b.purchase_order_id = po.id ORDER BY b.created_at DESC LIMIT 1) sb ON true`;

function shape(r) {
  const billNoText = r.bill_no ? `BILL-${String(r.bill_no).padStart(4, '0')}` : null;
  const billLeft = r.bill_id ? r2(num(r.bill_total) - num(r.bill_paid)) : null;
  return { ...r, total_amount: num(r.total_amount), category_label: CATEGORY_LABEL[r.category] || r.category,
    pay: r.bill_id ? 'later' : 'paid', bill_no_text: billNoText, bill_left: billLeft,
    bill_paid: num(r.bill_paid), status: r.voided_at ? 'voided' : r.bill_id ? (billLeft > 0.004 ? 'owed' : 'paid') : 'paid' };
}

async function list(propertyId, { from, to, q, voided } = {}) {
  const P = [propertyId];
  const where = ['po.property_id = $1', 'po.is_direct'];
  if (!voided) where.push('po.voided_at IS NULL');
  if (validDay(from)) { P.push(from); where.push(`po.purchased_on >= $${P.length}`); }
  if (validDay(to)) { P.push(to); where.push(`po.purchased_on <= $${P.length}`); }
  if (q && String(q).trim()) {
    P.push(`%${String(q).trim()}%`);
    where.push(`(po.po_number ILIKE $${P.length} OR po.reference ILIKE $${P.length} OR s.name ILIKE $${P.length} OR po.bought_from ILIKE $${P.length}
      OR EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.purchase_order_id = po.id AND i.description ILIKE $${P.length}))`);
  }
  const { rows } = await db.query(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE ${where.join(' AND ')}
    ORDER BY po.purchased_on DESC, po.created_at DESC LIMIT 500`, P);
  return rows.map(shape);
}

async function get(propertyId, poId) {
  const { rows: [r] } = await db.query(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE po.id = $1 AND po.property_id = $2 AND po.is_direct`, [poId, propertyId]);
  if (!r) return null;
  const [{ rows: items }, { rows: events }] = await Promise.all([
    db.query(`SELECT i.id, i.description, i.quantity, i.unit_cost, COALESCE(i.line_total, i.quantity * i.unit_cost) AS line_total,
                     i.product_id, i.raw_material_id, i.pos_item_id, i.pos_sent_qty, i.pos_send_error,
                     COALESCE(rm.unit_of_measure, i.unit) AS unit_of_measure
              FROM purchase_order_items i LEFT JOIN raw_materials rm ON rm.id = i.raw_material_id
              WHERE i.purchase_order_id = $1 ORDER BY i.description`, [poId]),
    db.query(`SELECT e.id, e.note, e.created_at, u.name AS created_by_name FROM purchase_order_events e
              LEFT JOIN users u ON u.id = e.created_by WHERE e.purchase_order_id = $1 ORDER BY e.created_at`, [poId]),
  ]);
  return { ...shape(r), items: items.map(i => ({ ...i, quantity: num(i.quantity), unit_cost: num(i.unit_cost), line_total: num(i.line_total) })), events };
}

// For the Daily Close: purchases dated `day`, not voided.
async function dayTotals(propertyId, day) {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(po.total_amount), 0) AS total,
            COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM supplier_bills b WHERE b.purchase_order_id = po.id))::int AS later
     FROM purchase_orders po WHERE po.property_id = $1 AND po.is_direct AND po.voided_at IS NULL AND po.purchased_on = $2`,
    [propertyId, day]);
  return { count: r.count, total: num(r.total), later: r.later, paid: r.count - r.later };
}

module.exports = { ALERT_DEFAULTS, alertSettings, saveAlertSettings, setup, create, voidPurchase, list, get, dayTotals };
