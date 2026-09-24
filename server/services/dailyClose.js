const db = require('../db');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');

// Daily Close (Reports & Alerts, paid — smart_reports): the day that just
// ended, sent at 00:30 WITA (after the 00:05 night audit). Revenue comes from
// the Reports page's own getReport(), so the figures always match /reports.
// Each figure is compared with the same weekday a week earlier.
// It also carries what the night-audit owner email had (overdue guests, the
// new day's arrivals, balances to collect from guests leaving) — that email
// is skipped when a property has the Daily Close going out (see
// dailyCloseReplacesAuditEmail, used by jobs/nightAudit.js).

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
function fmtDay(ymd, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}
function appUrl(path) {
  const base = (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}

// % change vs last week, or null when last week was 0 (nothing to compare).
function change(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

async function dayFigures(propertyId, date, sellable) {
  const { getReport } = require('../routes/reports');   // lazy: route file
  const r = await getReport(propertyId, date, date);
  const roomsSold = r.total_nights;
  return {
    date,
    room: r.room_revenue,
    fnb: r.fnb_revenue,
    extras: r.ancillary_revenue,
    total: r.total_revenue,
    rooms_sold: roomsSold,
    occupancy: sellable > 0 ? Math.round((roomsSold / sellable) * 100) : 0,
    adr: roomsSold > 0 ? r.room_revenue / roomsSold : 0,
    revpar: sellable > 0 ? r.room_revenue / sellable : 0,
  };
}

// Money actually received that day: guest payments (deposit / balance /
// extras paid at the desk), extras paid directly with no booking, and agent
// payments. A pay-now extra for an in-house guest has BOTH a sale and an
// 'incidental' payment row — counted once, via the payment.
// from–to inclusive (one day by default); also used by the Monthly Report.
async function collected(propertyId, from, to = from) {
  const { rows } = await db.query(`
    WITH money AS (
      SELECT p.method, p.amount
      FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE b.property_id = $1 AND p.status = 'received'
        AND (p.received_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date
      UNION ALL
      SELECT s.payment_method, s.total_amount + COALESCE(s.service_charge_amount, 0) + COALESCE(s.tax_amount, 0)
      FROM sales s
      WHERE s.property_id = $1
        AND s.payment_method NOT IN ('room_charge', 'unpaid')
        AND s.confirmation_status IS DISTINCT FROM 'rejected'
        AND (s.created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date
        AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.sale_id = s.id)
      UNION ALL
      SELECT ap.method, ap.amount
      FROM agent_payments ap
      WHERE ap.property_id = $1 AND ap.received_on BETWEEN $2::date AND $3::date
    )
    SELECT COALESCE(pm.label, money.method, 'Other') AS method, SUM(money.amount) AS amount
    FROM money
    LEFT JOIN payment_methods pm ON pm.id = money.method AND pm.property_id = $1
    GROUP BY 1 ORDER BY 2 DESC
  `, [propertyId, from, to]);
  const byMethod = rows.map(r => ({ method: r.method, amount: parseFloat(r.amount) })).filter(r => r.amount > 0);
  return { total: byMethod.reduce((s, r) => s + r.amount, 0), by_method: byMethod };
}

async function bookingActivity(propertyId, date) {
  const [{ rows: made }, { rows: cancelled }, { rows: noShows }] = await Promise.all([
    db.query(`
      SELECT b.id, b.check_in_date, b.nights, b.total_amount - COALESCE(b.discount_amount, 0) AS value,
             g.name AS guest_name, u.name AS unit_name, COALESCE(bs.label, b.source) AS source_label
      FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
      LEFT JOIN booking_sources bs ON bs.id = b.source AND bs.property_id = b.property_id
      WHERE b.property_id = $1 AND (b.created_at AT TIME ZONE 'Asia/Makassar')::date = $2::date
      ORDER BY b.check_in_date, u.name`, [propertyId, date]),
    db.query(`
      SELECT b.id, b.check_in_date, b.nights, b.total_amount - COALESCE(b.discount_amount, 0) AS value,
             g.name AS guest_name, u.name AS unit_name
      FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
      WHERE b.property_id = $1 AND b.status = 'cancelled'
        AND (b.updated_at AT TIME ZONE 'Asia/Makassar')::date = $2::date
      ORDER BY u.name`, [propertyId, date]),
    db.query(`
      SELECT b.id, g.name AS guest_name, u.name AS unit_name
      FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
      WHERE b.property_id = $1 AND b.status = 'no_show' AND b.check_in_date = $2::date
      ORDER BY u.name`, [propertyId, date]),
  ]);
  const num = v => parseFloat(v || 0);
  return {
    new_bookings: made.map(b => ({ ...b, value: num(b.value) })),
    new_value: made.reduce((s, b) => s + num(b.value), 0),
    new_nights: made.reduce((s, b) => s + (parseInt(b.nights, 10) || 0), 0),
    cancelled: cancelled.map(b => ({ ...b, value: num(b.value) })),
    cancelled_value: cancelled.reduce((s, b) => s + num(b.value), 0),
    no_shows: noShows,
  };
}

// date: the day to close (default yesterday, WITA — the day the 00:05 night
// audit just closed).
async function buildDailyClose(propertyId, { date } = {}) {
  const day = date || addDays(todayWITA(), -1);
  const { loadGuestLists, loadBalanceDue } = require('../routes/bookings');
  const [{ rows: [ps] }, { rows: [u] }] = await Promise.all([
    db.query('SELECT property_name FROM property_settings WHERE property_id = $1', [propertyId]),
    db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order') AS sellable FROM units WHERE property_id = $1`, [propertyId]),
  ]);
  const sellable = parseInt(u.sellable, 10) || 0;
  const [today, lastWeek, money, activity, next, due] = await Promise.all([
    dayFigures(propertyId, day, sellable),
    dayFigures(propertyId, addDays(day, -7), sellable),
    collected(propertyId, day),
    bookingActivity(propertyId, day),
    loadGuestLists(propertyId, addDays(day, 1)),
    loadBalanceDue(propertyId, addDays(day, 1)),
  ]);
  // Same whole-stay figure as the Balance Due page; agent-billed stays aren't collected at the desk.
  const collectRows = [...due.departing, ...due.overdue].filter(r => !r.agent_billed);
  return {
    date: day,
    property_name: ps?.property_name || 'Your property',
    sellable,
    today,
    last_week: lastWeek,
    change: {
      total: change(today.total, lastWeek.total),
      occupancy_pts: today.occupancy - lastWeek.occupancy,
      adr: change(today.adr, lastWeek.adr),
    },
    collected: money,
    ...activity,
    next_day: {
      date: addDays(day, 1),
      arrivals: next.summary.arrivals,
      departures: next.summary.departures,
      in_house: next.summary.in_house,
      arrival_rows: next.arrivals.map(a => ({ unit_name: a.unit_name, guest_name: a.guest_name, num_guests: a.num_guests, special_requests: a.special_requests })),
      // Still checked in on/after their check-out date (rooms stay blocked).
      overdue: next.departures.filter(d => d.overdue).map(d => ({ unit_name: d.unit_name, guest_name: d.guest_name, check_out_date: String(d.check_out_date).slice(0, 10) })),
      to_collect: {
        amount: collectRows.reduce((s, r) => s + r.balance_due, 0),
        rows: collectRows.map(r => ({ unit_name: r.unit_name, guest_name: r.guest_name, balance_due: r.balance_due })),
      },
    },
    link: appUrl('/reports'),
  };
}

function arrow(pct, suffix = '%') {
  if (pct == null) return '';
  if (pct === 0) return 'same as last week';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}${suffix} vs last week`;
}

function dailyCloseTelegram(b) {
  const e = telegram.escapeHtml;
  const t = b.today;
  const L = [];
  L.push(`🌙 <b>${e(b.property_name)}</b> · ${e(fmtDay(b.date))}`);
  L.push('<i>Daily Close</i>');
  L.push('');
  L.push(`💰 Revenue: <b>${e(fmtIDR(t.total))}</b>${b.change.total != null ? ` (${arrow(b.change.total)})` : ''}`);
  L.push(`     Room ${e(fmtIDR(t.room))}${t.fnb ? ` · Meals ${e(fmtIDR(t.fnb))}` : ''}${t.extras ? ` · Extras ${e(fmtIDR(t.extras))}` : ''}`);
  L.push(`🛏 Occupancy: <b>${t.occupancy}%</b> (${t.rooms_sold}/${b.sellable})${b.change.occupancy_pts ? ` ${b.change.occupancy_pts > 0 ? '▲' : '▼'} ${Math.abs(b.change.occupancy_pts)} pts` : ''}`);
  if (t.rooms_sold > 0) L.push(`     ADR ${e(fmtIDR(t.adr))} · RevPAR ${e(fmtIDR(t.revpar))}`);
  L.push(`💳 Collected: <b>${e(fmtIDR(b.collected.total))}</b>`);
  if (b.collected.by_method.length) L.push(`     ${e(b.collected.by_method.map(m => `${m.method} ${fmtIDR(m.amount)}`).join(' · '))}`);
  L.push('');
  L.push(`📅 New bookings: <b>${b.new_bookings.length}</b>${b.new_bookings.length ? ` · ${b.new_nights} nights · ${e(fmtIDR(b.new_value))}` : ''}`);
  if (b.cancelled.length) L.push(`❌ Cancelled: <b>${b.cancelled.length}</b> · ${e(fmtIDR(b.cancelled_value))}`);
  if (b.no_shows.length) L.push(`🚫 No-shows: <b>${b.no_shows.length}</b> — ${e(b.no_shows.map(n => n.unit_name).join(', '))}`);
  L.push('');
  const n = b.next_day;
  L.push(`☀️ ${e(fmtDay(n.date, { weekday: 'long' }))}: ${n.arrivals.rooms} arriving · ${n.departures.rooms} departing`);
  if (n.to_collect.amount > 0) L.push(`💰 To collect from guests leaving: <b>${e(fmtIDR(n.to_collect.amount))}</b> (${n.to_collect.rows.length} room${n.to_collect.rows.length === 1 ? '' : 's'})`);
  if (n.overdue.length) L.push(`⏰ Still checked in past check-out: <b>${n.overdue.length}</b> — ${e(n.overdue.map(o => o.unit_name).join(', '))}`);
  if (b.link) {
    L.push('');
    L.push(`<a href="${e(b.link)}">Open Reports →</a>`);
  }
  return L.join('\n');
}

function dailyCloseEmail(b) {
  const esc = telegram.escapeHtml;
  const t = b.today;
  const lw = b.last_week;
  const cmp = (pct, suffix = '%') => pct == null ? '' :
    `<div style="font-size:12px;margin-top:2px;color:${pct > 0 ? '#15803d' : pct < 0 ? '#b91c1c' : '#6b7280'};">${pct === 0 ? 'same as last week' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}${suffix} vs last week`}</div>`;
  const tile = (label, value, sub) => `
    <td style="width:33%;padding:5px;vertical-align:top;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${label}</div>
        <div style="font-size:19px;font-weight:700;color:#111827;white-space:nowrap;">${value}</div>
        ${sub || ''}
      </div>
    </td>`;
  const section = (title, inner) => `
    <div style="margin-top:22px;">
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">${title}</div>${inner}
    </div>`;
  const table = (heads, rows, empty) => rows.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>${heads.map(h => `<th style="text-align:${h.right ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;">${h.label}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map((c, i) => `<td style="padding:8px;border-bottom:1px solid #f3f4f6;text-align:${heads[i].right ? 'right' : 'left'};">${c}</td>`).join('')}</tr>`).join('')}
    </table>` : `<div style="font-size:13px;color:#9ca3af;">${empty}</div>`;

  const revRows = [
    ['Room', t.room, lw.room], ['Meals (rate plan)', t.fnb, lw.fnb], ['Extras', t.extras, lw.extras],
  ].filter(([, a, c]) => a || c).map(([k, a, c]) => [k, esc(fmtIDR(a)), esc(fmtIDR(c))]);
  revRows.push([`<b>Total</b>`, `<b>${esc(fmtIDR(t.total))}</b>`, esc(fmtIDR(lw.total))]);

  const n = b.next_day;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#111827;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Daily Close</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px;">${esc(b.property_name)}</div>
    <div style="font-size:14px;color:#6b7280;margin-bottom:16px;">${esc(fmtDay(b.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · compared with ${esc(fmtDay(lw.date))}</div>

    <table style="width:100%;border-collapse:collapse;"><tr>
      ${tile('Revenue', esc(fmtIDR(t.total)), cmp(b.change.total))}
      ${tile('Occupancy', `${t.occupancy}%`, `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${t.rooms_sold} of ${b.sellable} rooms</div>${cmp(b.change.occupancy_pts, ' pts')}`)}
      ${tile('Collected', esc(fmtIDR(b.collected.total)), '<div style="font-size:12px;color:#6b7280;margin-top:2px;">money received</div>')}
    </tr><tr>
      ${tile('ADR', esc(fmtIDR(t.adr)), cmp(b.change.adr))}
      ${tile('RevPAR', esc(fmtIDR(t.revpar)), '')}
      ${tile('New bookings', `${b.new_bookings.length}`, `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${b.new_nights} nights · ${esc(fmtIDR(b.new_value))}</div>`)}
    </tr></table>

    ${section('Revenue', table([{ label: '' }, { label: 'This day', right: true }, { label: 'Last week', right: true }], revRows, ''))}
    ${section('Money received', table([{ label: 'Method' }, { label: 'Amount', right: true }],
      b.collected.by_method.map(m => [esc(m.method), esc(fmtIDR(m.amount))]), 'No payments received.'))}
    ${section('New bookings made', table([{ label: 'Guest' }, { label: 'Room' }, { label: 'Arrives' }, { label: 'Value', right: true }],
      b.new_bookings.map(x => [`${esc(x.guest_name)}<div style="font-size:11px;color:#9ca3af;">${esc(x.source_label || '')}</div>`, esc(x.unit_name), `${esc(fmtDay(String(x.check_in_date).slice(0, 10)))} · ${x.nights}n`, esc(fmtIDR(x.value))]),
      'No new bookings.'))}
    ${b.cancelled.length ? section('Cancelled', table([{ label: 'Guest' }, { label: 'Room' }, { label: 'Was due' }, { label: 'Value', right: true }],
      b.cancelled.map(x => [esc(x.guest_name), esc(x.unit_name), esc(fmtDay(String(x.check_in_date).slice(0, 10))), esc(fmtIDR(x.value))]), '')) : ''}
    ${b.no_shows.length ? section('No-shows', `<div style="font-size:13px;">${b.no_shows.map(x => `${esc(x.unit_name)} ${esc(x.guest_name)}`).join('<br>')}</div>`) : ''}
    ${n.overdue.length ? section('⚠️ Still checked in past check-out', `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7;color:#991b1b;">${n.overdue.map(o => `<b>${esc(o.unit_name)}</b> ${esc(o.guest_name)} — was due out ${esc(fmtDay(o.check_out_date))}`).join('<br>')}<div style="font-size:12px;margin-top:6px;">Their rooms stay blocked for new bookings until they're checked out or their dates are amended.</div></div>`) : ''}
    ${section(`${esc(fmtDay(n.date, { weekday: 'long' }))} — arriving`, table([{ label: 'Room' }, { label: 'Guest' }, { label: 'Pax' }, { label: 'Notes' }],
      n.arrival_rows.map(a => [esc(a.unit_name), esc(a.guest_name), a.num_guests, esc(a.special_requests || '')]),
      'No arrivals.') + `<div style="font-size:12px;color:#6b7280;margin-top:6px;">${n.departures.rooms} departing · ${n.in_house.rooms} staying over</div>`)}
    ${section(`${esc(fmtDay(n.date, { weekday: 'long' }))} — to collect from guests leaving`, table([{ label: 'Room' }, { label: 'Guest' }, { label: 'Balance', right: true }],
      n.to_collect.rows.map(r => [esc(r.unit_name), esc(r.guest_name), esc(fmtIDR(r.balance_due))]),
      'All settled — nothing to collect.'))}
    ${b.link ? `<div style="margin-top:24px;"><a href="${esc(b.link)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;">Open Reports</a></div>` : ''}
    <div style="margin-top:28px;font-size:11px;color:#9ca3af;">Sent by Smart Reports. Figures match the Reports page. Manage recipients in Settings → Reports &amp; Alerts.</div>
  </div>`;
  const pct = b.change.total;
  return {
    subject: `🌙 ${b.property_name} — Daily Close, ${fmtDay(b.date)}: ${fmtIDR(t.total)}${pct != null && pct !== 0 ? ` (${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}%)` : ''}`,
    html,
  };
}

// True when the property has the Daily Close going out (add-on on + at least
// one active recipient with it ticked) — then the night-audit owner email,
// whose content the Daily Close now carries, is skipped.
async function dailyCloseReplacesAuditEmail(propertyId) {
  const { rows: [r] } = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM notification_recipients nr
      JOIN property_modules pm ON pm.property_id = nr.property_id AND pm.module = 'smart_reports' AND pm.is_enabled
      WHERE nr.property_id = $1 AND nr.is_active AND nr.address IS NOT NULL AND 'daily_close' = ANY(nr.reports)
    ) AS yes`, [propertyId]);
  return r.yes;
}

module.exports = { collected, buildDailyClose, dailyCloseTelegram, dailyCloseEmail, dailyCloseReplacesAuditEmail };
