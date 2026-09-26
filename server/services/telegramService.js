const db = require('../db');

// Telegram for staff alerts and reports (Settings → Reports & Alerts).
//
// Which bot: a property can set its OWN bot (property_settings.
// telegram_bot_token, so messages come from e.g. @ZahillResortBot); if it
// hasn't, the platform bot (TELEGRAM_BOT_TOKEN env) is used — same fallback
// idea as property SMTP vs PLATFORM_SMTP_*. Everything gracefully no-ops when
// neither is set. Callers pass a token from botTokenFor(propertyId).

// The bot token this property sends with, or null.
async function botTokenFor(propertyId) {
  const { rows: [ps] } = await db.query(
    'SELECT telegram_bot_token FROM property_settings WHERE property_id = $1',
    [propertyId]
  );
  return ps?.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || null;
}

async function callBot(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.ok, json };
}

// Sends one message to one chat. Returns { ok, message_id, error } rather
// than throwing. html: Telegram's HTML parse mode (<b>, <i>, <a>) — callers
// must escape any text they insert (see escapeHtml). replyMarkup: e.g. an
// inline keyboard (buttons under the message).
async function sendToChat(token, chatId, text, { html = false, replyMarkup = null } = {}) {
  if (!token) return { ok: false, error: 'No Telegram bot set up (Settings → Reports & Alerts → Telegram bot)' };
  try {
    const r = await callBot(token, 'sendMessage', {
      chat_id: chatId,
      text,
      ...(html ? { parse_mode: 'HTML', disable_web_page_preview: true } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!r.ok) {
      const desc = r.json.description || `HTTP ${r.status}`;
      console.error(`Telegram send failed for chat ${chatId}: ${desc}`);
      return { ok: false, error: `Telegram: ${desc}` };
    }
    return { ok: true, message_id: r.json.result?.message_id };
  } catch (err) {
    console.error(`Telegram send failed for chat ${chatId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// A bot's @username (for Connect links and "open @…" hints). Cached per
// token; null when Telegram can't be reached or the token is wrong.
const usernames = new Map();
async function getBotUsername(token) {
  if (!token) return null;
  if (usernames.has(token)) return usernames.get(token);
  try {
    const r = await callBot(token, 'getMe');
    if (!r.ok) return null;
    usernames.set(token, r.json.result.username);
    return r.json.result.username;
  } catch (_) {
    return null;
  }
}

// Checks a token before a property saves it: it must be a real bot, and must
// not have a webhook (Connect links receive Start presses with getUpdates,
// which Telegram refuses while a webhook is set).
async function checkBotToken(token) {
  try {
    const me = await callBot(token, 'getMe');
    if (!me.ok) return { error: 'Telegram does not recognise this token — copy it again from @BotFather' };
    const hook = await callBot(token, 'getWebhookInfo');
    if (hook.ok && hook.json.result?.url) {
      return { error: 'This bot is connected to another system (it has a webhook). Create a new bot in @BotFather for the hotel.' };
    }
    usernames.set(token, me.json.result.username);
    return { username: me.json.result.username };
  } catch (err) {
    return { error: `Could not reach Telegram: ${err.message}` };
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// alertKey: which alert this is ('alert_new_booking' / 'alert_guest_requests',
// see services/smartReports.js REPORTS) — only Telegram recipients (Settings →
// Reports & Alerts) who have it ticked get it. Free for every property.
// Fire-and-forget: never throws, one bad chat doesn't stop the others.
async function sendAlert(propertyId, alertKey, message) {
  try {
    const token = await botTokenFor(propertyId);
    if (!token) return;
    // Paid alerts (e.g. owner control alerts) only with the smart_reports add-on.
    const { REPORTS, isModuleEnabled } = require('./smartReports');   // lazy: circular
    if (REPORTS[alertKey]?.paid && !(await isModuleEnabled(propertyId))) return;
    const { rows: chats } = await db.query(
      `SELECT address FROM notification_recipients
       WHERE property_id = $1 AND channel = 'telegram' AND is_active
         AND address IS NOT NULL AND $2 = ANY(reports)`,
      [propertyId, alertKey]
    );
    await Promise.all(chats.map(({ address }) => sendToChat(token, address, message)));
  } catch (err) {
    console.error('Telegram alert failed:', err.message);
  }
}

module.exports = { botTokenFor, callBot, sendToChat, getBotUsername, checkBotToken, escapeHtml, sendAlert };
