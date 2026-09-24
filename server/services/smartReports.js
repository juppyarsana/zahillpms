const nodemailer = require('nodemailer');
const db = require('../db');
const { resolveSmtp } = require('./mailer');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');
const dailyClose = require('./dailyClose');
const tomorrowPreview = require('./tomorrowPreview');
const weeklyOwner = require('./weeklyOwner');

// Reports & Alerts (migration 068): everything sent to a property's
// notification_recipients (Settings → Reports & Alerts).
//   type 'alert'     — instant Telegram messages fired by an event
//                      (telegramService.sendAlert(propertyId, key, text)).
//                      FREE for every property; Telegram only.
//   type 'scheduled' — routine reports (Morning Brief, …) by Telegram (short,
//                      read on a phone) or email (fuller, with tables). Built
//                      ONCE per property, rendered per channel. PAID: need the
//                      `smart_reports` module.
// defaultRoles decides which reports are ticked when a recipient is added.
const REPORTS = {
  alert_new_booking: {
    type: 'alert',
    label: 'New bookings',
    when: 'Instantly',
    description: 'A message for every new booking: guest, room and dates.',
    defaultRoles: ['owner', 'manager', 'front_desk'],
    channels: ['telegram'],
    paid: false,
  },
  alert_guest_requests: {
    type: 'alert',
    label: 'Guest requests & calls',
    when: 'Instantly',
    description: 'Clean Room and Do Not Disturb from the room tablet, and a room calling the front desk.',
    defaultRoles: ['manager', 'front_desk'],
    channels: ['telegram'],
    paid: false,
  },
  alert_owner_control: {
    type: 'alert',
    label: 'Owner control alerts',
    when: 'Instantly',
    description: 'A price edited, a free or discounted upgrade or stay extension, or a guest checked in without full payment — with who did it and why.',
    defaultRoles: ['owner'],
    channels: ['telegram'],
    paid: true,
  },
  daily_close: {
    type: 'scheduled',
    label: 'Daily Close',
    when: 'Every night at 00:30, for the day that just ended',
    description: "Yesterday's revenue (room, meals, extras), occupancy, ADR and RevPAR — each compared with the same day last week — money received by payment method, new bookings, cancellations, no-shows; plus today's arrivals, guests overdue to check out, and balances to collect. Replaces the night audit email once anyone gets it.",
    defaultRoles: ['owner', 'manager'],
    channels: ['telegram', 'email'],
    paid: true,
  },
  tomorrow_preview: {
    type: 'scheduled',
    label: 'Tomorrow Preview',
    when: 'Every day at 19:00',
    description: "Tomorrow's arrivals (requests, bed setup, groups), rooms to get ready (not cleaned, same-day turnover, out of order), departures and balances to collect, and the breakfast and dinner count — so the team and the kitchen can plan.",
    defaultRoles: ['manager', 'front_desk', 'kitchen'],
    channels: ['telegram', 'email'],
    paid: true,
  },
  weekly_owner: {
    type: 'scheduled',
    label: 'Weekly Owner Report',
    when: 'Every Monday at 08:00, for last week',
    description: "Last week vs the week before (revenue, occupancy, ADR, RevPAR, net income when expenses are recorded), what's already booked for the next 14 and 30 days with the weak nights to push, booking pace, where bookings came from, and what agents owe.",
    defaultRoles: ['owner'],
    channels: ['telegram', 'email'],
    paid: true,
  },
  morning_brief: {
    type: 'scheduled',
    label: 'Morning Brief',
    when: 'Every day at 07:00',
    description: "Today's arrivals, in-house and departures, tonight's occupancy, breakfast count, money to collect, and what needs attention (dirty rooms, overdue guests, rooms out of order).",
    defaultRoles: ['manager', 'front_desk'],
    channels: ['telegram', 'email'],
    paid: true,
  },
};
const ROLES = ['owner', 'manager', 'front_desk', 'kitchen', 'other'];

// Can this recipient get this report? { ok } or { error }.
function reportAllowed(key, { channel, moduleEnabled }) {
  const r = REPORTS[key];
  if (!r) return { error: 'Unknown report' };
  if (!r.channels.includes(channel)) return { error: `${r.label} is sent by ${r.channels.map(c => (c === 'email' ? 'email' : 'Telegram')).join(' or ')} only` };
  if (r.paid && !moduleEnabled) return { error: `${r.label} is part of the Smart Reports add-on, which isn't enabled for this property` };
  return { ok: true };
}

function defaultReportsFor(role, { channel, moduleEnabled }) {
  return Object.entries(REPORTS)
    .filter(([key, r]) => r.defaultRoles.includes(role) && reportAllowed(key, { channel, moduleEnabled }).ok)
    .map(([key]) => key);
}

