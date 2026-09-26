const crypto = require('crypto');
const db = require('../db');
const telegram = require('./telegramService');
const { applyBookingPrice } = require('./bookingPriceService');
const { computeFolioTotals, round2 } = require('./folioService');

// Complimentary stays (migration 072). A booking is made free with a scope —
// 'room' (room free; rate-plan meals + extras still paid), 'room_meals'
// (room + meals free; extras paid) or 'all' (everything free, incl. extras
// charged to the room: services/folioService leaves those out of the totals).
// The price becomes what's still payable; the value given away is kept per
// night (complimentary_night_value, NET) for reports — comp nights count
// for occupancy but not for ADR (routes/reports.js).
//
// Who: the owner or a role with the `grant_complimentary` permission applies
// it directly. Anyone else asks for approval: every approver (Reports &
// Alerts recipients with "Approve complimentary stays" ticked, personal
// Telegram chats only) gets their OWN one-time code; the code the front desk
// types in says who approved. A code is locked to the booking as it was
// (fingerprint) and to the scope + reason asked for; 10 minutes, 5 tries.

const SCOPES = {
  room:       { label: 'Room only',        short: 'room' },
  room_meals: { label: 'Room + meals',     short: 'room + meals' },
  all:        { label: 'Everything',       short: 'everything (room, meals and extras)' },
};
const COMPABLE_STATUSES = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const APPROVER_KEY = 'approve_complimentary';

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
function fmtShort(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Anything that changes the price makes an outstanding code useless.
function fingerprint(b) {
  return [b.unit_id, String(b.check_in_date).slice(0, 10), String(b.check_out_date).slice(0, 10),
    round2(parseFloat(b.total_amount)), round2(parseFloat(b.discount_amount || 0)), b.rate_plan_id || '', b.num_guests,
    b.complimentary_scope || ''].join('|');
}

// Why this booking can't be made complimentary, or null.
function blockReason(b) {
  if (b.complimentary_scope) return 'This stay is already complimentary';
  if (!COMPABLE_STATUSES.includes(b.status)) return `Cannot make a ${String(b.status).replace('_', '-')} booking complimentary`;
  if (b.folio_status) return 'This stay is billed to an agent — it cannot be made complimentary';
  return null;
}

async function taxRates(client, propertyId) {
  const { rows: [s] } = await client.query(
    'SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]);
  return { tax_rate: s?.tax_rate ?? 0, service_charge_rate: s?.service_charge_rate ?? 0 };
}

// What each scope does to this booking's price.
async function quote(client, propertyId, b) {
  const { tax_rate, service_charge_rate } = await taxRates(client, propertyId);
  const nights = Math.max(1, parseInt(b.nights, 10) || 1);
  const roomNet = round2(parseFloat(b.room_revenue ?? 0));
  const mealNet = round2(parseFloat(b.fnb_revenue ?? 0));
  const current = round2(parseFloat(b.total_amount) - parseFloat(b.discount_amount || 0));
  const out = {};
  for (const scope of Object.keys(SCOPES)) {
    const payMeal = scope === 'room' ? mealNet : 0;
    const newTotal = computeFolioTotals(payMeal, tax_rate, service_charge_rate).total;
    const valueNet = round2(roomNet + (scope === 'room' ? 0 : mealNet));
    out[scope] = {
      label: SCOPES[scope].label,
      new_total: newTotal,
      value_net: valueNet,
      value_gross: round2(current - newTotal),
      extras_free: scope === 'all',
    };
  }
  return { current_total: current, nights, has_meals: mealNet > 0, scopes: out };
}

// Makes the booking complimentary. Runs in the caller's transaction; `before`
// locked FOR UPDATE. Returns { after, credit, note } or { status, error }.
async function applyComp(client, { propertyId, before, scope, reason, userId, approvedByName }) {
  const blocked = blockReason(before);
  if (blocked) return { status: 409, error: blocked };
  const nights = Math.max(1, parseInt(before.nights, 10) || 1);
  const q = await quote(client, propertyId, before);
  const s = q.scopes[scope];

  const result = await applyBookingPrice(client, {
    propertyId, before, userId,
    split: { roomNet: 0, mealNet: scope === 'room' ? parseFloat(before.fnb_revenue || 0) : 0 },
    receivedWasTypo: false,   // money already received stays as a credit (refund by hand)
  });
  if (result.error) return { status: result.status, error: result.error.error || 'Could not change the price' };

  const { rows: [after] } = await client.query(
    `UPDATE bookings SET complimentary_scope = $1, complimentary_reason = $2, complimentary_by = $3,
            complimentary_approved_by = $4, complimentary_at = NOW(),
            complimentary_night_value = $5, complimentary_prev_total = $6,
            complimentary_prev_discount = $7, complimentary_prev_nights = $8,
            discount_type = NULL, discount_value = 0, updated_at = NOW()
     WHERE id = $9 RETURNING *`,
    [scope, reason, userId, approvedByName || null, round2(s.value_net / nights),
     before.total_amount, before.discount_amount || 0, nights, before.id]);

  let note = `🎁 Made complimentary (${SCOPES[scope].short}): ${fmtIDR(q.current_total)} → ${fmtIDR(result.payable)}, value ${fmtIDR(s.value_net)} before tax.`;
  if (approvedByName) note += ` Approved by ${approvedByName}.`;
  if (result.credit > 0) note += ` Guest already paid ${fmtIDR(result.credit)} more than they now owe — to be refunded.`;
  note += ` Reason: ${reason}`;
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
    [before.id, note.slice(0, 1000), userId]);
  return { after, credit: result.credit, payable: result.payable, value_net: s.value_net, previous: q.current_total };
}

// Undo: the price goes back to what it was, per night (dates may have changed).
async function removeComp(client, { propertyId, before, reason, userId }) {
  if (!before.complimentary_scope) return { status: 409, error: 'This stay is not complimentary' };
  if (!COMPABLE_STATUSES.includes(before.status)) return { status: 409, error: `Cannot change a ${String(before.status).replace('_', '-')} booking` };
  const nights = Math.max(1, parseInt(before.nights, 10) || 1);
  const prevNights = Math.max(1, parseInt(before.complimentary_prev_nights, 10) || nights);
  const ratio = nights / prevNights;
  const prevTotal = round2(parseFloat(before.complimentary_prev_total || 0) * ratio);
  const prevDiscount = round2(parseFloat(before.complimentary_prev_discount || 0) * ratio);

  const result = await applyBookingPrice(client, {
    propertyId, before: { ...before, discount_amount: prevDiscount }, newTotal: prevTotal,
    userId, keepDiscount: true, receivedWasTypo: false,
    balanceNote: 'No longer complimentary — amount due',
  });
  if (result.error) return { status: result.status, error: result.error.error || 'Could not change the price' };
  const { rows: [after] } = await client.query(
    `UPDATE bookings SET complimentary_scope = NULL, complimentary_reason = NULL, complimentary_by = NULL,
            complimentary_approved_by = NULL, complimentary_at = NULL, complimentary_night_value = NULL,
            complimentary_prev_total = NULL, complimentary_prev_discount = NULL, complimentary_prev_nights = NULL,
            updated_at = NOW()
     WHERE id = $1 RETURNING *`, [before.id]);
  const note = `Complimentary removed (was ${SCOPES[before.complimentary_scope].short}): price back to ${fmtIDR(result.payable)}. Reason: ${reason}`;
  await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)',
    [before.id, note.slice(0, 1000), userId]);
  return { after, payable: result.payable };
}

