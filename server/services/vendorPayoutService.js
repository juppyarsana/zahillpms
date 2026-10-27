// Vendor share (migration 140): what the hotel owes the vendors who run its
// tours / transport, and the money accounting pays them (Finance → Vendor
// payouts). A trip owes each of its vendors once it is confirmed / completed
// (or cancelled / no-show with "still owed" — a vendor's fee); the amount is
// NULL until someone types it when the vendor is priced per trip by hand.
const db = require('../db');
const { round2 } = require('./folioService');
const { recomputeTaxes } = require('./activityBookingService');

// The one rule for "this vendor line is owed" (journal, reports, this page).
const OWED_SQL = `(bv.amount IS NOT NULL AND (ab.status IN ('confirmed', 'completed')
  OR (ab.status IN ('cancelled', 'no_show') AND bv.owed_if_cancelled)))`;
// Paid on a line so far (payouts not voided).
const PAID_SQL = `COALESCE((SELECT SUM(a.amount) FROM vendor_payout_allocations a JOIN vendor_payouts p ON p.id = a.payout_id
  WHERE a.booking_vendor_id = bv.id AND NOT p.is_voided), 0)`;
const TODAY = `(NOW() AT TIME ZONE 'Asia/Makassar')::date`;
const payoutNo = n => `VP-${String(n).padStart(4, '0')}`;
const num = v => parseFloat(v) || 0;
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });

