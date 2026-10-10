// Room tablet alerts on Telegram (migration 103) — the `alert_room_tablet`
// alert in Settings → Reports & Alerts, for housekeeping by default. Only
// tablets running the kiosk app report in (room_display_devices).
//
//   Low battery  one message when a tablet goes under 25% while not charging,
//                one more under 10%. Nothing in between; told again only after
//                it has been charging or back at 30%+.
//   Offline      one message when a tablet has not reported for 15 minutes —
//                never repeated while it stays offline — and one when it is
//                back. Tablets that drop out together go in ONE message.
//
// A tablet taken away for good: "Remove tablet" on the Dashboard deletes its
// row, so nothing is sent for it.
const db = require('../db');
const telegramService = require('./telegramService');

const ALERT = 'alert_room_tablet';
const LOW = 25, CRITICAL = 10, RECOVERED = 30;
const OFFLINE_MINUTES = 15;
// After a restart every tablet looks "not seen" for as long as the server was
// down — wait until they have had time to report before calling one offline.
const SETTLE_SECONDS = (OFFLINE_MINUTES + 5) * 60;

const esc = telegramService.escapeHtml;
const send = (propertyId, html) => telegramService.sendAlert(propertyId, ALERT, html, { html: true }).catch(() => 0);

async function roomName(propertyId, controllerId) {
  const { rows: [u] } = await db.query('SELECT name FROM units WHERE property_id = $1 AND controller_id = $2', [propertyId, controllerId]);
  return u?.name || controllerId;
}

// Called after every telemetry POST with the device row as it now is.
// Fire-and-forget: never throws, never delays the tablet's request.
async function afterTelemetry(propertyId, controllerId, device) {
  try {
    const where = 'property_id = $1 AND controller_id = $2';
    // Back after an "offline" message.
    const { rowCount: wasOffline } = await db.query(
      `UPDATE room_display_devices SET offline_alerted_at = NULL WHERE ${where} AND offline_alerted_at IS NOT NULL`, [propertyId, controllerId]);
    if (wasOffline) await send(propertyId, `✅ <b>Room ${esc(await roomName(propertyId, controllerId))}</b> tablet is back online.`);

    const level = device.battery_level;
    if (level == null) return;
    if (device.battery_charging || level >= RECOVERED) {
      if (device.battery_alert_level != null) {
        await db.query(`UPDATE room_display_devices SET battery_alert_level = NULL WHERE ${where}`, [propertyId, controllerId]);
      }
      return;
    }
    const step = level < CRITICAL ? CRITICAL : level < LOW ? LOW : null;
    if (!step) return;
    // Claimed in the database, so two reports at once send one message.
    const { rowCount: claimed } = await db.query(
      `UPDATE room_display_devices SET battery_alert_level = $3
        WHERE ${where} AND (battery_alert_level IS NULL OR battery_alert_level > $3)`, [propertyId, controllerId, step]);
    if (!claimed) return;
    const room = esc(await roomName(propertyId, controllerId));
    await send(propertyId, step === CRITICAL
      ? `🪫 <b>Room ${room}</b> tablet: battery <b>${level}%</b> and still not charging — it will switch off soon. Please check the charger now.`
      : `🔋 <b>Room ${room}</b> tablet: battery <b>${level}%</b>, not charging. Please check the charger.`);
  } catch (err) {
    console.error('[TabletAlerts] battery check failed:', err.message);
  }
}

// Every few minutes (jobs/index.js): tablets that stopped reporting.
async function checkOffline() {
  if (process.uptime() < SETTLE_SECONDS) return 0;
  const { rows } = await db.query(
    `UPDATE room_display_devices d SET offline_alerted_at = NOW()
      WHERE d.offline_alerted_at IS NULL AND d.last_seen_at < NOW() - INTERVAL '${OFFLINE_MINUTES} minutes'
        AND EXISTS (SELECT 1 FROM properties p WHERE p.id = d.property_id AND p.is_active)
      RETURNING d.property_id, d.controller_id, d.battery_level, d.battery_charging,
                to_char(d.last_seen_at AT TIME ZONE 'Asia/Makassar',
                        CASE WHEN d.last_seen_at > NOW() - INTERVAL '12 hours' THEN 'HH24:MI' ELSE 'DD Mon HH24:MI' END) AS last_seen`);
  const byProperty = new Map();
  for (const r of rows) byProperty.set(r.property_id, [...(byProperty.get(r.property_id) || []), r]);
  for (const [propertyId, list] of byProperty) {
    const lines = [];
    for (const r of list) {
      const battery = r.battery_level == null ? '' : ` · battery was ${r.battery_level}%${r.battery_charging ? ' (charging)' : ''}`;
      lines.push(`• <b>Room ${esc(await roomName(propertyId, r.controller_id))}</b> — last seen ${r.last_seen}${battery}`);
    }
    lines.sort();
    const head = list.length === 1 ? '📵 A room tablet is offline' : `📵 ${list.length} room tablets are offline`;
    const hint = list.length >= 5
      ? 'Several at once — check the WiFi or the power in that area first.'
      : 'Please check that it is switched on, charging and on the WiFi.';
    await send(propertyId, `<b>${head}</b>\n${lines.join('\n')}\n${hint}`);
  }
  return rows.length;
}

module.exports = { afterTelemetry, checkOffline, ALERT };
