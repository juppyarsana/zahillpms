const crypto = require('crypto');
const db = require('../db');
const telegram = require('./telegramService');

// Telegram "Connect link" for Reports & Alerts recipients — instead of asking
// people to find their numeric Chat ID, the settings page hands out
//   https://t.me/<bot>?start=<token>        (a person)
//   https://t.me/<bot>?startgroup=<token>   (adds the bot to a group)
// and when they press Start, Telegram sends the bot "/start <token>". We match
// the token to the pending notification_recipients row and store the chat ID.
//
// <bot> is the property's own bot, or the platform bot (see
// telegramService.botTokenFor). Receiving is long-polling getUpdates, one loop
// per bot, and ONLY while that bot has a pending (unexpired) link or an open
// complimentary-stay approval request (its Approve / Decline buttons,
// services/complimentaryService.handleButton) — no
// webhook, so no public URL / nginx setup, and an idle server makes no
// Telegram calls. One bot token can only be polled by one server at a time
// (Telegram answers 409 to the second), and not at all while a webhook is set.

const LINK_DAYS = 7;
const TOKEN_RE = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})\s*$/;

const loops = new Map();   // bot token → { offset }

function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function linkExpiry() {
  return new Date(Date.now() + LINK_DAYS * 24 * 3600 * 1000);
}

async function connectUrls(propertyId, linkToken) {
  const bot = await telegram.getBotUsername(await telegram.botTokenFor(propertyId));
  if (!bot || !linkToken) return null;
  return {
    person: `https://t.me/${bot}?start=${linkToken}`,
    group: `https://t.me/${bot}?startgroup=${linkToken}`,
  };
}

// Bot tokens with something to wait for (own bot, else platform bot): a
// pending Connect link, or an open complimentary approval request.
async function tokensWithPendingLinks() {
  const { rows } = await db.query(
    `SELECT DISTINCT ps.telegram_bot_token AS token
     FROM notification_recipients r
     LEFT JOIN property_settings ps ON ps.property_id = r.property_id
     WHERE r.link_token IS NOT NULL AND r.link_expires_at > NOW()
     UNION
     SELECT DISTINCT ps.telegram_bot_token AS token
     FROM complimentary_requests cr
     LEFT JOIN property_settings ps ON ps.property_id = cr.property_id
     WHERE cr.status = 'pending' AND cr.expires_at > NOW()`
  );
  return [...new Set(rows.map(r => r.token || process.env.TELEGRAM_BOT_TOKEN).filter(Boolean))];
}

function chatName(chat) {
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  return chat.username ? `${name || chat.username} (@${chat.username})` : name || String(chat.id);
}

async function handleStart(botToken, linkToken, chat) {
  const reply = text => telegram.sendToChat(botToken, chat.id, text);
  const { rows: [rec] } = await db.query(
    `SELECT r.*, ps.property_name, ps.telegram_bot_token FROM notification_recipients r
     LEFT JOIN property_settings ps ON ps.property_id = r.property_id
     WHERE r.link_token = $1`,
    [linkToken]
  );
  // The link must belong to a property that sends with THIS bot.
  const recipientBot = rec && (rec.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN);
  if (!rec || recipientBot !== botToken || !rec.link_expires_at || new Date(rec.link_expires_at) < new Date()) {
    await reply('This link has expired or was already used. Ask your hotel for a new one (Settings → Reports & Alerts → New link).');
    return;
  }
  try {
    await db.query(
      `UPDATE notification_recipients
       SET address = $1, telegram_name = $2, link_token = NULL, link_expires_at = NULL,
           last_error = NULL, updated_at = NOW()
       WHERE id = $3`,
      [String(chat.id), chatName(chat).slice(0, 255), rec.id]
    );
  } catch (err) {
    if (err.code === '23505') {
      await reply(`This chat already receives ${rec.property_name || 'the hotel'}'s alerts and reports.`);
      return;
    }
    throw err;
  }
  const property = rec.property_name || 'your hotel';
  await reply(`✅ Connected! ${chat.title ? 'This group' : 'You'} will receive ${property}'s alerts and reports here (as "${rec.name}").`);
}

async function processUpdate(botToken, u) {
  if (u.callback_query) {
    // Lazy: complimentaryService requires this file (ensurePolling).
    return require('./complimentaryService').handleButton(botToken, u.callback_query);
  }
  const msg = u.message;
  if (!msg?.text || !msg.chat) return;
  const m = TOKEN_RE.exec(msg.text.trim());
  if (m) return handleStart(botToken, m[1], msg.chat);
  // A bare /start in a private chat — someone opened the bot without a link.
  if (msg.chat.type === 'private' && /^\/start\b/.test(msg.text)) {
    await telegram.sendToChat(botToken, msg.chat.id, 'Hi! To receive your hotel\'s alerts and reports, open the Connect link your hotel sent you.');
  }
}

async function pollLoop(botToken) {
  const state = loops.get(botToken);
  while ((await tokensWithPendingLinks()).includes(botToken)) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?timeout=50&offset=${state.offset}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        console.error(`[Telegram link] getUpdates failed: ${res.status} ${body.description || ''}`);
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
      for (const u of body.result) {
        state.offset = u.update_id + 1;
        try {
          await processUpdate(botToken, u);
        } catch (err) {
          console.error('[Telegram link] update failed:', err.message);
        }
      }
    } catch (err) {
      console.error('[Telegram link] poll error:', err.message);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

// Start watching every bot that has a pending link and isn't watched yet.
// Safe to call any time (server start, after creating a link, bot change).
async function ensurePolling() {
  try {
    for (const token of await tokensWithPendingLinks()) {
      if (loops.has(token)) continue;
      loops.set(token, { offset: 0 });
      pollLoop(token)
        .catch(err => console.error('[Telegram link] stopped:', err.message))
        .finally(() => loops.delete(token));
    }
  } catch (err) {
    console.error('[Telegram link] could not start:', err.message);
  }
}

module.exports = { newToken, linkExpiry, connectUrls, ensurePolling, processUpdate, LINK_DAYS };
