// Who changed what on the OTA prices (migration 146). Every change is logged;
// one made by anyone but the owner also goes to Telegram (alert_ota_price).
// Never throws: a price already saved must not look failed because of this.
const db = require('../db');
const telegram = require('./telegramService');

async function record(propertyId, user, { action, night = null, summary }) {
  try {
    await db.query(
      'INSERT INTO ota_price_log (property_id, user_id, action, night, summary) VALUES ($1, $2, $3, $4, $5)',
      [propertyId, user?.id || null, action, night, summary]);
    if (user?.role !== 'owner') {
      const { rows: [u] } = user?.id
        ? await db.query('SELECT name FROM users WHERE id = $1', [user.id]) : { rows: [] };
      const by = telegram.escapeHtml(u?.name || 'Someone');
      telegram.sendAlert(propertyId, 'alert_ota_price', `🌐 <b>OTA price changed</b>\n${telegram.escapeHtml(summary)}\nBy ${by}`).catch(() => {});
    }
  } catch (err) {
    console.error('[ota-price-log]', err.message);
  }
}

async function recent(propertyId, limit = 15) {
  const { rows } = await db.query(
    `SELECT l.id, l.action, to_char(l.night, 'YYYY-MM-DD') AS night, l.summary, l.created_at, u.name AS user_name
       FROM ota_price_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.property_id = $1 ORDER BY l.created_at DESC LIMIT $2`, [propertyId, limit]);
  return rows;
}

module.exports = { record, recent };
