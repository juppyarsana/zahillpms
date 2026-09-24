const db = require('../db');
const { CARD_TABLE_OPEN, CARD_TABLE_CLOSE, CARD_HEIGHT, card } = require('./emailCards');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');

// Tomorrow Preview (Reports & Alerts, paid — smart_reports): sent at 19:00
// WITA so the manager, front desk and kitchen can plan the next day —
// arrivals (with requests and groups), rooms that must be ready (still dirty,
// same-day turnover, out of order), departures and what to collect, and the
// breakfast / dinner count. Built on loadGuestLists / loadBalanceDue, so it
// matches the Guest Lists and Balance Due pages for that date.

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const rooms = n => `${n} room${n === 1 ? '' : 's'}`;
function fmtDay(ymd, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}
function appUrl(path) {
  const base = (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}

// date: the day to preview (default tomorrow, WITA).
async function buildTomorrowPreview(propertyId, { date } = {}) {
  const day = date || addDays(todayWITA(), 1);
  const { loadGuestLists, loadBalanceDue } = require('../routes/bookings');
  const [gl, due, { rows: [ps] }, { rows: units }] = await Promise.all([
    loadGuestLists(propertyId, day),
    loadBalanceDue(propertyId, day),
    db.query('SELECT property_name FROM property_settings WHERE property_id = $1', [propertyId]),
    db.query(
      'SELECT name, status, housekeeping_status, status_reason FROM units WHERE property_id = $1',
      [propertyId]
    ),
  ]);
  const unitByName = new Map(units.map(u => [u.name, u]));
  const sellable = units.filter(u => u.status !== 'out_of_order').length;
  const departingUnits = new Set(gl.departures.map(d => d.unit_name));

  // Every arrival's room, and why it may not be ready yet.
  const prepare = [];
  for (const a of gl.arrivals) {
    const u = unitByName.get(a.unit_name);
    if (!u) continue;
    if (u.status === 'out_of_order') prepare.push({ unit_name: a.unit_name, guest_name: a.guest_name, why: `out of order${u.status_reason ? ` (${u.status_reason})` : ''}`, severity: 'high' });
    else if (departingUnits.has(a.unit_name)) prepare.push({ unit_name: a.unit_name, guest_name: a.guest_name, why: 'same-day turnover — current guest leaves that morning', severity: 'medium' });
    else if (u.housekeeping_status === 'dirty') prepare.push({ unit_name: a.unit_name, guest_name: a.guest_name, why: 'not cleaned yet', severity: 'medium' });
  }

  const groupIds = new Set(gl.arrivals.filter(a => a.reservation_group_id).map(a => a.reservation_group_id));
  const collectRows = due.departing.filter(r => !r.agent_billed);
  const tonightRooms = gl.arrivals.length + gl.in_house.length;

  return {
    date: day,
    property_name: ps?.property_name || 'Your property',
    arrivals: gl.summary.arrivals,
    departures: gl.summary.departures,
    in_house: gl.summary.in_house,
    breakfast_pax: gl.summary.breakfast_pax,
    dinner_pax: gl.summary.dinner_pax,
    occupancy: { rooms: tonightRooms, sellable, pct: sellable ? Math.round((tonightRooms / sellable) * 100) : 0 },
    group_arrivals: groupIds.size,
    arrival_rows: gl.arrivals.map(a => ({
      unit_name: a.unit_name, unit_type: a.unit_type, guest_name: a.guest_name, num_guests: a.num_guests,
      nights: a.nights, source_label: a.source_label, rate_plan_code: a.rate_plan_code,
      special_requests: a.special_requests, bed_preference: a.bed_preference, group: !!a.reservation_group_id,
    })),
    departure_rows: gl.departures.map(d => ({ unit_name: d.unit_name, guest_name: d.guest_name })),
    prepare,
    to_collect: {
      amount: collectRows.reduce((s, r) => s + r.balance_due, 0),
      rows: collectRows.map(r => ({ unit_name: r.unit_name, guest_name: r.guest_name, balance_due: r.balance_due })),
    },
    link: appUrl('/guest-lists'),
  };
}

function tomorrowPreviewTelegram(b) {
  const e = telegram.escapeHtml;
  const L = [];
  L.push(`🌆 <b>${e(b.property_name)}</b> · ${e(fmtDay(b.date, { weekday: 'long', day: 'numeric', month: 'short' }))}`);
  L.push('<i>Tomorrow Preview</i>');
  L.push('');
  L.push(`🛬 Arriving: <b>${rooms(b.arrivals.rooms)}</b> · ${b.arrivals.pax} pax${b.group_arrivals ? ` · 👥 ${b.group_arrivals} group${b.group_arrivals === 1 ? '' : 's'}` : ''}`);
  L.push(`🛫 Departing: <b>${rooms(b.departures.rooms)}</b> · ${b.departures.pax} pax`);
  L.push(`🛏 Staying over: <b>${rooms(b.in_house.rooms)}</b> · ${b.in_house.pax} pax`);
  L.push(`📊 Tomorrow night: <b>${b.occupancy.rooms}/${b.occupancy.sellable}</b> rooms (${b.occupancy.pct}%)`);
  if (b.breakfast_pax || b.dinner_pax) L.push(`🍳 Breakfast: <b>${b.breakfast_pax}</b> pax${b.dinner_pax ? ` · 🍽 Dinner: <b>${b.dinner_pax}</b> pax` : ''}`);
  if (b.to_collect.amount > 0) L.push(`💰 To collect: <b>${e(fmtIDR(b.to_collect.amount))}</b> from ${rooms(b.to_collect.rows.length)} leaving`);

  if (b.prepare.length) {
    L.push('');
    L.push('🧹 <b>Rooms to get ready</b>');
    for (const p of b.prepare.slice(0, 8)) L.push(`• ${e(p.unit_name)} (${e(p.guest_name)}) — ${e(p.why)}`);
    if (b.prepare.length > 8) L.push(`• …and ${b.prepare.length - 8} more`);
  }
  const requests = b.arrival_rows.filter(a => a.special_requests);
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

function tomorrowPreviewEmail(b) {
  const esc = telegram.escapeHtml;
  const tile = (label, value, sub) => card(label, value, sub, { height: CARD_HEIGHT.one });
  const section = (title, inner) => `
    <div style="margin-top:22px;">
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">${title}</div>${inner}
    </div>`;
  const table = (heads, rows, empty) => rows.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>${heads.map(h => `<th style="text-align:${h.right ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;">${h.label}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map((c, i) => `<td style="padding:8px;border-bottom:1px solid #f3f4f6;vertical-align:top;text-align:${heads[i].right ? 'right' : 'left'};">${c}</td>`).join('')}</tr>`).join('')}
    </table>` : `<div style="font-size:13px;color:#9ca3af;">${empty}</div>`;
  const bed = { double: 'Double', twin: 'Twin', twin_or_double: 'Twin or double', other: 'Other' };

  const prepare = b.prepare.length
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7;color:#78350f;">${b.prepare.map(p => `${p.severity === 'high' ? '🔧' : '🧹'} <b>${esc(p.unit_name)}</b> for ${esc(p.guest_name)} — ${esc(p.why)}`).join('<br>')}</div>`
    : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;font-size:13px;color:#166534;">✅ Every arriving guest's room is clean and free.</div>`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#111827;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Tomorrow Preview</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px;">${esc(b.property_name)}</div>
    <div style="font-size:14px;color:#6b7280;margin-bottom:16px;">${esc(fmtDay(b.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div>

    ${CARD_TABLE_OPEN}<tr>
      ${tile('Arriving', rooms(b.arrivals.rooms), `${b.arrivals.pax} pax${b.group_arrivals ? ` · ${b.group_arrivals} group${b.group_arrivals === 1 ? '' : 's'}` : ''}`)}
      ${tile('Departing', rooms(b.departures.rooms), `${b.departures.pax} pax`)}
      ${tile('Occupancy', `${b.occupancy.pct}%`, `${b.occupancy.rooms} of ${b.occupancy.sellable} rooms`)}
    </tr><tr>
      ${tile('Breakfast', `${b.breakfast_pax} pax`, 'that morning')}
      ${tile('Dinner', `${b.dinner_pax} pax`, 'that night')}
      ${tile('To collect', esc(fmtIDR(b.to_collect.amount)), `from ${rooms(b.to_collect.rows.length)} leaving`)}
    </tr>${CARD_TABLE_CLOSE}

    ${section('Rooms to get ready', prepare)}
    ${section('Arriving', table([{ label: 'Room' }, { label: 'Guest' }, { label: 'Stay' }, { label: 'Notes' }],
      b.arrival_rows.map(a => [
        `${esc(a.unit_name)}<div style="font-size:11px;color:#9ca3af;">${esc(a.unit_type || '')}</div>`,
        `${esc(a.guest_name)}${a.group ? ' 👥' : ''}<div style="font-size:11px;color:#9ca3af;">${esc(a.source_label || '')}</div>`,
        `${a.num_guests} pax · ${a.nights}n${a.rate_plan_code ? ` · ${esc(a.rate_plan_code)}` : ''}`,
        [a.bed_preference && bed[a.bed_preference], a.special_requests].filter(Boolean).map(esc).join(' · '),
      ]), 'No arrivals.'))}
    ${section('Departing', table([{ label: 'Room' }, { label: 'Guest' }],
      b.departure_rows.map(d => [esc(d.unit_name), esc(d.guest_name)]), 'No departures.'))}
    ${section('To collect from guests leaving', table([{ label: 'Room' }, { label: 'Guest' }, { label: 'Balance', right: true }],
      b.to_collect.rows.map(r => [esc(r.unit_name), esc(r.guest_name), esc(fmtIDR(r.balance_due))]), 'All settled — nothing to collect.'))}
    ${b.link ? `<div style="margin-top:24px;"><a href="${esc(b.link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;">Open Guest Lists</a></div>` : ''}
    <div style="margin-top:28px;font-size:11px;color:#9ca3af;">Sent by Smart Reports. Manage recipients in Settings → Reports &amp; Alerts.</div>
  </div>`;
  return {
    subject: `🌆 ${b.property_name} — Tomorrow: ${rooms(b.arrivals.rooms)} arriving, ${b.breakfast_pax} breakfast${b.prepare.length ? ` · 🧹 ${b.prepare.length} to get ready` : ''}`,
    html,
  };
}

module.exports = { buildTomorrowPreview, tomorrowPreviewTelegram, tomorrowPreviewEmail };