// ── Approval by Telegram code ─────────────────────────────────────────────

const hashCode = (requestId, code) => crypto.createHash('sha256').update(`${requestId}:${code}`).digest('hex');

// Approvers who can get a code: connected, active, personal chats (Telegram
// group ids are negative — a code in a group could be read by the requester).
async function approvers(propertyId, client = db) {
  const { rows } = await client.query(
    `SELECT id, name, address FROM notification_recipients
     WHERE property_id = $1 AND channel = 'telegram' AND is_active AND address IS NOT NULL
       AND address NOT LIKE '-%' AND $2 = ANY(reports)
     ORDER BY name`, [propertyId, APPROVER_KEY]);
  return rows;
}

async function pendingRequest(bookingId, client = db) {
  const { rows: [r] } = await client.query(
    `SELECT cr.*, u.name AS requested_by_name,
            (SELECT array_agg(recipient_name ORDER BY recipient_name) FROM complimentary_request_codes c WHERE c.request_id = cr.id) AS approver_names
     FROM complimentary_requests cr LEFT JOIN users u ON u.id = cr.requested_by
     WHERE cr.booking_id = $1 AND cr.status = 'pending' AND cr.expires_at > NOW()
     ORDER BY cr.created_at DESC LIMIT 1`, [bookingId]);
  return r || null;
}

