// Payables (migration 129): supplier bills and what the hotel owes.
//
// A bill is recorded on the day it arrives: each line on an account of the
// chart, the total owed to the supplier (journal: Dr the lines' accounts ·
// Cr Accounts payable — suppliers). A payment pays one or more bills of the
// same supplier, in full or in part (Dr Accounts payable · Cr Cash / Bank).
// Nothing is deleted: a bill or payment entered by mistake is voided with a
// reason. A bill can be changed or voided only while nothing is paid on it.
const db = require('../db');
const { todayWITA } = require('./roomChargeService');
const { listAccounts } = require('./accountingService');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = v => parseFloat(v) || 0;
const r2 = v => Math.round(v * 100) / 100;
const billNo = n => `BILL-${String(n).padStart(4, '0')}`;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const validDay = d => DAY_RE.test(d || '') && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const fail = (status, error, code) => ({ status, error, code });

// What is still owed on a bill: its total less every live payment on it.
const PAID_SQL = `COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a
  JOIN supplier_payments p ON p.id = a.payment_id AND NOT p.is_voided WHERE a.bill_id = b.id), 0)`;

const BILL_COLS = `b.id, b.bill_no, b.supplier_id, s.name AS supplier_name, b.supplier_ref,
  to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date, to_char(b.due_date, 'YYYY-MM-DD') AS due_date,
  b.purchase_order_id, po.po_number, b.notes, b.total, ${PAID_SQL} AS paid,
  b.is_voided, b.voided_at, b.void_reason, vu.name AS voided_by_name, cu.name AS created_by_name, b.created_at`;
const BILL_FROM = `FROM supplier_bills b
  JOIN suppliers s ON s.id = b.supplier_id
  LEFT JOIN purchase_orders po ON po.id = b.purchase_order_id
  LEFT JOIN users vu ON vu.id = b.voided_by
  LEFT JOIN users cu ON cu.id = b.created_by`;