async function tx(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    if (r && r.error) await client.query('ROLLBACK'); else await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Vendors (suppliers that run tours / transport) ──

async function listVendors(propertyId) {
  const { rows } = await db.query(`
    SELECT s.id, s.name, s.contact_name, s.contact_phone, s.contact_email, s.is_active,
           COALESCE(x.owed_done, 0) AS owed_done, COALESCE(x.owed_upcoming, 0) AS owed_upcoming,
           COALESCE(x.paid, 0) AS paid, COALESCE(x.to_set, 0)::int AS to_set,
           COALESCE(x.trips_open, 0)::int AS trips_open, x.oldest_open
    FROM suppliers s
    LEFT JOIN LATERAL (
      SELECT SUM(bv.amount) FILTER (WHERE ${OWED_SQL} AND ab.scheduled_date <= ${TODAY}) AS owed_done,
             SUM(bv.amount) FILTER (WHERE ${OWED_SQL} AND ab.scheduled_date > ${TODAY}) AS owed_upcoming,
             SUM(${PAID_SQL}) AS paid,
             COUNT(*) FILTER (WHERE bv.amount IS NULL AND ab.status IN ('confirmed', 'completed')) AS to_set,
             COUNT(*) FILTER (WHERE ${OWED_SQL} AND bv.amount > ${PAID_SQL} + 0.004) AS trips_open,
             MIN(ab.scheduled_date) FILTER (WHERE ${OWED_SQL} AND bv.amount > ${PAID_SQL} + 0.004) AS oldest_open
      FROM activity_booking_vendors bv JOIN activity_bookings ab ON ab.id = bv.activity_booking_id
      WHERE bv.supplier_id = s.id
    ) x ON true
    WHERE s.property_id = $1 AND (s.provides_services OR x.trips_open > 0 OR x.to_set > 0)
    ORDER BY s.is_active DESC, s.name`, [propertyId]);
  return rows.map(r => {
    const owedDone = num(r.owed_done), owedUp = num(r.owed_upcoming), paid = num(r.paid);
    return {
      ...r, owed_done: owedDone, owed_upcoming: owedUp, paid,
      // what is owed for trips already done, less everything paid (a payout made
      // ahead of the trip counts against it too)
      balance: round2(owedDone + owedUp - paid),
      due_now: round2(Math.max(0, owedDone - paid)),
    };
  });
}

// Suppliers not yet ticked as tour / transport vendors (to add an existing one).
async function otherSuppliers(propertyId) {
  const { rows } = await db.query(
    'SELECT id, name FROM suppliers WHERE property_id = $1 AND NOT provides_services AND is_active ORDER BY name', [propertyId]);
  return rows;
}

// { name, contact_name, contact_phone, contact_email } — a new supplier ticked as
// a vendor; { supplier_id } — an existing supplier ticked; with `id` = edit.
async function saveVendor(propertyId, body, id) {
  if (!id && body.supplier_id) {
    const { rows: [s] } = await db.query(
      'UPDATE suppliers SET provides_services = true WHERE id = $1 AND property_id = $2 RETURNING id, name', [body.supplier_id, propertyId]);
    return s ? { vendor: s } : fail('Supplier not found', 404);
  }
  const name = String(body.name || '').trim();
  if (!name || name.length > 200) return fail('Type the vendor\'s name');
  const fields = [name, String(body.contact_name || '').trim() || null, String(body.contact_phone || '').trim() || null,
    String(body.contact_email || '').trim() || null];
  if (id) {
    const isActive = body.is_active === undefined ? null : !!body.is_active;
    const { rows: [s] } = await db.query(
      `UPDATE suppliers SET name = $1, contact_name = $2, contact_phone = $3, contact_email = $4,
              is_active = COALESCE($7, is_active)
       WHERE id = $5 AND property_id = $6 RETURNING id, name`, [...fields, id, propertyId, isActive]);
    return s ? { vendor: s } : fail('Vendor not found', 404);
  }
  const { rows: [dup] } = await db.query('SELECT id FROM suppliers WHERE property_id = $1 AND lower(name) = lower($2)', [propertyId, name]);
  if (dup) {
    await db.query('UPDATE suppliers SET provides_services = true WHERE id = $1', [dup.id]);
    return { vendor: { id: dup.id, name }, existing: true };
  }
  const { rows: [s] } = await db.query(
    `INSERT INTO suppliers (property_id, name, contact_name, contact_phone, contact_email, provides_services)
     VALUES ($5, $1, $2, $3, $4, true) RETURNING id, name`, [...fields, propertyId]);
  return { vendor: s };
}

// Untick: the supplier stays (purchasing / payables may use it).
async function removeVendor(propertyId, id) {
  const { rowCount } = await db.query('UPDATE suppliers SET provides_services = false WHERE id = $1 AND property_id = $2', [id, propertyId]);
  return rowCount ? { ok: true } : fail('Vendor not found', 404);
}

// ── Trips ──

const LINE_COLS = `bv.id, bv.supplier_id, s.name AS supplier_name, bv.amount, bv.owed_if_cancelled, bv.note, bv.edited_at,
  eu.name AS edited_by_name, ${PAID_SQL} AS paid, ${OWED_SQL} AS owed,
  ab.id AS activity_booking_id, ab.scheduled_date, ab.scheduled_time, ab.status, ab.num_participants, ab.total_amount,
  ab.tax_mode, ab.service_charge_amount, ab.tax_amount, ab.vendor_treatment, ab.booking_id, ab.pickup_location,
  a.name AS activity_name, COALESCE(g.name, ab.guest_name, 'Walk-in') AS guest_name, u.name AS unit_name`;
const LINE_FROM = `FROM activity_booking_vendors bv
  JOIN activity_bookings ab ON ab.id = bv.activity_booking_id
  JOIN activities a ON a.id = ab.activity_id
  JOIN suppliers s ON s.id = bv.supplier_id
  LEFT JOIN bookings b ON b.id = ab.booking_id
  LEFT JOIN guests g ON g.id = b.guest_id
  LEFT JOIN units u ON u.id = b.unit_id
  LEFT JOIN users eu ON eu.id = bv.edited_by`;
function shapeLine(r) {
  const amount = r.amount == null ? null : num(r.amount), paid = num(r.paid);
  return {
    ...r, amount, paid, total_amount: num(r.total_amount),
    remaining: r.owed ? round2(Math.max(0, amount - paid)) : 0,
    overpaid: round2(Math.max(0, paid - (r.owed ? amount : 0))),
    to_set: r.amount == null && ['confirmed', 'completed'].includes(r.status),
  };
}

// ?supplier_id=&from=&to=&show=open|to_set|all
async function listTrips(propertyId, q = {}) {
  const params = [propertyId];
  let where = 'bv.property_id = $1 AND ab.status <> \'requested\'';
  if (q.supplier_id) { params.push(q.supplier_id); where += ` AND bv.supplier_id = $${params.length}`; }
  if (q.from) { params.push(q.from); where += ` AND ab.scheduled_date >= $${params.length}::date`; }
  if (q.to) { params.push(q.to); where += ` AND ab.scheduled_date <= $${params.length}::date`; }
  if (q.show === 'open') where += ` AND ((${OWED_SQL} AND bv.amount > ${PAID_SQL} + 0.004) OR (bv.amount IS NULL AND ab.status IN ('confirmed', 'completed')))`;
  if (q.show === 'to_set') where += ` AND bv.amount IS NULL AND ab.status IN ('confirmed', 'completed')`;
  const { rows } = await db.query(
    `SELECT ${LINE_COLS} ${LINE_FROM} WHERE ${where} ORDER BY ab.scheduled_date, ab.scheduled_time NULLS LAST, s.name LIMIT 1000`, params);
  return rows.map(shapeLine);
}

// The vendor lines of one activity booking (Activities page).
async function linesForBooking(propertyId, abId) {
  const { rows } = await db.query(`SELECT ${LINE_COLS} ${LINE_FROM} WHERE bv.property_id = $1 AND ab.id = $2 ORDER BY s.name`, [propertyId, abId]);
  return rows.map(shapeLine);
}

const fmt = v => v == null ? 'not set' : `Rp ${Math.round(v).toLocaleString('id-ID')}`;

// A note on the stay's Edit History when the trip belongs to a reservation.
async function noteOnStay(client, ab, note, userId) {
  if (!ab.booking_id) return;
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [ab.booking_id, note.slice(0, 500), userId || null]);
}

