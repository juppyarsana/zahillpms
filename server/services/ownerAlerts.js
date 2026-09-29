const db = require('../db');
const telegram = require('./telegramService');

// Owner control alerts (Reports & Alerts → "Owner control alerts", paid —
// smart_reports module): an instant Telegram message to the owner when staff
// do something that costs the hotel money or lets money slip — a price edit,
// a free/discounted upgrade or extension, a check-in without full payment.
// Each says what happened, for which stay, who did it and why (no link into
// the PMS — recipients may not have a login). Fire-and-
// forget: never throws, never blocks the action that triggered it.

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
function fmtShort(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// bookingIds: one stay, or several (a group check-in) listed in one message.
async function sendControlAlert(propertyId, { bookingIds, userId, headline, details = [], reason }) {
  try {
    const ids = [].concat(bookingIds).filter(Boolean);
    const [{ rows: stays }, { rows: [user] }, { rows: [ps] }] = await Promise.all([
      db.query(
        `SELECT b.id, b.check_in_date, b.check_out_date, g.name AS guest_name, u.name AS unit_name
         FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
         WHERE b.id = ANY($1::uuid[]) AND b.property_id = $2 ORDER BY u.name`,
        [ids, propertyId]
      ),
      db.query('SELECT name, role FROM users WHERE id = $1', [userId]),
      db.query('SELECT property_name FROM property_settings WHERE property_id = $1', [propertyId]),
    ]);
    // Sections separated by a blank line, one fact per line (Telegram HTML).
    const h = telegram.escapeHtml;
    const sections = [
      [`👁 <b>Owner alert</b> — ${h(ps?.property_name || 'your hotel')}`, `<b>${h(headline)}</b>`],
      details.map(d => `• ${h(d)}`),
      [...stays.slice(0, 10).map(s => `🛏 <b>${h(s.unit_name)}</b> · ${h(s.guest_name)} · ${fmtShort(s.check_in_date)} – ${fmtShort(s.check_out_date)}`),
       stays.length > 10 ? `…and ${stays.length - 10} more rooms` : ''],
      [`👤 <b>By</b>: ${h(user?.name || 'unknown')}${user?.role ? ` <i>(${h(user.role.replace(/-[0-9a-f-]{36}$/, '').replace(/_/g, ' '))})</i>` : ''}`,
       reason ? `📝 <b>Reason</b>: ${h(reason)}` : ''],
    ].map(s => s.filter(Boolean)).filter(s => s.length);
    await telegram.sendAlert(propertyId, 'alert_owner_control', sections.map(s => s.join('\n')).join('\n\n'), { html: true });
  } catch (err) {
    console.error('Owner alert failed:', err.message);
  }
}

module.exports = { sendControlAlert, fmtIDR };
