// Group billing (migration 097) — a group booking with ONE bill and ONE
// payment record, as the accountant asked: payments are recorded on the
// group (group_payments), never spread over its rooms.
//
//   The group's bill = every active room's room nights + meal plan, and its
//   extras too when billing_mode is 'everything' (folioService.toGroup), each
//   with service & tax — the whole stay, posted or not (computeProforma).
//   A room's own bill = its other extras; its guest pays them (the room's
//   Folio tab / checkout, unchanged).
//   Status (pending → deposit_paid → confirmed) of every room follows the
//   group's payments against the rooms' prices (paymentStatusService).
//
// Groups with group_billing = false keep the old per-room payments.
const db = require('../db');
const { computeProforma, round2, settleCents } = require('./folioService');
const { recomputeGroupStatus } = require('./paymentStatusService');

// What each group billed as a whole still owes for its rooms ($1 = property):
// rows (id, owed) — the rooms' prices (total − discount) minus the group's
// payments. Used where pending room lines are counted (Dashboard, Reports).
const GROUP_OWED_SQL = `
  SELECT rg.id, SUM(b.total_amount - COALESCE(b.discount_amount, 0))
           - COALESCE((SELECT SUM(gp.amount) FROM group_payments gp WHERE gp.group_id = rg.id AND NOT gp.is_voided), 0) AS owed
  FROM reservation_groups rg JOIN bookings b ON b.reservation_group_id = rg.id
  WHERE rg.property_id = $1 AND rg.group_billing AND b.status NOT IN ('cancelled', 'no_show')
  GROUP BY rg.id`;

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');

// The group's payments, newest last, with the method's label and who took it.
async function listPayments(groupId, propertyId, client = db) {
  const { rows } = await client.query(
    `SELECT gp.*, COALESCE(pm.label, gp.method) AS method_label,
            us.name AS received_by_name, vu.name AS voided_by_name
     FROM group_payments gp
     LEFT JOIN payment_methods pm ON pm.id = gp.method AND pm.property_id = gp.property_id
     LEFT JOIN users us ON us.id = gp.received_by
     LEFT JOIN users vu ON vu.id = gp.voided_by
     WHERE gp.group_id = $1 AND gp.property_id = $2
     ORDER BY gp.received_at, gp.recorded_at, gp.created_at`, [groupId, propertyId]);
  return rows.map(r => ({ ...r, amount: parseFloat(r.amount) }));
}

// The whole bill: per room its group part and own part (projected for the
// whole stay), the group's total, payments and balance. null when the group
// isn't found or isn't billed as a whole.
async function groupBill(groupId, propertyId) {
  const { rows: [g] } = await db.query(
    'SELECT id, group_billing, billing_mode, group_deposit_amount FROM reservation_groups WHERE id = $1 AND property_id = $2',
    [groupId, propertyId]);
  if (!g || !g.group_billing) return null;
  const { rows: rooms } = await db.query(
    `SELECT b.id FROM bookings b JOIN units u ON u.id = b.unit_id
     WHERE b.reservation_group_id = $1 AND b.property_id = $2 AND b.status NOT IN ('cancelled', 'no_show')
     ORDER BY u.name`, [groupId, propertyId]);
  const estimates = await Promise.all(rooms.map(r => computeProforma(r.id, propertyId)));
  const perRoom = estimates.filter(Boolean).map(e => ({
    booking_id: e.booking.id, unit_name: e.booking.unit_name, guest_name: e.booking.guest_name,
    group_total: e.group?.group_total || 0, own_total: e.group?.own_total || 0, own_balance: e.balance_due,
  }));
  const payments = await listPayments(groupId, propertyId);
  const received = round2(payments.filter(p => !p.is_voided).reduce((s, p) => s + p.amount, 0));
  const total = round2(perRoom.reduce((s, r) => s + r.group_total, 0));
  return {
    group_id: g.id, billing_mode: g.billing_mode,
    deposit_required: Math.min(parseFloat(g.group_deposit_amount || 0), total),
    rooms: perRoom, total, received, balance_due: settleCents(round2(total - received)), payments,
  };
}

// Write one note on every active room of the group (the group page's History
// merges the same note on several rooms into one entry).
async function logToRooms(client, groupId, note, userId) {
  await client.query(
    `INSERT INTO booking_events (booking_id, note, created_by)
     SELECT id, $2, $3 FROM bookings WHERE reservation_group_id = $1 AND status NOT IN ('cancelled', 'no_show')`,
    [groupId, note.slice(0, 1000), userId]);
}

// Records one payment from the group. Runs in the caller's transaction.
// Returns { error, status } on a bad request.
async function recordPayment(client, { propertyId, groupId, userId, amount, method, receivedAt, reference, notes }) {
  const amt = round2(parseFloat(amount));
  if (!(amt > 0)) return { status: 400, error: 'Enter the amount received' };
  if (!method) return { status: 400, error: 'Payment method required' };
  const { rows: [g] } = await client.query(
    'SELECT id, group_billing, status FROM reservation_groups WHERE id = $1 AND property_id = $2 FOR UPDATE', [groupId, propertyId]);
  if (!g) return { status: 404, error: 'Group not found' };
  if (!g.group_billing) return { status: 409, error: 'This group is paid room by room', code: 'NOT_GROUP_BILLED' };
  const { rows: [pm] } = await client.query(
    "SELECT id, label FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true AND id <> 'ota_managed'",
    [method, propertyId]);
  if (!pm) return { status: 400, error: 'Unknown payment method' };
  const { rows: [p] } = await client.query(
    `INSERT INTO group_payments (property_id, group_id, amount, method, received_at, received_by, reference, notes)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7, $8) RETURNING *`,
    [propertyId, groupId, amt, method, receivedAt || null, userId,
     String(reference || '').trim().slice(0, 120) || null, String(notes || '').trim() || null]);
  await recomputeGroupStatus(client, groupId);
  await logToRooms(client, groupId,
    `Group payment received: ${fmtIDR(amt)} by ${pm.label}${p.reference ? ` (ref ${p.reference})` : ''}.`, userId);
  return { payment: { ...p, amount: parseFloat(p.amount), method_label: pm.label } };
}

// Voids a group payment (kept, struck through). Reason required.
async function voidPayment(client, { propertyId, groupId, paymentId, userId, reason }) {
  const why = String(reason || '').trim();
  if (!why) return { status: 400, error: 'A reason is required', code: 'REASON_REQUIRED' };
  const { rows: [p] } = await client.query(
    `SELECT gp.*, COALESCE(pm.label, gp.method) AS method_label FROM group_payments gp
     LEFT JOIN payment_methods pm ON pm.id = gp.method AND pm.property_id = gp.property_id
     WHERE gp.id = $1 AND gp.group_id = $2 AND gp.property_id = $3 FOR UPDATE OF gp`,
    [paymentId, groupId, propertyId]);
  if (!p) return { status: 404, error: 'Payment not found' };
  if (p.is_voided) return { status: 409, error: 'This payment is already voided' };
  await client.query(
    'UPDATE group_payments SET is_voided = true, void_reason = $1, voided_by = $2, voided_at = NOW() WHERE id = $3',
    [why.slice(0, 500), userId, p.id]);
  await recomputeGroupStatus(client, groupId);
  await logToRooms(client, groupId,
    `Group payment voided: ${fmtIDR(p.amount)} by ${p.method_label}. Reason: ${why}`, userId);
  return { ok: true };
}

module.exports = { GROUP_OWED_SQL, groupBill, listPayments, recordPayment, voidPayment, logToRooms };
