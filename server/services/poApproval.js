const db = require('../db');
const telegram = require('./telegramService');
const { DEPARTMENT_LABEL } = require('./costCategories');

// Approve purchase orders on Telegram (migration 145).
//
// A PO submitted for approval is sent to every connected personal Telegram
// recipient with `approve_purchase_order` ticked (Settings → Notifications):
// supplier, every line with its price, the total, and ✅ Approve / ↩️ Send back
// buttons. A PO with many lines is split over several messages — the buttons
// are on the last one, under the total. A press counts only from the chat the
// message went to (callback_query from services/telegramLink.js); the first
// press wins, and whatever moves the PO on (Telegram or the PMS) takes the
// buttons off every approver's message with a short reply saying what happened.
// Personal chats only — a group would let anyone in it approve.

const APPROVER_KEY = 'approve_purchase_order';
const MAX_CHARS = 3500;      // Telegram's limit is 4096; leave room for the header
const PRICE_JUMP = 0.2;      // flag a line priced 20% above the item's usual cost

const h = telegram.escapeHtml;
const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const num = n => Number(Number(n).toFixed(3)).toLocaleString('id-ID');
// Quantities are kept in g / ml; shown in kg / L from 1,000 up (as on the screens).
const BIG = { g: ['kg', 1000], ml: ['L', 1000] };
function qtyText(qty, unit) {
  const big = BIG[unit];
  if (big && Number(qty) >= big[1]) return `${num(qty / big[1])} ${big[0]}`;
  return `${num(qty)}${unit ? ' ' + unit : ''}`;
}
function perUnitText(cost, unit) {
  const big = BIG[unit];
  return big ? `${fmtIDR(cost * big[1])}/${big[0]}` : `${fmtIDR(cost)}${unit ? '/' + unit : ''}`;
}

async function approvers(propertyId) {
  const { rows } = await db.query(
    `SELECT id, name, address FROM notification_recipients
     WHERE property_id = $1 AND channel = 'telegram' AND is_active AND address IS NOT NULL
       AND address NOT LIKE '-%' AND $2 = ANY(reports)
     ORDER BY name`, [propertyId, APPROVER_KEY]);
  return rows;
}

async function loadPo(propertyId, poId) {
  const { rows: [po] } = await db.query(
    `SELECT po.*, COALESCE(s.name, po.bought_from, 'No supplier') AS supplier_name,
            u.name AS requested_by_name, ps.property_name
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN users u ON u.id = po.requested_by
     LEFT JOIN property_settings ps ON ps.property_id = po.property_id
     WHERE po.id = $1 AND po.property_id = $2`, [poId, propertyId]);
  if (!po) return null;
  const { rows: items } = await db.query(
    `SELECT poi.description, poi.quantity, poi.unit_cost, poi.line_total,
            COALESCE(rm.unit_of_measure, poi.unit, CASE WHEN poi.product_id IS NOT NULL THEN 'pcs' END) AS unit,
            poi.raw_material_id, poi.product_id, poi.pos_item_id,
            poi.pos_item_id IS NOT NULL AS for_restaurant,
            'PR-' || lpad(pr.request_no::text, 4, '0') AS request_no_text
     FROM purchase_order_items poi
     LEFT JOIN raw_materials rm ON rm.id = poi.raw_material_id
     LEFT JOIN purchase_request_lines prl ON prl.id = poi.request_line_id
     LEFT JOIN purchase_requests pr ON pr.id = prl.request_id
     WHERE poi.purchase_order_id = $1
     ORDER BY poi.description`, [poId]);
  return { ...po, items: await require('./purchasingService').withUsualCosts(propertyId, items) };
}