// { amount (null = clear), owed_if_cancelled, note }
async function updateLine(propertyId, lineId, body, userId) {
  return tx(async client => {
    const { rows: [line] } = await client.query(
      `SELECT bv.*, ab.booking_id, ab.status, a.name AS activity_name, s.name AS supplier_name, ${PAID_SQL} AS paid
       FROM activity_booking_vendors bv JOIN activity_bookings ab ON ab.id = bv.activity_booking_id
       JOIN activities a ON a.id = ab.activity_id JOIN suppliers s ON s.id = bv.supplier_id
       WHERE bv.id = $1 AND bv.property_id = $2 FOR UPDATE OF bv`, [lineId, propertyId]);
    if (!line) return fail('Trip not found', 404);
    let amount = line.amount == null ? null : num(line.amount);
    if (body.amount !== undefined) {
      if (body.amount === null || body.amount === '') amount = null;
      else {
        amount = parseFloat(body.amount);
        if (!(amount >= 0) || amount > 1e12) return fail('Type the amount for the vendor');
        amount = round2(amount);
      }
    }
    if (num(line.paid) > 0.004 && (amount == null || amount < num(line.paid) - 0.004)) {
      return fail(`Rp ${Math.round(num(line.paid)).toLocaleString('id-ID')} is already paid to the vendor for this trip — the amount can't be lower. Void the payout first.`, 409, { code: 'PAID' });
    }
    const owedIfCancelled = body.owed_if_cancelled === undefined ? line.owed_if_cancelled : !!body.owed_if_cancelled;
    const note = body.note === undefined ? line.note : (String(body.note || '').trim().slice(0, 300) || null);
    await client.query(
      `UPDATE activity_booking_vendors SET amount = $1, owed_if_cancelled = $2, note = $3, edited_by = $4, edited_at = NOW() WHERE id = $5`,
      [amount, owedIfCancelled, note, userId || null, lineId]);
    const before = line.amount == null ? null : num(line.amount);
    if (before !== amount) {
      await recomputeTaxes(client, line.activity_booking_id);
      await noteOnStay(client, line, `Vendor price for ${line.activity_name} (${line.supplier_name}): ${fmt(before)} → ${fmt(amount)}`, userId);
    }
    return { ok: true };
  });
}