function shapeBill(b, today) {
  const total = num(b.total), paid = num(b.paid);
  const balance = b.is_voided ? 0 : r2(total - paid);
  const status = b.is_voided ? 'voided' : balance <= 0.004 ? 'paid' : paid > 0 ? 'part_paid' : 'open';
  const daysOverdue = balance > 0 && b.due_date < today
    ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${b.due_date}T00:00:00Z`)) / 86400000) : 0;
  return { ...b, bill_no_text: billNo(b.bill_no), total, paid, balance, status, days_overdue: daysOverdue };
}

// ── Setup for the screens ──
async function setup(propertyId) {
  const accounts = (await listAccounts(propertyId)).filter(a => a.is_active);
  const [{ rows: suppliers }, { rows: methods }] = await Promise.all([
    db.query(`SELECT id, name, payment_terms_days, default_account_id, is_active
              FROM suppliers WHERE property_id = $1 ORDER BY name`, [propertyId]),
    db.query(`SELECT id, label FROM payment_methods WHERE property_id = $1 AND is_active AND id NOT LIKE 'ota%'
              ORDER BY sort_order, label`, [propertyId]),
  ]);
  return { accounts, suppliers, payment_methods: methods, today: todayWITA() };
}

async function checkAccount(client, propertyId, accountId) {
  if (!accountId) return null;
  const { rows: [a] } = await client.query(
    'SELECT id, type, is_active FROM gl_accounts WHERE id = $1 AND property_id = $2', [accountId, propertyId]);
  return a && a.is_active ? a : null;
}

// ── Suppliers (the Payables page can add one and set its terms) ──
async function saveSupplier(propertyId, body, supplierId = null) {
  const terms = body.payment_terms_days === '' || body.payment_terms_days == null ? null : parseInt(body.payment_terms_days, 10);
  if (terms != null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) return fail(400, 'Payment terms must be 0–365 days');
  const accountId = body.default_account_id || null;
  if (accountId && !(await checkAccount(db, propertyId, accountId))) return fail(400, 'Choose an account from the chart');
  if (supplierId) {
    const { rows: [s] } = await db.query(
      `UPDATE suppliers SET payment_terms_days = $1, default_account_id = $2 WHERE id = $3 AND property_id = $4
       RETURNING id, name, payment_terms_days, default_account_id, is_active`, [terms, accountId, supplierId, propertyId]);
    return s ? { supplier: s } : fail(404, 'Supplier not found');
  }
  const name = String(body.name || '').trim();
  if (!name || name.length > 200) return fail(400, 'Supplier name is required');
  const { rows: [dup] } = await db.query('SELECT id FROM suppliers WHERE property_id = $1 AND lower(name) = lower($2)', [propertyId, name]);
  if (dup) return fail(409, 'A supplier with this name already exists', 'DUPLICATE');
  const { rows: [s] } = await db.query(
    `INSERT INTO suppliers (property_id, name, payment_terms_days, default_account_id) VALUES ($1, $2, $3, $4)
     RETURNING id, name, payment_terms_days, default_account_id, is_active`, [propertyId, name, terms, accountId]);
  return { supplier: s };
}

// ── Bills ──
async function cleanBill(client, propertyId, body) {
  const supplierId = body.supplier_id;
  const { rows: [supplier] } = supplierId
    ? await client.query('SELECT id, payment_terms_days FROM suppliers WHERE id = $1 AND property_id = $2', [supplierId, propertyId])
    : { rows: [] };
  if (!supplier) return fail(400, 'Choose the supplier');
  const billDate = body.bill_date;
  if (!validDay(billDate)) return fail(400, 'Enter the bill date');
  const dueDate = body.due_date || addDays(billDate, supplier.payment_terms_days || 0);
  if (!validDay(dueDate)) return fail(400, 'Enter a valid due date');
  if (dueDate < billDate) return fail(400, 'The due date can\'t be before the bill date');
  const ref = String(body.supplier_ref || '').trim().slice(0, 100) || null;
  const notes = String(body.notes || '').trim().slice(0, 2000) || null;

  let poId = body.purchase_order_id || null;
  let poItems = new Set();
  if (poId) {
    const { rows: [po] } = await client.query('SELECT id, supplier_id FROM purchase_orders WHERE id = $1 AND property_id = $2', [poId, propertyId]);
    if (!po) return fail(400, 'Purchase order not found');
    if (po.supplier_id !== supplierId) return fail(400, 'The purchase order is from another supplier');
    const { rows } = await client.query('SELECT id FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
    poItems = new Set(rows.map(r => r.id));
  }

  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (!raw.length) return fail(400, 'Add at least one line');
  if (raw.length > 50) return fail(400, 'At most 50 lines');
  const lines = [];
  for (const [i, l] of raw.entries()) {
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) >= 1e12) return fail(400, `Line ${i + 1}: enter the amount`);
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return fail(400, `Line ${i + 1}: at most 2 decimals`);
    if (!(await checkAccount(client, propertyId, l.account_id))) return fail(400, `Line ${i + 1}: choose an account`);
    const poItem = l.po_item_id || null;
    if (poItem && !poItems.has(poItem)) return fail(400, `Line ${i + 1}: not an item of the purchase order`);
    lines.push({ account_id: l.account_id, description: String(l.description || '').trim().slice(0, 255) || null, amount: r2(amount), po_item_id: poItem });
  }
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  if (!(total > 0)) return fail(400, 'The bill\'s total must be more than 0');
  return { value: { supplier_id: supplierId, bill_date: billDate, due_date: dueDate, supplier_ref: ref, notes, purchase_order_id: poId, lines, total } };
}

async function writeLines(client, billId, lines) {
  await client.query('DELETE FROM supplier_bill_lines WHERE bill_id = $1', [billId]);
  for (const [i, l] of lines.entries()) {
    await client.query(
      `INSERT INTO supplier_bill_lines (bill_id, line_no, account_id, description, amount, po_item_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [billId, i + 1, l.account_id, l.description, l.amount, l.po_item_id]);
  }
}