async function isModuleEnabled(propertyId) {
  const { rows: [m] } = await db.query(
    "SELECT is_enabled FROM property_modules WHERE property_id = $1 AND module = 'smart_reports'",
    [propertyId]
  );
  return !!m?.is_enabled;
}

// Loaded lazily: routes/bookings.js pulls in a lot, and requiring it at the
// top of this file would load it before the app has mounted anything.
function bookingLoaders() {
  return require('../routes/bookings');
}

const rooms = n => `${n} room${n === 1 ? '' : 's'}`;
const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
function fmtDateLong(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtDateShort(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function appUrl(path) {
  const base = (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}

async function propertySettings(propertyId) {
  const { rows: [ps] } = await db.query(
    `SELECT property_name, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from, telegram_bot_token
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  return ps || {};
}

// Own bot, else the platform bot (same rule as telegramService.botTokenFor).
const botToken = ps => ps.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || null;

// ── Morning Brief ────────────────────────────────────────────────────────────
// Same figures as the Guest Lists and Balance Due pages for today (they share
// loadGuestLists / loadBalanceDue), plus room state from `units`.
async function buildMorningBrief(propertyId) {
  const { loadGuestLists, loadBalanceDue } = bookingLoaders();
  const date = todayWITA();
  const [gl, bd, ps, { rows: units }] = await Promise.all([
    loadGuestLists(propertyId, date),
    loadBalanceDue(propertyId, date),
    propertySettings(propertyId),
    db.query(
      `SELECT id, name, status, housekeeping_status, status_reason, status_expected_back
       FROM units WHERE property_id = $1 ORDER BY name`,
      [propertyId]
    ),
  ]);

  const outOfOrder = units.filter(u => u.status === 'out_of_order');
  const sellable = units.length - outOfOrder.length;
  // Rooms with someone sleeping here tonight: guests still to arrive today +
  // guests staying over. Overdue guests are left out (they should be leaving).
  const tonightRooms = gl.arrivals.length + gl.in_house.length;
  const arrivalUnits = new Set(gl.arrivals.map(a => a.unit_name));
  const dirty = units.filter(u => u.housekeeping_status === 'dirty' && u.status !== 'occupied');

  const toCollectRows = [...bd.departing, ...bd.overdue].filter(r => !r.agent_billed);

  return {
    date,
    property_name: ps.property_name || 'Your property',
    arrivals: gl.summary.arrivals,
    in_house: gl.summary.in_house,
    departures: gl.summary.departures,
    breakfast_pax: gl.summary.breakfast_pax,
    dinner_pax: gl.summary.dinner_pax,
    tonight: {
      rooms: tonightRooms,
      sellable,
      pct: sellable > 0 ? Math.round((tonightRooms / sellable) * 100) : 0,
    },
    to_collect: {
      amount: bd.totals.departing + bd.totals.overdue,
      rooms: toCollectRows.length,
      rows: toCollectRows.map(r => ({ unit_name: r.unit_name, guest_name: r.guest_name, balance_due: r.balance_due })),
    },
    attention: {
      dirty_for_arrival: dirty.filter(u => arrivalUnits.has(u.name)).map(u => u.name),
      dirty_other: dirty.filter(u => !arrivalUnits.has(u.name)).map(u => u.name),
      overdue: gl.departures.filter(d => d.overdue).map(d => ({ unit_name: d.unit_name, guest_name: d.guest_name, check_out_date: d.check_out_date })),
      late_arrivals: gl.arrivals.filter(a => a.late_arrival).map(a => ({ unit_name: a.unit_name, guest_name: a.guest_name, check_in_date: a.check_in_date })),
      out_of_order: outOfOrder.map(u => ({ unit_name: u.name, reason: u.status_reason, expected_back: u.status_expected_back })),
    },
    arrival_rows: gl.arrivals.map(a => ({
      unit_name: a.unit_name, guest_name: a.guest_name, num_guests: a.num_guests,
      source_label: a.source_label, special_requests: a.special_requests,
    })),
    link: appUrl('/guest-lists'),
  };
}

function attentionCount(b) {
  const a = b.attention;
  return a.dirty_for_arrival.length + a.overdue.length + a.late_arrivals.length + a.out_of_order.length;
}

function morningBriefTelegram(b) {
  const e = telegram.escapeHtml;
  const a = b.attention;
  const L = [];
  L.push(`☀️ <b>${e(b.property_name)}</b> · ${e(fmtDateShort(b.date))}`);
  L.push('<i>Morning Brief</i>');
  L.push('');
  L.push(`🛬 Arriving: <b>${rooms(b.arrivals.rooms)}</b> · ${b.arrivals.pax} pax`);
  L.push(`🛏 In-house: <b>${rooms(b.in_house.rooms)}</b> · ${b.in_house.pax} pax`);
  L.push(`🛫 Departing: <b>${rooms(b.departures.rooms)}</b> · ${b.departures.pax} pax`);
  L.push(`📊 Tonight: <b>${b.tonight.rooms}/${b.tonight.sellable}</b> rooms (${b.tonight.pct}%)`);
  if (b.breakfast_pax > 0) L.push(`🍳 Breakfast: <b>${b.breakfast_pax}</b> pax`);
  if (b.to_collect.amount > 0) L.push(`💰 To collect: <b>${e(fmtIDR(b.to_collect.amount))}</b> from ${rooms(b.to_collect.rooms)} leaving`);

  const items = [];
  if (a.dirty_for_arrival.length) items.push(`🧹 Not clean, guest arriving: ${e(a.dirty_for_arrival.join(', '))}`);
  // More than 3 of a kind → one line with the room numbers, so the message
  // stays readable on a phone (the email has the full detail).
  if (a.overdue.length > 3) items.push(`⏰ ${a.overdue.length} guests overdue (still checked in): ${e(a.overdue.map(o => o.unit_name).join(', '))}`);
  else for (const o of a.overdue) items.push(`⏰ ${e(o.unit_name)} ${e(o.guest_name)} — overdue, was due out ${e(fmtDateShort(o.check_out_date))}`);
  if (a.late_arrivals.length > 3) items.push(`🕓 ${a.late_arrivals.length} late arrivals (due before today): ${e(a.late_arrivals.map(l => l.unit_name).join(', '))}`);
  else for (const l of a.late_arrivals) items.push(`🕓 ${e(l.unit_name)} ${e(l.guest_name)} — late arrival, was due ${e(fmtDateShort(l.check_in_date))}`);
  if (a.out_of_order.length > 3) items.push(`🔧 ${a.out_of_order.length} rooms out of order: ${e(a.out_of_order.map(o => o.unit_name).join(', '))}`);
  else for (const o of a.out_of_order) items.push(`🔧 ${e(o.unit_name)} out of order${o.reason ? ` (${e(o.reason)})` : ''}`);
  if (a.dirty_other.length) items.push(`🧹 Other rooms to clean: ${e(a.dirty_other.join(', '))}`);
  L.push('');
  if (items.length) {
    L.push('⚠️ <b>Needs attention</b>');
    for (const i of items) L.push(`• ${i}`);
  } else {
    L.push('✅ Nothing needs attention');
  }

  const requests = b.arrival_rows.filter(r => r.special_requests);
  if (requests.length) {
    L.push('');
    L.push('📝 <b>Arrival requests</b>');
    for (const r of requests.slice(0, 6)) {
      const text = r.special_requests.length > 80 ? r.special_requests.slice(0, 77) + '…' : r.special_requests;
      L.push(`• ${e(r.unit_name)} ${e(r.guest_name)}: ${e(text)}`);
    }
    if (requests.length > 6) L.push(`• …and ${requests.length - 6} more`);
  }
  if (b.link) {
    L.push('');
    L.push(`<a href="${e(b.link)}">Open Guest Lists →</a>`);
  }
  return L.join('\n');
}

function morningBriefEmail(b) {
  const esc = telegram.escapeHtml;
  const a = b.attention;
  const tile = (label, value, sub) => `
    <td style="width:33%;padding:5px;vertical-align:top;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 14px;">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${label}</div>
        <div style="font-size:20px;font-weight:700;color:#111827;white-space:nowrap;">${value}</div>
        ${sub ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${sub}</div>` : ''}
      </div>
    </td>`;
  const section = (title, inner) => `
    <div style="margin-top:22px;">
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">${title}</div>
      ${inner}
    </div>`;
  const table = (heads, rows, empty) => rows.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>${heads.map(h => `<th style="text-align:${h.right ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;">${h.label}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map((c, i) => `<td style="padding:8px;border-bottom:1px solid #f3f4f6;text-align:${heads[i].right ? 'right' : 'left'};color:#111827;">${c}</td>`).join('')}</tr>`).join('')}
    </table>` : `<div style="font-size:13px;color:#9ca3af;">${empty}</div>`;

  const items = [];
  if (a.dirty_for_arrival.length) items.push(`🧹 <b>Not clean, guest arriving today:</b> ${esc(a.dirty_for_arrival.join(', '))}`);
  for (const o of a.overdue) items.push(`⏰ <b>${esc(o.unit_name)}</b> ${esc(o.guest_name)} — still checked in, was due out ${esc(fmtDateShort(o.check_out_date))}`);
  for (const l of a.late_arrivals) items.push(`🕓 <b>${esc(l.unit_name)}</b> ${esc(l.guest_name)} — not arrived yet, was due ${esc(fmtDateShort(l.check_in_date))}`);
  for (const o of a.out_of_order) items.push(`🔧 <b>${esc(o.unit_name)}</b> out of order${o.reason ? ` — ${esc(o.reason)}` : ''}${o.expected_back ? ` (back ${esc(fmtDateShort(o.expected_back))})` : ''}`);
  if (a.dirty_other.length) items.push(`🧹 Other rooms to clean: ${esc(a.dirty_other.join(', '))}`);

  const attention = items.length
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7;color:#78350f;">${items.join('<br>')}</div>`
    : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;font-size:13px;color:#166534;">✅ Nothing needs attention this morning.</div>`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#111827;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Morning Brief</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px;">${esc(b.property_name)}</div>
    <div style="font-size:14px;color:#6b7280;margin-bottom:16px;">${esc(fmtDateLong(b.date))}</div>

    <table style="width:100%;border-collapse:collapse;"><tr>
      ${tile('Arriving', rooms(b.arrivals.rooms), `${b.arrivals.pax} pax`)}
      ${tile('In-house', rooms(b.in_house.rooms), `${b.in_house.pax} pax`)}
      ${tile('Departing', rooms(b.departures.rooms), `${b.departures.pax} pax`)}
    </tr><tr>
      ${tile('Tonight', `${b.tonight.pct}%`, `${b.tonight.rooms} of ${b.tonight.sellable} rooms`)}
      ${tile('Breakfast', `${b.breakfast_pax} pax`, b.dinner_pax > 0 ? `Dinner tonight: ${b.dinner_pax} pax` : '')}
      ${tile('To collect', esc(fmtIDR(b.to_collect.amount)), `from ${rooms(b.to_collect.rooms)} leaving`)}
    </tr></table>

    ${section('Needs attention', attention)}
    ${section('Arriving today', table(
      [{ label: 'Room' }, { label: 'Guest' }, { label: 'Pax' }, { label: 'Notes' }],
      b.arrival_rows.map(r => [esc(r.unit_name), `${esc(r.guest_name)}<div style="font-size:11px;color:#9ca3af;">${esc(r.source_label || '')}</div>`, r.num_guests, esc(r.special_requests || '')]),
      'No arrivals today.'
    ))}
    ${section('Balances to collect from departing guests', table(
      [{ label: 'Room' }, { label: 'Guest' }, { label: 'Balance', right: true }],
      b.to_collect.rows.map(r => [esc(r.unit_name), esc(r.guest_name), esc(fmtIDR(r.balance_due))]),
      'Nothing to collect from departing guests.'
    ))}
    ${b.link ? `<div style="margin-top:24px;"><a href="${esc(b.link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;">Open Guest Lists</a></div>` : ''}
    <div style="margin-top:28px;font-size:11px;color:#9ca3af;">Sent by Smart Reports. Manage recipients in Settings → Reports &amp; Alerts.</div>
  </div>`;
  const flag = attentionCount(b) > 0 ? ` · ⚠️ ${attentionCount(b)} to check` : '';
  return {
    subject: `☀️ ${b.property_name} — Morning Brief, ${fmtDateShort(b.date)}${flag}`,
    html,
  };
}

const BUILDERS = {
  morning_brief: { build: buildMorningBrief, telegram: morningBriefTelegram, email: morningBriefEmail },
  daily_close: { build: dailyClose.buildDailyClose, telegram: dailyClose.dailyCloseTelegram, email: dailyClose.dailyCloseEmail },
  weekly_owner: { build: weeklyOwner.buildWeeklyOwner, telegram: weeklyOwner.weeklyOwnerTelegram, email: weeklyOwner.weeklyOwnerEmail },
  tomorrow_preview: { build: tomorrowPreview.buildTomorrowPreview, telegram: tomorrowPreview.tomorrowPreviewTelegram, email: tomorrowPreview.tomorrowPreviewEmail },
};

// ── Delivery ─────────────────────────────────────────────────────────────────

async function deliver(recipient, rendered, ps) {
  if (!recipient.address) return { ok: false, error: 'Not connected yet — they need to open the Connect link and press Start' };
  if (recipient.channel === 'telegram') {
    return telegram.sendToChat(botToken(ps), recipient.address, rendered.telegram, { html: true });
  }
  const smtp = resolveSmtp(ps);
  if (!smtp) return { ok: false, error: 'No email server configured (property SMTP or PLATFORM_SMTP_*)' };
  try {
    await nodemailer.createTransport(smtp.transportConfig).sendMail({
      from: smtp.from, to: recipient.address, subject: rendered.email.subject, html: rendered.email.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function recordResult(recipientId, result) {
  await db.query(
    result.ok
      ? 'UPDATE notification_recipients SET last_sent_at = NOW(), last_error = NULL WHERE id = $1'
      : 'UPDATE notification_recipients SET last_error = $2 WHERE id = $1',
    result.ok ? [recipientId] : [recipientId, String(result.error).slice(0, 500)]
  );
}

// Builds `reportKey` for the property and sends it. recipientIds limits it to
// those recipients (the settings page's "Send test"), whether or not they are
// subscribed; otherwise every active recipient subscribed to the report.
// buildOptions: passed to the report's builder (e.g. { date } for Daily Close).
async function sendReport(propertyId, reportKey, { recipientIds = null, buildOptions = {} } = {}) {
  if (REPORTS[reportKey]?.type === 'alert') return sendTestAlert(propertyId, reportKey, recipientIds || []);
  const builder = BUILDERS[reportKey];
  if (!builder) throw new Error(`Unknown report: ${reportKey}`);
  const { rows: recipients } = recipientIds
    ? await db.query(
        'SELECT * FROM notification_recipients WHERE property_id = $1 AND id = ANY($2::uuid[])',
        [propertyId, recipientIds]
      )
    : await db.query(
        'SELECT * FROM notification_recipients WHERE property_id = $1 AND is_active AND address IS NOT NULL AND $2 = ANY(reports)',
        [propertyId, reportKey]
      );
  if (!recipients.length) return [];

  const data = await builder.build(propertyId, buildOptions);
  const rendered = { telegram: builder.telegram(data), email: builder.email(data) };
  const ps = await propertySettings(propertyId);
  const results = [];
  for (const r of recipients) {
    const result = await deliver(r, rendered, ps);
    await recordResult(r.id, result);
    results.push({ recipient_id: r.id, name: r.name, channel: r.channel, ...result });
  }
  return results;
}

// "Send test" for an instant alert: a sample message, so they can see it arrives.
async function sendTestAlert(propertyId, key, recipientIds) {
  const { rows: recipients } = await db.query(
    'SELECT * FROM notification_recipients WHERE property_id = $1 AND id = ANY($2::uuid[])',
    [propertyId, recipientIds]
  );
  const ps = await propertySettings(propertyId);
  const text = `🔔 Test from ${ps.property_name || 'your hotel'}: "${REPORTS[key].label}" alerts will arrive in this chat.`;
  const results = [];
  for (const r of recipients) {
    const result = r.channel !== 'telegram'
      ? { ok: false, error: 'Alerts are sent by Telegram only' }
      : !r.address
        ? { ok: false, error: 'Not connected yet — they need to open the Connect link and press Start' }
        : await telegram.sendToChat(botToken(ps), r.address, text);
    await recordResult(r.id, result);
    results.push({ recipient_id: r.id, name: r.name, channel: r.channel, ...result });
  }
  return results;
}

async function renderPreview(propertyId, reportKey, buildOptions = {}) {
  const builder = BUILDERS[reportKey];
  if (!builder) return null;
  const data = await builder.build(propertyId, buildOptions);
  return { telegram: builder.telegram(data), email: builder.email(data) };
}

// Scheduled run: every active property with the module on.
async function runReportAllProperties(reportKey) {
  const { rows: props } = await db.query(
    `SELECT p.id FROM properties p
     JOIN property_modules pm ON pm.property_id = p.id AND pm.module = 'smart_reports' AND pm.is_enabled
     WHERE p.is_active = true`
  );
  for (const { id } of props) {
    try {
      const results = await sendReport(id, reportKey);
      const failed = results.filter(r => !r.ok);
      if (results.length) console.log(`[Smart Reports] ${reportKey} for ${id}: sent ${results.length - failed.length}/${results.length}`);
      for (const f of failed) console.error(`[Smart Reports] ${reportKey} to ${f.name} (${f.channel}) failed: ${f.error}`);
    } catch (err) {
      console.error(`[Smart Reports] ${reportKey} failed for property ${id}:`, err.message);
    }
  }
}

module.exports = { REPORTS, ROLES, reportAllowed, defaultReportsFor, isModuleEnabled, sendReport, renderPreview, runReportAllProperties };