// A vendor added to one trip (e.g. a guide this time only).
async function addLine(propertyId, abId, body, userId) {
  return tx(async client => {
    const { rows: [ab] } = await client.query(
      `SELECT ab.*, a.name AS activity_name FROM activity_bookings ab JOIN activities a ON a.id = ab.activity_id
       WHERE ab.id = $1 AND ab.property_id = $2 FOR UPDATE OF ab`, [abId, propertyId]);
    if (!ab) return fail('Activity booking not found', 404);
    const { rows: [s] } = await client.query('SELECT id, name FROM suppliers WHERE id = $1 AND property_id = $2', [body.supplier_id, propertyId]);
    if (!s) return fail('Choose the vendor');
    const { rows: [dup] } = await client.query('SELECT 1 FROM activity_booking_vendors WHERE activity_booking_id = $1 AND supplier_id = $2', [abId, s.id]);
    if (dup) return fail('This vendor is already on the trip', 409);
    let amount = null;
    if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
      amount = parseFloat(body.amount);
      if (!(amount >= 0)) return fail('Type the amount for the vendor');
      amount = round2(amount);
    }
    const { rows: [line] } = await client.query(
      `INSERT INTO activity_booking_vendors (property_id, activity_booking_id, supplier_id, amount, edited_by, edited_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`, [propertyId, abId, s.id, amount, userId || null]);
    await recomputeTaxes(client, abId);
    await noteOnStay(client, ab, `Vendor added to ${ab.activity_name}: ${s.name} ${fmt(amount)}`, userId);
    return { id: line.id };
  });
}

// Takes a vendor off a trip — only while nothing is paid on it.
async function removeLine(propertyId, lineId, userId) {
  return tx(async client => {
    const { rows: [line] } = await client.query(
      `SELECT bv.*, ab.booking_id, a.name AS activity_name, s.name AS supplier_name,
              (SELECT COUNT(*) FROM vendor_payout_allocations x WHERE x.booking_vendor_id = bv.id)::int AS allocations
       FROM activity_booking_vendors bv JOIN activity_bookings ab ON ab.id = bv.activity_booking_id
       JOIN activities a ON a.id = ab.activity_id JOIN suppliers s ON s.id = bv.supplier_id
       WHERE bv.id = $1 AND bv.property_id = $2 FOR UPDATE OF bv`, [lineId, propertyId]);
    if (!line) return fail('Trip not found', 404);
    if (line.allocations > 0) return fail('A payout covers this trip — it can\'t be removed. Set the amount instead.', 409, { code: 'PAID' });
    await client.query('DELETE FROM activity_booking_vendors WHERE id = $1', [lineId]);
    await recomputeTaxes(client, line.activity_booking_id);
    await noteOnStay(client, line, `Vendor taken off ${line.activity_name}: ${line.supplier_name}`, userId);
    return { ok: true };
  });
}

// ── Payouts ──