async function sameRefWarning(client, propertyId, v, exceptId) {
  if (!v.supplier_ref) return null;
  const { rows: [d] } = await client.query(
    `SELECT bill_no FROM supplier_bills WHERE property_id = $1 AND supplier_id = $2 AND lower(supplier_ref) = lower($3)
       AND NOT is_voided AND id IS DISTINCT FROM $4 LIMIT 1`, [propertyId, v.supplier_id, v.supplier_ref, exceptId || null]);
  return d ? billNo(d.bill_no) : null;
}

async function createBill(propertyId, body, userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const c = await cleanBill(client, propertyId, body);
    if (c.error) { await client.query('ROLLBACK'); return c; }
    const v = c.value;
    const dupOf = await sameRefWarning(client, propertyId, v, null);
    if (dupOf && !body.confirm_duplicate) {
      await client.query('ROLLBACK');
      return fail(409, `This supplier's invoice ${v.supplier_ref} is already recorded as ${dupOf}`, 'DUPLICATE_REF');
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`supplier_bill:${propertyId}`]);
    const { rows: [n] } = await client.query('SELECT COALESCE(MAX(bill_no), 0) + 1 AS no FROM supplier_bills WHERE property_id = $1', [propertyId]);
    const { rows: [b] } = await client.query(
      `INSERT INTO supplier_bills (property_id, bill_no, supplier_id, supplier_ref, bill_date, due_date, purchase_order_id, notes, total, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [propertyId, n.no, v.supplier_id, v.supplier_ref, v.bill_date, v.due_date, v.purchase_order_id, v.notes, v.total, userId || null]);
    await writeLines(client, b.id, v.lines);
    await client.query('COMMIT');
    return { bill: await getBill(propertyId, b.id) };
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
}

async function lockBill(client, propertyId, billId) {
  const { rows: [b] } = await client.query(
    `SELECT b.id, b.is_voided, ${PAID_SQL} AS paid FROM supplier_bills b WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE`, [billId, propertyId]);
  return b;
}

async function updateBill(propertyId, billId, body) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const b = await lockBill(client, propertyId, billId);
    if (!b) { await client.query('ROLLBACK'); return fail(404, 'Bill not found'); }
    if (b.is_voided) { await client.query('ROLLBACK'); return fail(409, 'This bill is voided', 'VOIDED'); }
    if (num(b.paid) > 0) { await client.query('ROLLBACK'); return fail(409, 'Something is already paid on this bill — void the payment first', 'HAS_PAYMENTS'); }
    const c = await cleanBill(client, propertyId, body);
    if (c.error) { await client.query('ROLLBACK'); return c; }
    const v = c.value;
    const dupOf = await sameRefWarning(client, propertyId, v, billId);
    if (dupOf && !body.confirm_duplicate) {
      await client.query('ROLLBACK');
      return fail(409, `This supplier's invoice ${v.supplier_ref} is already recorded as ${dupOf}`, 'DUPLICATE_REF');
    }
    await client.query(
      `UPDATE supplier_bills SET supplier_id = $1, supplier_ref = $2, bill_date = $3, due_date = $4, purchase_order_id = $5,
         notes = $6, total = $7, updated_at = NOW() WHERE id = $8`,
      [v.supplier_id, v.supplier_ref, v.bill_date, v.due_date, v.purchase_order_id, v.notes, v.total, billId]);
    await writeLines(client, billId, v.lines);
    await client.query('COMMIT');
    return { bill: await getBill(propertyId, billId) };
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
}

async function voidBill(propertyId, billId, reason, userId) {
  reason = String(reason || '').trim();
  if (!reason) return fail(400, 'Say why the bill is voided', 'REASON_REQUIRED');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const b = await lockBill(client, propertyId, billId);
    if (!b) { await client.query('ROLLBACK'); return fail(404, 'Bill not found'); }
    if (b.is_voided) { await client.query('ROLLBACK'); return fail(409, 'This bill is already voided', 'VOIDED'); }
    if (num(b.paid) > 0) { await client.query('ROLLBACK'); return fail(409, 'Something is paid on this bill — void the payment first', 'HAS_PAYMENTS'); }
    await client.query(
      `UPDATE supplier_bills SET is_voided = true, voided_at = NOW(), voided_by = $1, void_reason = $2, updated_at = NOW() WHERE id = $3`,
      [userId || null, reason.slice(0, 500), billId]);
    await client.query('COMMIT');
    return { bill: await getBill(propertyId, billId) };
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
}