function requestJson(r) {
  if (!r) return null;
  return {
    id: r.id, scope: r.scope, reason: r.reason, expires_at: r.expires_at,
    attempts_left: Math.max(0, MAX_ATTEMPTS - r.attempts),
    approver_names: r.approver_names || [], requested_by_name: r.requested_by_name || null,
  };
}

// Creates a request and sends each approver their message: Approve / Decline
// buttons, plus their own code as a fallback (buttons need the server to
// receive the press — services/telegramLink.js). Returns the request or
// { status, error }.
async function requestApproval({ propertyId, bookingId, scope, reason, user }) {
  const token = await telegram.botTokenFor(propertyId);
  if (!token) return { status: 409, error: 'Telegram is not set up for this property (Settings → Reports & Alerts), so approval codes cannot be sent', code: 'NO_TELEGRAM' };
  const list = await approvers(propertyId);
  if (!list.length) return { status: 409, error: 'Nobody can approve yet — in Settings → Reports & Alerts, tick "Approve complimentary stays" for a manager with a connected personal Telegram', code: 'NO_APPROVERS' };

  const client = await db.pool.connect();
  let request, codes, booking, q, replaced;
  try {
    await client.query('BEGIN');
    const { rows: [b] } = await client.query(
      `SELECT b.*, g.name AS guest_name, u.name AS unit_name FROM bookings b
       JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
       WHERE b.id = $1 AND b.property_id = $2 FOR UPDATE OF b`, [bookingId, propertyId]);
    if (!b) { await client.query('ROLLBACK'); return { status: 404, error: 'Booking not found' }; }
    const blocked = blockReason(b);
    if (blocked) { await client.query('ROLLBACK'); return { status: 409, error: blocked }; }
    booking = b;
    q = await quote(client, propertyId, b);
    // A new ask replaces any earlier one for this booking.
    ({ rows: replaced } = await client.query(
      "UPDATE complimentary_requests SET status = 'cancelled' WHERE booking_id = $1 AND status = 'pending' RETURNING id", [b.id]));
    ({ rows: [request] } = await client.query(
      `INSERT INTO complimentary_requests (property_id, booking_id, requested_by, scope, reason, fingerprint, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' minutes')::interval) RETURNING *`,
      [propertyId, b.id, user.id, scope, reason, fingerprint(b), String(CODE_TTL_MIN)]));
    codes = [];
    const used = new Set();
    for (const a of list) {
      let code;
      do { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (used.has(code));
      used.add(code);
      const hash = hashCode(request.id, code);
      codes.push({ approver: a, code, hash });
      await client.query(
        'INSERT INTO complimentary_request_codes (request_id, recipient_id, recipient_name, code_hash, chat_id) VALUES ($1, $2, $3, $4, $5)',
        [request.id, a.id, a.name, hash, a.address]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  for (const old of replaced) closeMessages(old.id, '↩️ Replaced by a new request — ignore this one.');

  const { rows: [ps] } = await db.query('SELECT property_name FROM property_settings WHERE property_id = $1', [propertyId]);
  const s = q.scopes[scope];
  const who = `${user.name || 'Front desk'}${user.role ? ` (${String(user.role).replace(/-[0-9a-f-]{36}$/, '').replace(/_/g, ' ')})` : ''}`;
  const pretty = n => `${n.slice(0, 3)} ${n.slice(3)}`;
  const buttons = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `cmp:a:${request.id}` },
      { text: '❌ Decline', callback_data: `cmp:d:${request.id}` },
    ]],
  };
  const results = await Promise.all(codes.map(({ approver, code }) => telegram.sendToChat(token, approver.address, [
    `🎁 Complimentary request — ${ps?.property_name || 'your hotel'}`,
    `From: ${who}`,
    `🛏 ${booking.unit_name} · ${booking.guest_name} · ${fmtShort(booking.check_in_date)}–${fmtShort(booking.check_out_date)} (${q.nights} night${q.nights === 1 ? '' : 's'})`,
    `Free: ${SCOPES[scope].short}`,
    `Price ${fmtIDR(q.current_total)} → ${fmtIDR(s.new_total)} (value ${fmtIDR(s.value_gross)})`,
    `📝 Reason: ${reason}`,
    '',
    'Tap Approve or Decline below.',
    `If the buttons don't work, give front desk this code instead: ${pretty(code)}`,
    `Valid ${CODE_TTL_MIN} minutes, for this request only.`,
  ].join('\n'), { replyMarkup: buttons })));
  await Promise.all(codes.map((c, i) => (results[i].ok && results[i].message_id
    ? db.query('UPDATE complimentary_request_codes SET message_id = $1 WHERE request_id = $2 AND code_hash = $3',
        [results[i].message_id, request.id, c.hash])
    : null)));
  const sentTo = codes.filter((_, i) => results[i].ok).map(c => c.approver.name);
  if (!sentTo.length) {
    await db.query("UPDATE complimentary_requests SET status = 'cancelled' WHERE id = $1", [request.id]);
    return { status: 502, error: `Could not send the code on Telegram: ${results[0]?.error || 'unknown error'}` };
  }
  // Start listening for the button press (only while a request is open).
  require('./telegramLink').ensurePolling();
  return { request: { ...requestJson({ ...request, approver_names: sentTo }) } };
}