// The PO as Telegram messages: [ ...item pages, last page with total + buttons ].
function buildMessages(po, submittedBy) {
  const requests = [...new Set(po.items.map(i => i.request_no_text).filter(Boolean))];
  const head = [
    `🧾 <b>Purchase order to approve</b> — ${h(po.property_name || 'your hotel')}`,
    `<b>${h(po.po_number)}</b> · ${h(po.supplier_name)}`,
    `<i>${[submittedBy && `Submitted by ${h(submittedBy)}`,
      po.department && `for ${h(DEPARTMENT_LABEL[po.department] || po.department)}`,
      requests.length && `from ${requests.join(', ')}`].filter(Boolean).join(' · ')}</i>`,
  ].join('\n');

  let flagged = 0;
  const lines = po.items.map((it, k) => {
    const amount = it.line_total != null ? Number(it.line_total) : Number(it.quantity) * Number(it.unit_cost);
    const per = Number(it.quantity) > 0 ? amount / Number(it.quantity) : Number(it.unit_cost);
    let s = `${k + 1}. ${h(it.description)}${it.for_restaurant ? ' <i>(restaurant)</i>' : ''}\n` +
      `    ${qtyText(it.quantity, it.unit)} × ${perUnitText(per, it.unit)} = <b>${fmtIDR(amount)}</b>`;
    const usual = it.usual_cost;
    if (usual > 0 && per > usual * (1 + PRICE_JUMP)) {
      flagged++;
      s += `\n    ⚠️ ${Math.round((per / usual - 1) * 100)}% above the usual ${perUnitText(usual, it.unit)}`;
    }
    return s;
  });

  const tail = [
    `<b>Total: ${fmtIDR(po.total_amount)}</b> · ${po.items.length} item${po.items.length === 1 ? '' : 's'}` +
      (flagged ? ` · ⚠️ ${flagged} priced above usual` : ''),
    po.notes ? `📝 ${h(po.notes)}` : null,
    'Tap <b>Approve</b>, or <b>Send back</b> to return it to draft for changes.',
  ].filter(Boolean).join('\n');

  // Item lines packed into pages under the size limit; the header goes on the
  // first page, the total and the buttons on the last.
  const pages = [];
  let cur = [];
  let size = head.length;
  for (const l of lines) {
    if (cur.length && size + l.length + 1 > MAX_CHARS) { pages.push(cur); cur = []; size = 120; }
    cur.push(l); size += l.length + 1;
  }
  if (cur.length || !pages.length) pages.push(cur);
  if (size + tail.length + 2 > MAX_CHARS) pages.push([]);
  const n = pages.length;
  return pages.map((p, i) => [
    i === 0 ? head : `🧾 <b>${h(po.po_number)}</b> · continued`,
    n > 1 ? `<i>Part ${i + 1} of ${n}</i>` : null,
    p.length ? p.join('\n') : null,
    i === n - 1 ? tail : null,
  ].filter(Boolean).join('\n\n'));
}

const buttons = poId => ({
  inline_keyboard: [[
    { text: '✅ Approve', callback_data: `po:a:${poId}` },
    { text: '↩️ Send back', callback_data: `po:d:${poId}` },
  ]],
});

// Called after a PO moved to pending_approval. Never throws; returns the names sent to.
async function sendForApproval(propertyId, poId, submittedById) {
  try {
    const list = await approvers(propertyId);
    if (!list.length) return [];
    const token = await telegram.botTokenFor(propertyId);
    if (!token) return [];
    const po = await loadPo(propertyId, poId);
    if (!po || po.status !== 'pending_approval') return [];
    const { rows: [u] } = submittedById
      ? await db.query('SELECT name FROM users WHERE id = $1', [submittedById]) : { rows: [] };
    const msgs = buildMessages(po, u?.name);
    const sentTo = [];
    for (const a of list) {
      let last = null;
      for (let i = 0; i < msgs.length; i++) {
        last = await telegram.sendToChat(token, a.address, msgs[i],
          { html: true, replyMarkup: i === msgs.length - 1 ? buttons(poId) : null });
        if (!last.ok) break;
      }
      if (!last?.ok) continue;
      await db.query(
        `INSERT INTO purchase_order_approval_messages (purchase_order_id, property_id, recipient_name, chat_id, message_id)
         VALUES ($1, $2, $3, $4, $5)`, [poId, propertyId, a.name, String(a.address), last.message_id || null]);
      sentTo.push(a.name);
    }
    if (sentTo.length) {
      await db.query('INSERT INTO purchase_order_events (purchase_order_id, note) VALUES ($1, $2)',
        [poId, `Sent on Telegram for approval: ${sentTo.join(', ')}`]);
      require('./telegramLink').ensurePolling();
    }
    return sentTo;
  } catch (err) {
    console.error('[PO approval] could not send:', err.message);
    return [];
  }
}