async function getBill(propertyId, billId) {
  const today = todayWITA();
  const { rows: [b] } = await db.query(`SELECT ${BILL_COLS} ${BILL_FROM} WHERE b.id = $1 AND b.property_id = $2`, [billId, propertyId]);
  if (!b) return null;
  const [{ rows: lines }, { rows: payments }] = await Promise.all([
    db.query(`SELECT l.id, l.line_no, l.account_id, ga.code AS account_code, ga.name AS account_name, l.description, l.amount, l.po_item_id
              FROM supplier_bill_lines l JOIN gl_accounts ga ON ga.id = l.account_id WHERE l.bill_id = $1 ORDER BY l.line_no`, [billId]),
    db.query(`SELECT p.id, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.method, COALESCE(pm.label, p.method) AS method_label,
                     p.reference, a.amount, p.amount AS payment_amount, p.is_voided, p.void_reason
              FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id
              LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = p.property_id
              WHERE a.bill_id = $1 ORDER BY p.paid_on, p.created_at`, [billId]),
  ]);
  return { ...shapeBill(b, today), lines: lines.map(l => ({ ...l, amount: num(l.amount) })), payments: payments.map(p => ({ ...p, amount: num(p.amount), payment_amount: num(p.payment_amount) })) };
}

async function listBills(propertyId, { supplier_id, status = 'open', q, from, to } = {}) {
  const today = todayWITA();
  const P = [propertyId];
  const where = ['b.property_id = $1'];
  if (supplier_id) { P.push(supplier_id); where.push(`b.supplier_id = $${P.length}`); }
  if (validDay(from)) { P.push(from); where.push(`b.bill_date >= $${P.length}`); }
  if (validDay(to)) { P.push(to); where.push(`b.bill_date <= $${P.length}`); }
  if (q && String(q).trim()) {
    const s = String(q).trim();
    P.push(`%${s}%`);
    const m = s.match(/^(?:bill-?)?0*(\d+)$/i);
    where.push(`(s.name ILIKE $${P.length} OR b.supplier_ref ILIKE $${P.length} OR b.notes ILIKE $${P.length}${m ? ` OR b.bill_no = ${parseInt(m[1], 10)}` : ''})`);
  }
  const { rows } = await db.query(`SELECT ${BILL_COLS} ${BILL_FROM} WHERE ${where.join(' AND ')}
    ORDER BY b.due_date, b.bill_no LIMIT 1000`, P);
  let bills = rows.map(b => shapeBill(b, today));
  if (status === 'open') bills = bills.filter(b => b.balance > 0);
  else if (status === 'overdue') bills = bills.filter(b => b.days_overdue > 0);
  else if (status === 'paid') bills = bills.filter(b => b.status === 'paid').reverse();
  else if (status === 'voided') bills = bills.filter(b => b.is_voided).reverse();
  return bills;
}

