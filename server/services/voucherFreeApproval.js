// Free (complimentary) vouchers — asking for approval on Telegram (migration 168).
//
// The owner or a role with the `grant_complimentary` permission gives a free voucher
// away at once (voucherService.sellFree). Anyone else asks here: every approver — the
// recipients with "Approve complimentary stays" ticked, personal Telegram chats only —
// gets ✅ Approve / ❌ Decline buttons. A press counts only from the chat the message
// went to (callback_query, services/telegramLink.js); the first press wins; Approve
// issues the voucher as the person who asked. A request waits 24 hours.
const db = require('../db');
const telegram = require('./telegramService');
const comp = require('./complimentaryService');

const TTL_HOURS = 24;
const h = telegram.escapeHtml;
const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const roleText = role => String(role || '').replace(/-[0-9a-f-]{36}$/, '').replace(/_/g, ' ');
const vs = () => require('./voucherService');

// Asks the approvers. `v` = { t (the voucher type), buyer, scope, reason } from cleanFreeRequest.
// Returns { request: { id, status, approver_names, expires_at }, status: 202 } or { error, status }.
async function request(propertyId, v, user) {
  const token = await telegram.botTokenFor(propertyId);
  if (!token) return { status: 409, code: 'NO_TELEGRAM', error: 'Telegram is not set up for this property (Settings → Notifications), so approval can\'t be asked. Ask the owner or a manager with the Complimentary permission to give this voucher.' };
  const list = await comp.approvers(propertyId);
  if (!list.length) return { status: 409, code: 'NO_APPROVERS', error: 'Nobody can approve yet — in Settings → Notifications, tick "Approve complimentary stays" for a manager with a connected personal Telegram. Or ask someone with the Complimentary permission to give this voucher.' };

  const payload = { buyer_guest_id: v.buyer.guest_id, buyer_name: v.buyer.name, buyer_email: v.buyer.email, buyer_phone: v.buyer.phone, recipient_name: v.buyer.recipient };
  const { rows: [req] } = await db.query(
    `INSERT INTO voucher_free_requests (property_id, template_id, requested_by, scope, reason, payload, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' hours')::interval) RETURNING *`,
    [propertyId, v.t.id, user.id, v.scope, v.reason, JSON.stringify(payload), String(TTL_HOURS)]);

  const { rows: [ps] } = await db.query('SELECT property_name FROM property_settings WHERE property_id = $1', [propertyId]);
  const s = v.t;
  const who = `${user.name || 'Front desk'}${user.role ? ` (${roleText(user.role)})` : ''}`;
  const text = [
    [`🎟 <b>Free voucher request</b> — ${h(ps?.property_name || 'your hotel')}`, `<i>From ${h(who)}</i>`],
    [`<b>${h(s.name)}</b>`,
     `• ${s.nights} night${s.nights === 1 ? '' : 's'} · ${h(s.room_type_name)}${s.rate_plan_name ? ` · ${h(s.rate_plan_name)}` : ''}`,
     `• Normally sold at ${fmtIDR(s.price)}`],
    [`🎁 <b>Given to</b>: ${h(v.buyer.name)}${v.buyer.recipient ? ` (for ${h(v.buyer.recipient)})` : ''}`,
     `• Covers: ${h(vs().FREE_SCOPES[v.scope])}`],
    [`📝 <b>Reason</b>: ${h(v.reason)}`],
    ['Tap <b>Approve</b> or <b>Decline</b> below.', `<i>Valid ${TTL_HOURS} hours.</i>`],
  ].map(x => x.join('\n')).join('\n\n');
  const buttons = { inline_keyboard: [[
    { text: '✅ Approve', callback_data: `vfr:a:${req.id}` },
    { text: '❌ Decline', callback_data: `vfr:d:${req.id}` },
  ]] };
  const results = await Promise.all(list.map(a => telegram.sendToChat(token, a.address, text, { html: true, replyMarkup: buttons })));
  const sentTo = [];
  for (let i = 0; i < list.length; i++) {
    if (!results[i].ok) continue;
    sentTo.push(list[i].name);
    await db.query('INSERT INTO voucher_free_request_messages (request_id, recipient_name, chat_id, message_id) VALUES ($1, $2, $3, $4)',
      [req.id, list[i].name, String(list[i].address), results[i].message_id || null]);
  }
  if (!sentTo.length) {
    await db.query("UPDATE voucher_free_requests SET status = 'cancelled' WHERE id = $1", [req.id]);
    return { status: 502, error: `Could not send the request on Telegram: ${results[0]?.error || 'unknown error'}` };
  }
  require('./telegramLink').ensurePolling();
  return { status: 202, request: { id: req.id, status: 'pending', approver_names: sentTo, expires_at: req.expires_at } };
}

