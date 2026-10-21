// Channel Manager stage 4 (migration 122): is the connection working, and is
// the hotel ready to go live?
//
//   failed / recovered  — called by channelSync (sending) and channelBookings
//                         (reading) after each try. A Telegram alert
//                         (`alert_channel_manager`) goes once 15 minutes
//                         after it started failing (checkAlerts, every 5 min)
//                         and once when it works again.
//   checklist           — the go-live checklist on the Channel Manager page.
//   compare             — the next N nights as Channex holds them vs the PMS.
const db = require('../db');
const channex = require('./channexAdapter');
const telegramService = require('./telegramService');

const ALERT = 'alert_channel_manager';
const FAIL_MINUTES = 15;
const WHAT = { send: 'Sending free rooms and prices to the channel manager', pull: 'Reading OTA bookings from the channel manager' };

async function failed(propertyId, kind) {
  await db.query(
    `INSERT INTO channel_sync_state (property_id, ${kind}_failing_since) VALUES ($1, NOW())
     ON CONFLICT (property_id) DO UPDATE SET ${kind}_failing_since = COALESCE(channel_sync_state.${kind}_failing_since, NOW())`, [propertyId]);
}

async function recovered(propertyId, kind) {
  const { rows: [s] } = await db.query(
    `UPDATE channel_sync_state SET ${kind}_failing_since = NULL, ${kind}_alerted_at = NULL
      WHERE property_id = $1 AND ${kind}_failing_since IS NOT NULL
      RETURNING (SELECT ${kind}_alerted_at FROM channel_sync_state WHERE property_id = $1) AS alerted`, [propertyId]);
  if (s?.alerted) {
    telegramService.sendAlert(propertyId, ALERT, `✅ <b>Channel manager working again</b>\n${WHAT[kind]} works again.`, { html: true }).catch(() => {});
  }
}

// Every 5 minutes: one alert per problem that has lasted 15 minutes.
async function checkAlerts() {
  for (const kind of ['send', 'pull']) {
    const { rows } = await db.query(
      `UPDATE channel_sync_state SET ${kind}_alerted_at = NOW()
        WHERE ${kind}_failing_since < NOW() - make_interval(mins => $1) AND ${kind}_alerted_at IS NULL
        RETURNING property_id, ${kind === 'send' ? 'last_error' : 'last_pull_error'} AS error, ${kind}_failing_since AS since`, [FAIL_MINUTES]);
    for (const r of rows) {
      const h = telegramService.escapeHtml;
      const since = new Date(r.since).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit' });
      const lines = [`⚠️ <b>Channel manager not working</b>`, `${WHAT[kind]} has failed since ${since}.`,
        kind === 'send' ? 'The OTAs may be selling rooms or prices that are out of date.' : 'New OTA bookings are not reaching the PMS yet (they wait in the channel manager).',
        r.error ? `\n<i>${h(String(r.error).slice(0, 300))}</i>` : '', '\nThe PMS keeps trying — see Settings → Channel Manager.'];
      telegramService.sendAlert(r.property_id, ALERT, lines.filter(Boolean).join('\n'), { html: true }).catch(() => {});
    }
  }
}

// ── Compare with Channex ─────────────────────────────────────

async function compare(propertyId, days = 30) {
  const channelSync = require('./channelSync');
  const { rows: [p] } = await db.query('SELECT channex_property_id FROM properties WHERE id = $1', [propertyId]);
  if (!p?.channex_property_id) { const e = new Error('Link the channel manager property first'); e.status = 400; throw e; }
  const { values, from } = await channelSync.desiredValues(propertyId);
  const to = new Date(Date.parse(from + 'T00:00:00Z') + (days - 1) * 86400000).toISOString().slice(0, 10);
  const held = await channex.readAri(p.channex_property_id, from, to);
  const { rows: names } = await db.query(`
    SELECT 'a' AS kind, c.external_room_type_id AS ext, rt.name FROM channel_room_types c JOIN room_types rt ON rt.id = c.room_type_id WHERE c.property_id = $1
    UNION ALL
    SELECT 'r', c.external_rate_plan_id, rt.name || ' · ' || rp.name FROM channel_rate_plans c
      JOIN room_types rt ON rt.id = c.room_type_id JOIN rate_plans rp ON rp.id = c.rate_plan_id WHERE c.property_id = $1`, [propertyId]);
  const nameOf = new Map(names.map(n => [`${n.kind}|${n.ext}`, n.name]));
  const differences = [];
  let checked = 0;
  for (const [key, pms] of values) {
    const [kind, ext, night] = key.split('|');
    if (night > to) continue;
    checked++;
    const raw = kind === 'a' ? held.availability[ext]?.[night] : held.rates[ext]?.[night];
    const cx = raw == null ? null : Number(raw);
    if (cx !== pms) differences.push({ kind: kind === 'a' ? 'free rooms' : 'price', name: nameOf.get(`${kind}|${ext}`) || ext, night, pms, channex: cx });
  }
  differences.sort((a, b) => (a.night < b.night ? -1 : a.night > b.night ? 1 : a.name.localeCompare(b.name)));
  return { from, to, days, checked, different: differences.length, differences: differences.slice(0, 100) };
}