// Approves an open request (row locked FOR UPDATE by the caller) on behalf of
// `approverName`: the booking must be exactly as it was when asked. The stay
// is recorded as made complimentary by the person who asked.
async function finalizeApproval(client, r, approverName, via) {
  const { rows: [before] } = await client.query(
    'SELECT * FROM bookings WHERE id = $1 AND property_id = $2 FOR UPDATE', [r.booking_id, r.property_id]);
  if (!before || fingerprint(before) !== r.fingerprint) {
    await client.query("UPDATE complimentary_requests SET status = 'cancelled' WHERE id = $1", [r.id]);
    return { status: 409, error: 'The booking changed after the request was sent — ask for approval again', code: 'CHANGED', commit: true };
  }
  const result = await applyComp(client, {
    propertyId: r.property_id, before, scope: r.scope, reason: r.reason, userId: r.requested_by, approvedByName: approverName,
  });
  if (result.error) return result;
  await client.query(
    "UPDATE complimentary_requests SET status = 'approved', approved_by_name = $1, approved_at = NOW(), approved_via = $2 WHERE id = $3",
    [approverName, via, r.id]);
  return { ...result, scope: r.scope, reason: r.reason, approved_by: approverName };
}

// Checks a code and, when right, makes the stay complimentary.
async function approveWithCode({ propertyId, bookingId, requestId, code }) {
  const digits = String(code || '').replace(/\D/g, '');
  const client = await db.pool.connect();
  let out, requester;
  try {
    await client.query('BEGIN');
    const { rows: [r] } = await client.query(
      `SELECT * FROM complimentary_requests WHERE id = $1 AND booking_id = $2 AND property_id = $3 FOR UPDATE`,
      [requestId, bookingId, propertyId]);
    if (!r || r.status !== 'pending') {
      await client.query('ROLLBACK');
      if (r?.status === 'approved') return { status: 409, error: `Already approved by ${r.approved_by_name}`, code: 'APPROVED' };
      if (r?.status === 'declined') return { status: 409, error: `Declined by ${r.declined_by_name}`, code: 'DECLINED' };
      return { status: 409, error: 'This request is no longer open — ask for approval again' };
    }
    if (new Date(r.expires_at) <= new Date()) { await client.query('ROLLBACK'); return { status: 409, error: 'The code has expired — ask for approval again', code: 'EXPIRED' }; }
    if (r.attempts >= MAX_ATTEMPTS) { await client.query('ROLLBACK'); return { status: 409, error: 'Too many wrong codes — ask for approval again', code: 'LOCKED' }; }
    requester = r.requested_by;

    const { rows: [match] } = digits.length === 6
      ? await client.query('SELECT * FROM complimentary_request_codes WHERE request_id = $1 AND code_hash = $2',
          [r.id, hashCode(r.id, digits)])
      : { rows: [] };
    if (!match) {
      const { rows: [u] } = await client.query(
        'UPDATE complimentary_requests SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [r.id]);
      await client.query('COMMIT');
      const left = Math.max(0, MAX_ATTEMPTS - u.attempts);
      return { status: 400, error: left ? `Wrong code — ${left} ${left === 1 ? 'try' : 'tries'} left` : 'Wrong code — no tries left, ask for approval again', code: 'WRONG_CODE', attempts_left: left };
    }
    out = await finalizeApproval(client, r, match.recipient_name, 'code');
    if (out.error && !out.commit) { await client.query('ROLLBACK'); return out; }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  if (out.error) {
    closeMessages(requestId, '⚠️ The booking changed after this request — it can no longer be approved.');
    return out;
  }
  closeMessages(requestId, `✅ Approved by ${out.approved_by} (code). Nothing more to do.`);
  notifyOwner(propertyId, bookingId, requester, { ...out, via: 'code' });
  return out;
}

// Owner control alert (paid add-on) for a stay made complimentary.
function notifyOwner(propertyId, bookingId, userId, { scope, previous, payable, value_net, credit, approved_by, reason, via }) {
  const { sendControlAlert } = require('./ownerAlerts');
  const details = [`Was ${fmtIDR(previous)} → now ${fmtIDR(payable)} · value ${fmtIDR(value_net)} before tax`];
  if (approved_by) details.push(`✅ Approved by ${approved_by}${via ? ` (${via})` : ''}`);
  if (credit > 0) details.push(`Guest already paid ${fmtIDR(credit)} — to be refunded`);
  sendControlAlert(propertyId, {
    bookingIds: bookingId, userId, reason,
    headline: `🎁 Complimentary stay: ${SCOPES[scope].short}`,
    details,
  });
}

// Takes the buttons off every approver's message for this request and
// replies under it with `note` (approved / declined / withdrawn). Never throws.
async function closeMessages(requestId, note) {
  try {
    const { rows } = await db.query(
      `SELECT c.chat_id, c.message_id, cr.property_id FROM complimentary_request_codes c
       JOIN complimentary_requests cr ON cr.id = c.request_id
       WHERE c.request_id = $1 AND c.message_id IS NOT NULL AND c.chat_id IS NOT NULL`, [requestId]);
    if (!rows.length) return;
    const token = await telegram.botTokenFor(rows[0].property_id);
    if (!token) return;
    await Promise.all(rows.map(async r => {
      await telegram.callBot(token, 'editMessageReplyMarkup', {
        chat_id: r.chat_id, message_id: Number(r.message_id), reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      await telegram.callBot(token, 'sendMessage', {
        chat_id: r.chat_id, text: note,
        reply_parameters: { message_id: Number(r.message_id), allow_sending_without_reply: true },
      }).catch(() => {});
    }));
  } catch (err) {
    console.error('Complimentary: could not update Telegram messages:', err.message);
  }
}

// An Approve / Decline button press (callback_query, from services/telegramLink.js).
// Only counts from the approver's own chat the message was sent to, and only
// via the bot that property sends with.
async function handleButton(botToken, cq) {
  const answer = (text, alert = false) =>
    telegram.callBot(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert }).catch(() => {});
  const dropButtons = () => telegram.callBot(botToken, 'editMessageReplyMarkup', {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] },
  }).catch(() => {});
  const m = /^cmp:([ad]):([0-9a-f-]{36})$/.exec(cq.data || '');
  if (!m) return answer('');
  const [, action, requestId] = m;
  const chatId = String(cq.message?.chat?.id ?? '');
  if (!chatId || String(cq.from?.id) !== chatId) return answer('Please use the button in your own chat with the bot.', true);

  const client = await db.pool.connect();
  let out, approverName, r;
  try {
    await client.query('BEGIN');
    ({ rows: [r] } = await client.query('SELECT * FROM complimentary_requests WHERE id = $1 FOR UPDATE', [requestId]));
    const { rows: [who] } = r
      ? await client.query('SELECT recipient_name FROM complimentary_request_codes WHERE request_id = $1 AND chat_id = $2', [requestId, chatId])
      : { rows: [] };
    const propertyBot = r ? await telegram.botTokenFor(r.property_id) : null;
    if (!r || !who || propertyBot !== botToken) {
      await client.query('ROLLBACK');
      return answer('This request is not for you.', true);
    }
    approverName = who.recipient_name;
    if (r.status !== 'pending') {
      await client.query('ROLLBACK');
      await dropButtons();
      return answer(r.status === 'approved' ? `Already approved by ${r.approved_by_name}.`
        : r.status === 'declined' ? `Already declined by ${r.declined_by_name}.`
        : 'This request was withdrawn or replaced.', true);
    }
    if (new Date(r.expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      await dropButtons();
      return answer('This request has expired — front desk needs to ask again.', true);
    }
    if (action === 'd') {
      await client.query(
        "UPDATE complimentary_requests SET status = 'declined', declined_by_name = $1 WHERE id = $2", [approverName, r.id]);
      await client.query('COMMIT');
      out = { declined: true };
    } else {
      out = await finalizeApproval(client, r, approverName, 'button');
      if (out.error && !out.commit) { await client.query('ROLLBACK'); return answer(out.error, true); }
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Complimentary button failed:', err.message);
    return answer('Something went wrong — give front desk the code instead.', true);
  } finally {
    client.release();
  }

  if (out.declined) {
    await answer('Declined — front desk will see it.');
    closeMessages(requestId, `❌ Declined by ${approverName}.`);
    return;
  }
  if (out.error) {
    await answer(out.error, true);
    closeMessages(requestId, '⚠️ The booking changed after this request — it can no longer be approved.');
    return;
  }
  await answer('Approved ✅');
  closeMessages(requestId, `✅ Approved by ${approverName}. The stay is now complimentary.`);
  notifyOwner(r.property_id, r.booking_id, r.requested_by, { ...out, via: 'Telegram' });
}

// Front desk withdrew the request.
async function cancelRequest(propertyId, bookingId) {
  const { rows } = await db.query(
    "UPDATE complimentary_requests SET status = 'cancelled' WHERE booking_id = $1 AND property_id = $2 AND status = 'pending' RETURNING id",
    [bookingId, propertyId]);
  for (const r of rows) closeMessages(r.id, '↩️ Front desk withdrew this request — nothing to do.');
}

// The latest request for a booking in the last hour (any status) — the front
// desk screen watches it to see an approval / decline made on Telegram.
async function latestRequest(bookingId) {
  const { rows: [r] } = await db.query(
    `SELECT id, status, approved_by_name, declined_by_name, approved_via FROM complimentary_requests
     WHERE booking_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
     ORDER BY created_at DESC LIMIT 1`, [bookingId]);
  return r || null;
}

module.exports = {
  SCOPES, APPROVER_KEY, blockReason, quote, applyComp, removeComp,
  approvers, pendingRequest, requestJson, requestApproval, approveWithCode, cancelRequest,
  handleButton, latestRequest, notifyOwner, closeMessages,
};