// Takes the buttons off every approver's message and replies under it. Never throws.
async function closeMessages(requestId, note) {
  try {
    const { rows } = await db.query(
      `SELECT m.chat_id, m.message_id, r.property_id FROM voucher_free_request_messages m
       JOIN voucher_free_requests r ON r.id = m.request_id WHERE m.request_id = $1 AND m.message_id IS NOT NULL`, [requestId]);
    if (!rows.length) return;
    const token = await telegram.botTokenFor(rows[0].property_id);
    if (!token) return;
    await Promise.all(rows.map(async r => {
      await telegram.callBot(token, 'editMessageReplyMarkup', { chat_id: r.chat_id, message_id: Number(r.message_id), reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await telegram.callBot(token, 'sendMessage', {
        chat_id: r.chat_id, text: note, reply_parameters: { message_id: Number(r.message_id), allow_sending_without_reply: true },
      }).catch(() => {});
    }));
  } catch (err) {
    console.error('Free voucher: could not update Telegram messages:', err.message);
  }
}

// The owner hears about every free voucher (it costs the hotel a stay), however it was approved.
function notifyOwner(propertyId, voucher, { by, template, scope, reason, approvedBy = null, via = null }) {
  const { sendControlAlert } = require('./ownerAlerts');
  const details = [
    `${voucher.snapshot?.name || template?.name || 'Voucher'} — ${vs().FREE_SCOPES[scope]}`,
    `Given to ${voucher.buyer_name}${voucher.recipient_name ? ` (for ${voucher.recipient_name})` : ''} · normally sold at ${fmtIDR(voucher.snapshot?.list_price ?? template?.price)}`,
  ];
  if (approvedBy) details.push(`✅ Approved by ${approvedBy}${via ? ` (${via})` : ''}`);
  sendControlAlert(propertyId, { bookingIds: [], userId: by?.id || by, reason, headline: `🎟 Free voucher given: V-${String(voucher.voucher_no).padStart(4, '0')}`, details });
}

// An Approve / Decline press (from services/telegramLink.js).
async function handleButton(botToken, cq) {
  const answer = (text, alert = false) =>
    telegram.callBot(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert }).catch(() => {});
  const dropButtons = () => telegram.callBot(botToken, 'editMessageReplyMarkup', {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const m = /^vfr:([ad]):([0-9a-f-]{36})$/.exec(cq.data || '');
  if (!m) return answer('');
  const [, action, requestId] = m;
  const chatId = String(cq.message?.chat?.id ?? '');
  if (!chatId || String(cq.from?.id) !== chatId) return answer('Please use the button in your own chat with the bot.', true);

  const client = await db.pool.connect();
  let r, approverName, issued, template;
  try {
    await client.query('BEGIN');
    ({ rows: [r] } = await client.query('SELECT * FROM voucher_free_requests WHERE id = $1 FOR UPDATE', [requestId]));
    const { rows: [who] } = r
      ? await client.query('SELECT recipient_name FROM voucher_free_request_messages WHERE request_id = $1 AND chat_id = $2 LIMIT 1', [requestId, chatId])
      : { rows: [] };
    const propertyBot = r ? await telegram.botTokenFor(r.property_id) : null;
    if (!r || !who || propertyBot !== botToken) { await client.query('ROLLBACK'); return answer('This request is not for you.', true); }
    approverName = who.recipient_name;
    if (r.status !== 'pending') {
      await client.query('ROLLBACK');
      await dropButtons();
      return answer(r.status === 'approved' ? `Already approved by ${r.approved_by_name}.`
        : r.status === 'declined' ? `Already declined by ${r.declined_by_name}.` : 'This request was withdrawn.', true);
    }
    if (new Date(r.expires_at) <= new Date()) {
      await client.query("UPDATE voucher_free_requests SET status = 'cancelled' WHERE id = $1", [r.id]);
      await client.query('COMMIT');
      await dropButtons();
      return answer('This request has expired — it needs to be asked again.', true);
    }
    if (action === 'd') {
      await client.query("UPDATE voucher_free_requests SET status = 'declined', declined_by_name = $1, decided_at = NOW() WHERE id = $2", [approverName, r.id]);
      await client.query('COMMIT');
    } else {
      template = await vs().loadSellableTemplate(client, r.property_id, r.template_id);
      if (!template) { await client.query('ROLLBACK'); return answer('The voucher type is no longer on sale.', true); }
      const p = r.payload || {};
      const buyer = { guest_id: p.buyer_guest_id || null, name: p.buyer_name, email: p.buyer_email || null, phone: p.buyer_phone || null, recipient: p.recipient_name || null };
      const out = await vs().issueFree(client, r.property_id, template, { buyer, scope: r.scope, reason: r.reason, userId: r.requested_by, approvedBy: approverName });
      if (out.error) { await client.query('ROLLBACK'); return answer(out.error, true); }
      issued = out;
      await client.query(
        "UPDATE voucher_free_requests SET status = 'approved', approved_by_name = $1, decided_at = NOW(), voucher_id = $2 WHERE id = $3",
        [approverName, out.row.id, r.id]);
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Free voucher button failed:', err.message);
    return answer('Something went wrong — try again.', true);
  } finally {
    client.release();
  }
  if (action === 'd') {
    await answer('Declined — the person who asked will see it.');
    closeMessages(requestId, `❌ Declined by ${approverName}.`);
    return;
  }
  await answer('Approved ✅');
  closeMessages(requestId, `✅ Approved by ${approverName}. Voucher ${issued.voucher_no} is issued.`);
  notifyOwner(r.property_id, issued.row, { by: r.requested_by, template, scope: r.scope, reason: r.reason, approvedBy: approverName, via: 'Telegram' });
}

// What the Sell window watches while it waits.
async function getRequest(propertyId, id) {
  const { rows: [r] } = await db.query(
    `SELECT r.id, r.status, r.approved_by_name, r.declined_by_name, r.expires_at, r.voucher_id,
            v.voucher_no, v.code, t.name AS template_name
     FROM voucher_free_requests r LEFT JOIN vouchers v ON v.id = r.voucher_id LEFT JOIN voucher_templates t ON t.id = r.template_id
     WHERE r.id = $1 AND r.property_id = $2`, [id, propertyId]);
  if (!r) return null;
  const expired = r.status === 'pending' && new Date(r.expires_at) <= new Date();
  return {
    id: r.id, status: expired ? 'expired' : r.status, approved_by_name: r.approved_by_name, declined_by_name: r.declined_by_name,
    voucher: r.voucher_id ? { id: r.voucher_id, voucher_no: `V-${String(r.voucher_no).padStart(4, '0')}`, code: r.code, pretty_code: vs().prettyCode(r.code) } : null,
    template_name: r.template_name,
  };
}

// Pending asks, and ones turned down in the last day — shown at the top of the Vouchers list.
async function listOpen(propertyId) {
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.scope, r.reason, r.declined_by_name, r.created_at, r.expires_at, t.name AS template_name,
            r.payload->>'buyer_name' AS given_to, u.name AS requested_by_name,
            (SELECT array_agg(m.recipient_name ORDER BY m.recipient_name) FROM voucher_free_request_messages m WHERE m.request_id = r.id) AS approver_names
     FROM voucher_free_requests r JOIN voucher_templates t ON t.id = r.template_id LEFT JOIN users u ON u.id = r.requested_by
     WHERE r.property_id = $1 AND ((r.status = 'pending' AND r.expires_at > NOW()) OR (r.status = 'declined' AND r.decided_at > NOW() - INTERVAL '1 day'))
     ORDER BY r.created_at DESC`, [propertyId]);
  return rows;
}

// The person who asked (or the owner) withdraws it.
async function cancel(propertyId, id, user) {
  const { rows: [r] } = await db.query(
    `UPDATE voucher_free_requests SET status = 'cancelled', decided_at = NOW()
     WHERE id = $1 AND property_id = $2 AND status = 'pending' AND ($3 OR requested_by = $4) RETURNING id`,
    [id, propertyId, user.role === 'owner', user.id]);
  if (!r) return { status: 404, error: 'No open request to withdraw' };
  closeMessages(id, '↩️ The request was withdrawn — nothing to do.');
  return { ok: true };
}

module.exports = { request, handleButton, getRequest, listOpen, cancel, notifyOwner, closeMessages, TTL_HOURS };