// The PO left pending_approval (approved, sent back, cancelled — here or on
// Telegram): take the buttons off every open message and reply under it.
async function closeMessages(poId, note) {
  try {
    const { rows } = await db.query(
      `UPDATE purchase_order_approval_messages SET is_open = FALSE
       WHERE purchase_order_id = $1 AND is_open RETURNING chat_id, message_id, property_id`, [poId]);
    if (!rows.length) return;
    const token = await telegram.botTokenFor(rows[0].property_id);
    if (!token) return;
    await Promise.all(rows.filter(r => r.message_id).map(async r => {
      await telegram.callBot(token, 'editMessageReplyMarkup', {
        chat_id: r.chat_id, message_id: Number(r.message_id), reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      await telegram.callBot(token, 'sendMessage', {
        chat_id: r.chat_id, text: note,
        reply_parameters: { message_id: Number(r.message_id), allow_sending_without_reply: true },
      }).catch(() => {});
    }));
  } catch (err) {
    console.error('[PO approval] could not update Telegram messages:', err.message);
  }
}

const LEFT_NOTE = {
  approved: (by, via) => `✅ Approved by ${by}${via === 'telegram' ? ' on Telegram' : ' in the PMS'}.`,
  draft: (by, via) => `↩️ Sent back to draft by ${by}${via === 'telegram' ? ' on Telegram' : ''} — nothing to do.`,
  cancelled: by => `🚫 Cancelled by ${by} — nothing to do.`,
};
function leftNote(status, by, via) {
  return (LEFT_NOTE[status] || (() => `This purchase order is now ${status}.`))(by || 'someone', via);
}

// ✅ / ↩️ pressed on Telegram.
async function handleButton(botToken, cq) {
  const answer = (text, alert = false) =>
    telegram.callBot(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert }).catch(() => {});
  const m = /^po:([ad]):([0-9a-f-]{36})$/.exec(cq.data || '');
  if (!m) return answer('');
  const [, action, poId] = m;
  const chatId = String(cq.message?.chat?.id ?? '');
  if (!chatId || String(cq.from?.id) !== chatId) return answer('Please use the button in your own chat with the bot.', true);

  const { rows: [msg] } = await db.query(
    `SELECT m.recipient_name, m.property_id, m.is_open FROM purchase_order_approval_messages m
     WHERE m.purchase_order_id = $1 AND m.chat_id = $2 AND m.message_id = $3
     ORDER BY m.sent_at DESC LIMIT 1`, [poId, chatId, cq.message?.message_id ?? 0]);
  if (!msg || (await telegram.botTokenFor(msg.property_id)) !== botToken) {
    return answer('This purchase order is not for you.', true);
  }
  const dropButtons = () => telegram.callBot(botToken, 'editMessageReplyMarkup', {
    chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] },
  }).catch(() => {});

  const svc = require('./purchasingService');
  const { rows: [po] } = await db.query(
    `SELECT po.status, po.approved_by_name, po.approved_via, u.name AS approved_user
     FROM purchase_orders po LEFT JOIN users u ON u.id = po.approved_by WHERE po.id = $1`, [poId]);
  if (!msg.is_open || po?.status !== 'pending_approval') {
    await dropButtons();
    return answer(po?.status === 'approved' ? `Already approved by ${po.approved_by_name || po.approved_user || 'someone'}.`
      : po ? `This purchase order is ${po.status === 'draft' ? 'back in draft' : po.status} — nothing to do.`
      : 'This purchase order no longer exists.', true);
  }
  try {
    const r = await svc.setPurchaseOrderStatus(msg.property_id, poId, action === 'a' ? 'approved' : 'draft', null,
      { byName: msg.recipient_name, via: 'telegram' });
    if (r.error) {
      // Someone else pressed first (or it changed in the PMS a moment ago).
      const { rows: [now] } = await db.query('SELECT status, approved_by_name FROM purchase_orders WHERE id = $1', [poId]);
      await dropButtons();
      return answer(now?.status === 'approved' ? `Already approved by ${now.approved_by_name || 'someone'}.` : r.error, true);
    }
    await answer(action === 'a' ? 'Approved ✅' : 'Sent back to draft');
  } catch (err) {
    console.error('[PO approval] button failed:', err.message);
    return answer('Something went wrong — approve it in the PMS instead.', true);
  }
}

module.exports = { APPROVER_KEY, approvers, buildMessages, loadPo, sendForApproval, closeMessages, leftNote, handleButton };