// What the hotel owes, per supplier, with how late it is.
async function summary(propertyId) {
  const today = todayWITA();
  const bills = await listBills(propertyId, { status: 'open' });
  const bySupplier = new Map();
  const blank = () => ({ owed: 0, not_due: 0, d1_30: 0, d31_60: 0, d60: 0, bills: 0, next_due: null });
  const totals = blank();
  for (const b of bills) {
    if (!bySupplier.has(b.supplier_id)) bySupplier.set(b.supplier_id, { supplier_id: b.supplier_id, supplier_name: b.supplier_name, ...blank() });
    for (const t of [bySupplier.get(b.supplier_id), totals]) {
      t.owed += b.balance; t.bills += 1;
      const d = b.days_overdue;
      if (d <= 0) t.not_due += b.balance; else if (d <= 30) t.d1_30 += b.balance; else if (d <= 60) t.d31_60 += b.balance; else t.d60 += b.balance;
      if (!t.next_due || b.due_date < t.next_due) t.next_due = b.due_date;
    }
  }
  const round = t => { for (const k of ['owed', 'not_due', 'd1_30', 'd31_60', 'd60']) t[k] = r2(t[k]); return t; };
  const suppliers = [...bySupplier.values()].map(round).sort((a, b) => b.owed - a.owed);
  const dueSoon = bills.filter(b => b.days_overdue === 0 && b.due_date <= addDays(today, 7));
  return { today, totals: round(totals), overdue: r2(totals.d1_30 + totals.d31_60 + totals.d60),
    due_this_week: r2(dueSoon.reduce((s, b) => s + b.balance, 0)), suppliers };
}