// { supplier_id, paid_on, method, reference, notes, allocations: [{ line_id, amount }] }
async function createPayout(propertyId, body, userId) {
  const allocs = Array.isArray(body.allocations) ? body.allocations : [];
  if (!body.supplier_id) return fail('Choose the vendor');
  if (!allocs.length || allocs.length > 500) return fail('Tick the trips this payment is for');
  const paidOn = String(body.paid_on || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return fail('Choose the date paid');
  return tx(async client => {
    const { rows: [today] } = await client.query(`SELECT ${TODAY}::text AS d`);
    if (paidOn > today.d) return fail('The date paid can\'t be in the future');
    const { rows: [pm] } = await client.query('SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2', [body.method, propertyId]);
    if (!pm) return fail('Choose how it was paid');
    const ids = allocs.map(a => a.line_id);
    if (new Set(ids).size !== ids.length) return fail('A trip is listed twice');
    const { rows: lines } = await client.query(
      `SELECT bv.id, bv.supplier_id, bv.amount, ${OWED_SQL} AS owed, ${PAID_SQL} AS paid, a.name AS activity_name, ab.scheduled_date
       FROM activity_booking_vendors bv JOIN activity_bookings ab ON ab.id = bv.activity_booking_id JOIN activities a ON a.id = ab.activity_id
       WHERE bv.property_id = $1 AND bv.id = ANY($2) FOR UPDATE OF bv`, [propertyId, ids]);
    if (lines.length !== ids.length) return fail('Trip not found', 404);
    const byId = new Map(lines.map(l => [l.id, l]));
    let total = 0;
    const clean = [];
    for (const a of allocs) {
      const l = byId.get(a.line_id);
      if (l.supplier_id !== body.supplier_id) return fail('Every trip must be for the same vendor');
      if (!l.owed) return fail(`${l.activity_name}: nothing is owed for this trip (amount not set, or the trip was cancelled)`);
      const amount = round2(parseFloat(a.amount));
      const left = round2(num(l.amount) - num(l.paid));
      if (!(amount > 0)) return fail('Every ticked trip needs an amount above 0');
      if (amount > left + 0.004) return fail(`${l.activity_name}: only Rp ${Math.round(left).toLocaleString('id-ID')} is still owed`, 409, { code: 'OVER' });
      clean.push({ id: l.id, amount });
      total = round2(total + amount);
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vendor_payout:${propertyId}`]);
    const { rows: [{ n }] } = await client.query('SELECT COALESCE(MAX(payout_no), 0) + 1 AS n FROM vendor_payouts WHERE property_id = $1', [propertyId]);
    const { rows: [p] } = await client.query(
      `INSERT INTO vendor_payouts (property_id, payout_no, supplier_id, paid_on, amount, method, reference, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, payout_no`,
      [propertyId, n, body.supplier_id, paidOn, total, body.method, String(body.reference || '').trim().slice(0, 100) || null,
       String(body.notes || '').trim().slice(0, 500) || null, userId || null]);
    for (const a of clean) {
      await client.query('INSERT INTO vendor_payout_allocations (payout_id, booking_vendor_id, amount) VALUES ($1, $2, $3)', [p.id, a.id, a.amount]);
    }
    return { id: p.id, payout_no: payoutNo(p.payout_no), amount: total };
  });
}

async function voidPayout(propertyId, id, reason, userId) {
  const why = String(reason || '').trim();
  if (!why) return fail('Say why this payout is voided', 400, { code: 'REASON_REQUIRED' });
  const { rows: [p] } = await db.query(
    `UPDATE vendor_payouts SET is_voided = true, voided_at = NOW(), voided_by = $3, void_reason = $4
     WHERE id = $1 AND property_id = $2 AND NOT is_voided RETURNING id`, [id, propertyId, userId || null, why.slice(0, 500)]);
  return p ? { ok: true } : fail('Payout not found or already voided', 404);
}

async function listPayouts(propertyId, q = {}) {
  const params = [propertyId];
  let where = 'p.property_id = $1';
  if (q.supplier_id) { params.push(q.supplier_id); where += ` AND p.supplier_id = $${params.length}`; }
  if (q.from) { params.push(q.from); where += ` AND p.paid_on >= $${params.length}::date`; }
  if (q.to) { params.push(q.to); where += ` AND p.paid_on <= $${params.length}::date`; }
  const { rows } = await db.query(`
    SELECT p.id, p.payout_no, p.supplier_id, s.name AS supplier_name, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.amount,
           p.method, COALESCE(pm.label, p.method) AS method_label, p.reference, p.notes, p.created_at, cu.name AS created_by_name,
           p.is_voided, p.voided_at, vu.name AS voided_by_name, p.void_reason,
           (SELECT COUNT(*) FROM vendor_payout_allocations a WHERE a.payout_id = p.id)::int AS trips
    FROM vendor_payouts p JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = p.property_id
    LEFT JOIN users cu ON cu.id = p.created_by LEFT JOIN users vu ON vu.id = p.voided_by
    WHERE ${where} ORDER BY p.paid_on DESC, p.payout_no DESC LIMIT 500`, params);
  return rows.map(r => ({ ...r, amount: num(r.amount), payout_no_text: payoutNo(r.payout_no) }));
}

async function payoutDetail(propertyId, id) {
  const { rows: [h] } = await db.query(`
    SELECT p.id, p.payout_no, s.name AS supplier_name, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.amount, p.method,
           COALESCE(pm.label, p.method) AS method_label, p.reference, p.notes, p.is_voided, p.void_reason, cu.name AS created_by_name
    FROM vendor_payouts p JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN payment_methods pm ON pm.id = p.method AND pm.property_id = p.property_id LEFT JOIN users cu ON cu.id = p.created_by
    WHERE p.id = $1 AND p.property_id = $2`, [id, propertyId]);
  if (!h) return null;
  const { rows: lines } = await db.query(`
    SELECT x.amount AS paid_now, bv.amount AS trip_amount, to_char(ab.scheduled_date, 'YYYY-MM-DD') AS scheduled_date, ab.num_participants,
           a.name AS activity_name, COALESCE(g.name, ab.guest_name, 'Walk-in') AS guest_name, u.name AS unit_name
    FROM vendor_payout_allocations x
    JOIN activity_booking_vendors bv ON bv.id = x.booking_vendor_id
    JOIN activity_bookings ab ON ab.id = bv.activity_booking_id JOIN activities a ON a.id = ab.activity_id
    LEFT JOIN bookings b ON b.id = ab.booking_id LEFT JOIN guests g ON g.id = b.guest_id LEFT JOIN units u ON u.id = b.unit_id
    WHERE x.payout_id = $1 ORDER BY ab.scheduled_date, a.name`, [id]);
  return { ...h, amount: num(h.amount), payout_no_text: payoutNo(h.payout_no),
    lines: lines.map(l => ({ ...l, paid_now: num(l.paid_now), trip_amount: num(l.trip_amount) })) };
}

// The slip the vendor signs (pdfkit).
function renderSlip(doc, p) {
  const left = 50, width = doc.page.width - 100;
  const rp = v => `Rp ${Math.round(v).toLocaleString('id-ID')}`;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(`Paid to: ${p.supplier_name}`, left, doc.y + 6);
  doc.font('Helvetica').fontSize(9).fillColor('#444')
    .text(`Date paid: ${p.paid_on}   ·   Paid by: ${p.method_label}${p.reference ? `   ·   Ref: ${p.reference}` : ''}`);
  if (p.is_voided) doc.fillColor('#B91C1C').font('Helvetica-Bold').text(`VOIDED — ${p.void_reason || ''}`);
  doc.moveDown(0.8);
  const cols = [[left, 62, 'Date'], [left + 62, 170, 'Activity'], [left + 232, 150, 'Guest'], [left + 382, 30, 'Pax'], [left + 412, width - 412, 'Paid']];
  let y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#333');
  for (const [x, w, t] of cols) doc.text(t, x, y, { width: w, align: t === 'Paid' ? 'right' : 'left' });
  y += 14;
  doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fillColor('#111');
  for (const l of p.lines) {
    if (y > doc.page.height - 160) { doc.addPage(); y = 50; }
    const vals = [l.scheduled_date, l.activity_name, [l.unit_name, l.guest_name].filter(Boolean).join(' · '), String(l.num_participants),
      rp(l.paid_now) + (l.paid_now < l.trip_amount - 0.004 ? ` of ${rp(l.trip_amount)}` : '')];
    let h = 0;
    cols.forEach(([x, w, t], i) => { h = Math.max(h, doc.heightOfString(vals[i], { width: w })); doc.text(vals[i], x, y, { width: w, align: t === 'Paid' ? 'right' : 'left' }); });
    y += h + 5;
  }
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#999').stroke();
  doc.font('Helvetica-Bold').fontSize(10).text(`Total paid  ${rp(p.amount)}`, left, y + 6, { width, align: 'right' });
  if (p.notes) doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(`Notes: ${p.notes}`, left, doc.y + 8, { width });
  let sy = doc.y + 70;
  if (sy > doc.page.height - 90) { doc.addPage(); sy = 120; }
  const half = (width - 40) / 2;
  doc.fillColor('#111').font('Helvetica').fontSize(9);
  [[left, 'Received by (vendor)'], [left + half + 40, `Paid by${p.created_by_name ? ` — ${p.created_by_name}` : ''}`]].forEach(([x, label]) => {
    doc.moveTo(x, sy).lineTo(x + half, sy).strokeColor('#333').stroke();
    doc.text(label, x, sy + 5, { width: half, align: 'center' });
  });
}

module.exports = {
  OWED_SQL, listVendors, otherSuppliers, saveVendor, removeVendor, listTrips, linesForBooking,
  updateLine, addLine, removeLine, createPayout, voidPayout, listPayouts, payoutDetail, renderSlip, payoutNo,
};
