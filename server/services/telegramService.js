const db = require('../db');

// Internal staff/owner alerts (new booking, guest requests) via a single
// shared platform-wide Telegram bot — same philosophy as PLATFORM_SMTP_*
// (one platform credential, not per-property bot setup). Gracefully no-ops
// when TELEGRAM_BOT_TOKEN isn't set, same convention as mailer.js skipping
// email when SMTP isn't configured.

function isConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

// Fire-and-forget by design — every call site wraps this in `.catch(() =>
// {})` too, but this function already swallows its own errors so a bad/
// blocked chat ID (or Telegram being unreachable) can never break the
// booking/request that triggered the alert. One chat failing doesn't stop
// the others from receiving it.
async function sendAlert(propertyId, message) {
  if (!isConfigured()) return;
  try {
    const { rows: chats } = await db.query(
      'SELECT chat_id FROM telegram_chats WHERE property_id = $1 AND is_active = true',
      [propertyId]
    );
    if (chats.length === 0) return;

    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await Promise.all(chats.map(async ({ chat_id }) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text: message }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error(`Telegram send failed for chat ${chat_id}: ${res.status} ${body}`);
        }
      } catch (err) {
        console.error(`Telegram send failed for chat ${chat_id}:`, err.message);
      }
    }));
  } catch (err) {
    console.error('Telegram alert failed:', err.message);
  }
}

module.exports = { isConfigured, sendAlert };