// ── Payments ──
async function recordPayment(propertyId, body, userId) {
  const supplierId = body.supplier_id;
  const paidOn = body.paid_on || todayWITA();
  if (!validDay(paidOn)) return fail(400, 'Enter the date paid');
  if (paidOn > todayWITA()) return fail(400, 'The date paid can\'t be in the future');
  const method = String(body.method || '');
  const allocs = Array.isArray(body.allocations) ? body.allocations : [];
  if (!allocs.length) return fail(400, 'Choose the bills this payment pays');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query('SELECT id FROM suppliers WHERE id = $1 AND property_id = $2', [supplierId, propertyId]);
    if (!s) { await client.query('ROLLBACK'); return fail(400, 'Choose the supplier'); }
    const { rows: [m] } = await client.query('SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active', [method, propertyId]);
    if (!m) { await client.query('ROLLBACK'); return fail(400, 'Choose how it was paid'); }
    const seen = new Set();
    let total = 0;
    const clean = [];
    for (const a of allocs) {
      const amount = r2(Number(a.amount));
      if (!a.bill_id || seen.has(a.bill_id)) { await client.query('ROLLBACK'); return fail(400, 'Each bill once'); }
      seen.add(a.bill_id);
      if (!(amount > 0)) continue;
      const { rows: [b] } = await client.query(
        `SELECT b.id, b.bill_no, b.supplier_id, b.is_voided, b.total, ${PAID_SQL} AS paid
         FROM supplier_bills b WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE`, [a.bill_id, propertyId]);
      if (!b || b.supplier_id !== supplierId) { await client.query('ROLLBACK'); return fail(400, 'A bill is not this supplier\'s'); }
      if (b.is_voided) { await client.query('ROLLBACK'); return fail(409, `${billNo(b.bill_no)} is voided`, 'VOIDED'); }
      const balance = r2(num(b.total) - num(b.paid));
      if (amount > balance + 0.004) { await client.query('ROLLBACK'); return fail(409, `${billNo(b.bill_no)}: only ${balance.toLocaleString('id-ID')} is still owed`, 'OVER_BALANCE'); }
      clean.push({ bill_id: b.id, amount });
      total += amount;
    }
    total = r2(total);
    if (!(total > 0)) { await client.query('ROLLBACK'); return fail(400, 'Enter how much is paid'); }
    const { rows: [p] } = await client.query(
      `INSERT INTO supplier_payments (property_id, supplier_id, paid_on, amount, method, reference, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [propertyId, supplierId, paidOn, total, method, String(body.reference || '').trim().slice(0, 120) || null,
        String(body.notes || '').trim().slice(0, 2000) || null, userId || null]);
    for (const a of clean) {
      await client.query('INSERT INTO supplier_payment_allocations (payment_id, bill_id, amount) VALUES ($1, $2, $3)', [p.id, a.bill_id, a.amount]);
    }
    await client.query('COMMIT');
    return { payment: { id: p.id, amount: total, bills: clean.length } };
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
}

async function voidPayment(propertyId, paymentId, reason, userId) {
  reason = String(reason || '').trim();
  if (!reason) return fail(400, 'Say why the payment is voided', 'REASON_REQUIRED');
  const { rows: [p] } = await db.query(
    `UPDATE supplier_payments SET is_voided = true, voided_at = NOW(), voided_by = $1, void_reason = $2
     WHERE id = $3 AND property_id = $4 AND NOT is_voided RETURNING id`, [userId || null, reason.slice(0, 500), paymentId, propertyId]);
  if (p) return { ok: true };
  const { rows: [e] } = await db.query('SELECT id FROM supplier_payments WHERE id = $1 AND property_id = $2', [paymentId, propertyId]);
  return e ? fail(409, 'This payment is already voided', 'VOIDED') : fail(404, 'Payment not found');
}

async function listPayments(propertyId, { supplier_id, from, to } = {}) {
  const P = [propertyId];
  const where = ['p.property_id = $1'];
  if (supplier_id) { P.push(supplier_id); where.push(`p.supplier_id = $${P.length}`); }
  if (validDay(from)) { P.push(from); where.push(`p.paid_on >= $${P.length}`); }
  if (validDay(to)) { P.push(to); where.push(`p.paid_on <= $${P.length}`); }
  const { rows } = await db.query(`
    SELECT p.id, p.supplier_id, s.name AS supplier_name, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.amount,
           p.method, COALESCE(pm.label, p.method) AS method_label, p.reference, p.notes,
           p.is_voided, p.voided_at, p.void_reason, vu.name AS voided_by_name, cu.name AS created_by_name, p.created_at,
           (SELECT json_agg(json_build_object('bill_id', b.id, 'bill_no', b.bill_no, 'supplier_ref', b.supplier_ref, 'amount', a.amount) ORDER BY b.bill_no)
              FROM supplier_payment_allocations a JOIN supplier_bills b ON b.id = a.bill_id WHERE a.payment_id = p.id) AS bills
    FROM supplier_payments p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = p.property_id
    LEFT JOIN users vu ON vu.id = p.voided_by
    LEFT JOIN users cu ON cu.id = p.created_by
    WHERE ${where.join(' AND ')} ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 500`, P);
  return rows.map(p => ({ ...p, amount: num(p.amount),
    bills: (p.bills || []).map(b => ({ ...b, bill_no_text: billNo(b.bill_no), amount: num(b.amount) })) }));
}

// ── A bill from a purchase order: what was received and not billed yet ──
async function fromPurchaseOrder(propertyId, poId) {
  const { rows: [po] } = await db.query(
    `SELECT po.id, po.po_number, po.status, po.supplier_id, s.name AS supplier_name, s.payment_terms_days, s.default_account_id
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1 AND po.property_id = $2`, [poId, propertyId]);
  if (!po) return fail(404, 'Purchase order not found');
  const { rows: items } = await db.query(`
    SELECT i.id, i.description, i.unit_cost, i.received_quantity,
           COALESCE((SELECT SUM(l.amount) FROM supplier_bill_lines l JOIN supplier_bills b ON b.id = l.bill_id AND NOT b.is_voided
                     WHERE l.po_item_id = i.id), 0) AS billed
    FROM purchase_order_items i WHERE i.purchase_order_id = $1 ORDER BY i.description`, [poId]);
  const lines = items.map(i => {
    const received = r2(num(i.received_quantity) * num(i.unit_cost));
    const amount = r2(received - num(i.billed));
    return { po_item_id: i.id, description: `${i.description} × ${num(i.received_quantity)}`, amount, received, billed: num(i.billed) };
  }).filter(l => l.amount > 0.004);
  return { purchase_order: { id: po.id, po_number: po.po_number, status: po.status },
    supplier: { id: po.supplier_id, name: po.supplier_name, payment_terms_days: po.payment_terms_days, default_account_id: po.default_account_id },
    lines };
}

module.exports = {
  billNo, setup, saveSupplier, createBill, updateBill, voidBill, getBill, listBills, summary,
  recordPayment, voidPayment, listPayments, fromPurchaseOrder,
};