// ── Go-live checklist ────────────────────────────────────────

const item = (key, state, title, detail = null) => ({ key, state, title, detail });   // state: ok / warn / fail / info

async function checklist(propertyId) {
  const cm = require('./channelManagerService');
  const channelSync = require('./channelSync');
  const out = [];
  const setup = await cm.getSetup(propertyId);

  out.push(!setup.configured ? item('env', 'fail', 'The channel manager is not set up on this server', 'The platform team adds the API key.')
    : setup.environment === 'production' ? item('env', 'ok', 'Connected to the live channel manager')
    : item('env', 'fail', 'Connected to the channel manager TEST system', 'Before go-live the server must use the live channel manager account (API key + address).'));
  if (setup.channex_error) out.push(item('reach', 'fail', 'The channel manager could not be reached', setup.channex_error));

  if (!setup.property) {
    out.push(item('property', 'fail', 'The channel manager property is not linked', 'Step 1 below.'));
    return { items: out, ready: false };
  }
  out.push(setup.property.found === false ? item('property', 'fail', 'The linked property is no longer in the channel manager account')
    : item('property', 'ok', `Linked to "${setup.property.title || setup.property.external_id}"${setup.property.currency && setup.property.currency !== 'IDR' ? ` (${setup.property.currency}!)` : ''}`));

  const withRooms = setup.room_types.filter(rt => rt.rooms > 0);
  const linked = withRooms.filter(rt => rt.link);
  const unlinked = withRooms.filter(rt => !rt.link);
  out.push(!linked.length ? item('types', 'fail', 'No room type is linked', 'Step 2 below.')
    : unlinked.length ? item('types', 'warn', `${linked.length} of ${withRooms.length} room types linked`, `Not sold on the OTAs through the channel manager: ${unlinked.map(r => r.name).join(', ')}. Fine if on purpose.`)
    : item('types', 'ok', `All ${linked.length} room types linked`));
  const differs = linked.filter(rt => rt.link.differs);
  if (differs.length) out.push(item('counts', 'fail', 'Room count or guests differ in the channel manager', `${differs.map(r => r.name).join(', ')} — press Update in the channel manager.`));
  const noPlan = linked.filter(rt => !(rt.rate_plans || []).some(p => p.link));
  if (noPlan.length) out.push(item('plans', 'fail', 'A room type has no meal plan linked — it has no price on the OTAs', noPlan.map(r => r.name).join(', ')));
  else if (linked.length) out.push(item('plans', 'ok', 'Every linked room type has a meal plan linked'));

  // Prices and closed nights, next 30 nights, from what the PMS sends.
  const { values, from } = await channelSync.desiredValues(propertyId);
  const lastNight = new Date(Date.parse(from + 'T00:00:00Z') + 29 * 86400000).toISOString().slice(0, 10);
  let zero = 0;
  for (const [k, v] of values) { const [kind, , night] = k.split('|'); if (kind === 'r' && night <= lastNight && !(v > 0)) zero++; }
  out.push(zero ? item('prices', 'fail', `${zero} night prices are Rp 0 in the next 30 nights`, 'Check the room type rates and pricing periods.')
    : item('prices', 'ok', 'Every price in the next 30 nights is above Rp 0'));
  const { rows: ooo } = await db.query(`
    SELECT u.name FROM units u JOIN channel_room_types c ON c.room_type_id = u.room_type_id AND c.property_id = u.property_id
     WHERE u.property_id = $1 AND u.status = 'out_of_order' AND u.status_expected_back IS NULL ORDER BY u.name`, [propertyId]);
  if (ooo.length) out.push(item('ooo', 'warn', `${ooo.length} room${ooo.length === 1 ? '' : 's'} out of order with no return date`, `${ooo.map(o => o.name).join(', ')} — not sold on the OTAs for the whole year until a date is set or the room is back.`));

  // Sending / reading.
  const st = await channelSync.status(propertyId);
  const ago = t => (t ? Math.round((Date.now() - new Date(t).getTime()) / 60000) : null);
  if (!st?.last_ok_at) out.push(item('send', 'fail', 'Free rooms and prices have not been sent yet', 'Press Send everything now (card 3).'));
  else if (st.last_error && new Date(st.last_error_at) > new Date(st.last_ok_at)) out.push(item('send', 'fail', 'Sending to the channel manager is failing', st.last_error));
  else if (ago(st.last_full_at) == null || ago(st.last_full_at) > 26 * 60) out.push(item('send', 'warn', 'No full send in the last day', 'It runs every night at 04:10, or press Send everything now.'));
  else out.push(item('send', 'ok', 'Free rooms and prices are being sent'));
  const { rows: [pull] } = await db.query('SELECT last_pull_at, last_pull_error FROM channel_sync_state WHERE property_id = $1', [propertyId]);
  if (pull?.last_pull_error) out.push(item('pull', 'fail', 'Reading OTA bookings is failing', pull.last_pull_error));
  const wh = await require('./channelWebhook').status(propertyId);
  const instant = wh.on && wh.last_webhook_at;
  const limit = instant ? 20 : 5;
  if (pull?.last_pull_error) { /* above */ }
  else if (ago(pull?.last_pull_at) == null || ago(pull.last_pull_at) > limit) out.push(item('pull', 'warn', `OTA bookings have not been read in the last ${limit} minutes`, 'Press Check now (card 4).'));
  else out.push(item('pull', 'ok', instant ? 'OTA bookings come in by the webhook, with a back-up read every 15 minutes' : 'OTA bookings are being read every minute'));
  out.push(wh.on ? item('webhook', 'ok', 'The channel manager tells the PMS the moment a booking comes in', wh.last_webhook_at ? `Last call ${new Date(wh.last_webhook_at).toLocaleString('en-GB', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No call yet — it comes with the first OTA booking.')
    : !wh.public_url ? item('webhook', setup.environment === 'production' ? 'warn' : 'info', 'Bookings are read every minute only (no instant call from the channel manager)', 'The server needs its public https address (SERVER_PUBLIC_URL) for the channel manager to call it.')
    : item('webhook', 'warn', 'The channel manager is not set to call the PMS when a booking comes in', `${wh.error ? `${wh.error} — ` : ''}press Turn on instant (card 4). Bookings are still read every minute.`));
  const { rows: [{ open }] } = await db.query(
    `SELECT count(*)::int AS open FROM channel_revisions WHERE property_id = $1 AND result IN ('attention', 'error') AND handled_at IS NULL`, [propertyId]);
  if (open) out.push(item('open', 'warn', `${open} OTA booking${open === 1 ? '' : 's'} need${open === 1 ? 's' : ''} you`, 'Card 4 below.'));

  // Telegram.
  const { rows: rec } = await db.query(`
    SELECT r FROM unnest(ARRAY['alert_new_booking', $2]) AS r
     WHERE NOT EXISTS (SELECT 1 FROM notification_recipients n WHERE n.property_id = $1 AND n.is_active AND n.channel = 'telegram'
                         AND n.address IS NOT NULL AND r = ANY(n.reports))`, [propertyId, ALERT]);
  const missing = rec.map(r => r.r === ALERT ? 'Channel manager problems' : 'New booking');
  out.push(missing.length ? item('alerts', 'warn', `No one gets the "${missing.join('" / "')}" Telegram alert`, 'Settings → Reports & Alerts: tick it for the owner / front desk.')
    : item('alerts', 'ok', 'Telegram alerts for new OTA bookings and connection problems are on'));

  // Bookings already in the PMS.
  const { rows: [{ n }] } = await db.query(`
    SELECT count(*)::int AS n FROM bookings b JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
     WHERE b.property_id = $1 AND bs.is_ota AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
       AND b.check_out_date >= (NOW() AT TIME ZONE 'Asia/Makassar')::date
       AND NOT EXISTS (SELECT 1 FROM channel_booking_rooms cr WHERE cr.booking_id = b.id)`, [propertyId]);
  if (n) out.push(item('existing', 'info', `${n} upcoming OTA booking${n === 1 ? '' : 's'} already in the PMS (typed in or imported)`,
    'When an OTA is connected it may send these again. The PMS matches them (room type, dates, guest name or reservation code) and links them instead of booking twice — check Reservations → To check afterwards.'));
  out.push(item('otas', 'info', 'Ask the platform team to connect each OTA, one at a time',
    'Until an OTA is connected, keep its availability and prices in the OTA\'s own extranet. After connecting, compare a few nights on the OTA with the PMS (Compare with the channel manager, card 3).'));

  return { items: out, ready: !out.some(i => i.state === 'fail') };
}

module.exports = { failed, recovered, checkAlerts, checklist, compare, ALERT };
