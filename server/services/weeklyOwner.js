const db = require('../db');
const { CARD_TABLE_OPEN, CARD_TABLE_CLOSE, CARD_HEIGHT, card } = require('./emailCards');
const telegram = require('./telegramService');
const { todayWITA } = require('./roomChargeService');

// Weekly Owner Report (Reports & Alerts, paid — smart_reports): Monday 08:00
// WITA. Last week (Mon–Sun) against the week before, from the Reports page's
// getReport() so it matches /reports; what's already booked for the next
// 14 / 30 days with the weak nights to push; booking pace; where bookings
// came from; what agents owe (the Agent Billing page's aging); and — when
// Back Office expenses are used — net income.

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Monday of the week containing ymd.
function mondayOf(ymd) {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();   // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}
const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
function fmtDay(ymd, opts = { day: 'numeric', month: 'short' }) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}
const pctChange = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

async function weekFigures(propertyId, from, to, sellable) {
  const { getReport } = require('../routes/reports');
  const r = await getReport(propertyId, from, to);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const capacity = sellable * days;
  return {
    from, to,
    room: r.room_revenue, fnb: r.fnb_revenue, extras: r.ancillary_revenue, total: r.total_revenue,
    expenses: r.expenses_total, net_income: r.net_income,
    rooms_sold: r.total_nights,
    occupancy: capacity ? Math.round((r.total_nights / capacity) * 100) : 0,
    adr: r.total_nights ? r.room_revenue / r.total_nights : 0,
    revpar: capacity ? r.room_revenue / capacity : 0,
    by_source: r.by_source
      .map(s => ({ source: s.source, count: parseInt(s.count, 10), revenue: parseFloat(s.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

// Already booked (not cancelled / no-show) for each of the next `days` nights.
async function onTheBooks(propertyId, from, days, sellable) {
  const { rows } = await db.query(`
    SELECT gs::date AS night,
           COUNT(b.id) AS rooms,
           COALESCE(SUM((COALESCE(b.room_revenue, 0) + COALESCE(b.fnb_revenue, 0)) / NULLIF(b.nights, 0)), 0) AS revenue
    FROM generate_series($2::date, $2::date + ($3::int - 1), '1 day') gs
    LEFT JOIN bookings b ON b.property_id = $1
      AND b.status NOT IN ('cancelled', 'no_show')
      AND b.check_in_date <= gs::date AND b.check_out_date > gs::date
    GROUP BY gs ORDER BY gs`, [propertyId, from, days]);
  const nights = rows.map(r => ({
    night: r.night instanceof Date ? r.night.toISOString().slice(0, 10) : String(r.night).slice(0, 10),
    rooms: parseInt(r.rooms, 10),
    revenue: parseFloat(r.revenue),
  }));
  const summarize = list => {
    const sold = list.reduce((s, n) => s + n.rooms, 0);
    return {
      rooms: sold,
      occupancy: sellable ? Math.round((sold / (sellable * list.length)) * 100) : 0,
      revenue: list.reduce((s, n) => s + n.revenue, 0),
    };
  };
  const next14 = nights.slice(0, 14);
  return {
    next14: summarize(next14),
    next30: summarize(nights),
    // Nights in the next two weeks under 30% booked — worth a promotion.
    weak_nights: next14
      .map(n => ({ ...n, occupancy: sellable ? Math.round((n.rooms / sellable) * 100) : 0 }))
      .filter(n => n.occupancy < 30),
  };
}

async function pace(propertyId, from, to) {
  const { rows: [r] } = await db.query(`
    SELECT COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date) AS made,
           COALESCE(SUM(nights) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date), 0) AS made_nights,
           COALESCE(SUM(COALESCE(room_revenue + fnb_revenue, total_amount - COALESCE(discount_amount, 0))) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date), 0) AS made_value,
           COUNT(*) FILTER (WHERE status = 'cancelled' AND (updated_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date) AS cancelled,
           COALESCE(SUM(COALESCE(room_revenue + fnb_revenue, total_amount - COALESCE(discount_amount, 0))) FILTER (WHERE status = 'cancelled' AND (updated_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN $2::date AND $3::date), 0) AS cancelled_value
    FROM bookings WHERE property_id = $1`, [propertyId, from, to]);
  return {
    made: parseInt(r.made, 10), made_nights: parseInt(r.made_nights, 10), made_value: parseFloat(r.made_value),
    cancelled: parseInt(r.cancelled, 10), cancelled_value: parseFloat(r.cancelled_value),
  };
}

async function agentsOwed(propertyId) {
  const { aging } = require('./agentStatementService');
  const rows = await aging(propertyId, {});
  const open = rows.filter(r => r.total_outstanding > 0)
    .map(r => ({ agent: r.source_label, total: r.total_outstanding, overdue: r.total_outstanding - r.current, over_60: r.d61_90 + r.d90_plus }))
    .sort((a, b) => b.total - a.total);
  return {
    total: open.reduce((s, r) => s + r.total, 0),
    overdue: open.reduce((s, r) => s + r.overdue, 0),
    agents: open,
  };
}

// date: any day in the week AFTER the one to report (default today → last week).
async function buildWeeklyOwner(propertyId, { date } = {}) {
  const thisMonday = mondayOf(date || todayWITA());
  const from = addDays(thisMonday, -7);
  const to = addDays(thisMonday, -1);
  const [{ rows: [ps] }, { rows: [u] }] = await Promise.all([
    db.query('SELECT property_name FROM property_settings WHERE property_id = $1', [propertyId]),
    db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order') AS sellable FROM units WHERE property_id = $1`, [propertyId]),
  ]);
  const sellable = parseInt(u.sellable, 10) || 0;
  const [week, prev, books, paceNow, pacePrev, agents] = await Promise.all([
    weekFigures(propertyId, from, to, sellable),
    weekFigures(propertyId, addDays(from, -7), addDays(to, -7), sellable),
    onTheBooks(propertyId, date || todayWITA(), 30, sellable),
    pace(propertyId, from, to),
    pace(propertyId, addDays(from, -7), addDays(to, -7)),
    agentsOwed(propertyId),
  ]);
  return {
    from, to,
    property_name: ps?.property_name || 'Your property',
    sellable,
    week, prev,
    change: {
      total: pctChange(week.total, prev.total),
      occupancy_pts: week.occupancy - prev.occupancy,
      adr: pctChange(week.adr, prev.adr),
      revpar: pctChange(week.revpar, prev.revpar),
      made: pctChange(paceNow.made_value, pacePrev.made_value),
    },
    books,
    pace: paceNow, pace_prev: pacePrev,
    agents,
    has_expenses: week.expenses > 0 || prev.expenses > 0,
  };
}

const arrowTxt = (pct, suffix = '%') => pct == null ? '' : pct === 0 ? ' (same)' : ` (${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}${suffix})`;

function weeklyOwnerTelegram(b) {
  const e = telegram.escapeHtml;
  const w = b.week;
  const L = [];
  L.push(`📈 <b>${e(b.property_name)}</b> · week ${e(fmtDay(b.from))}–${e(fmtDay(b.to))}`);
  L.push('<i>Weekly Owner Report</i> · vs the week before');
  L.push('');
  L.push(`💰 Revenue: <b>${e(fmtIDR(w.total))}</b>${arrowTxt(b.change.total)}`);
  L.push(`🛏 Occupancy: <b>${w.occupancy}%</b>${arrowTxt(b.change.occupancy_pts, ' pts')} · ${w.rooms_sold} room-nights`);
  L.push(`💵 ADR ${e(fmtIDR(w.adr))}${arrowTxt(b.change.adr)} · RevPAR ${e(fmtIDR(w.revpar))}${arrowTxt(b.change.revpar)}`);
  if (b.has_expenses) L.push(`🧾 Expenses ${e(fmtIDR(w.expenses))} · Net income <b>${e(fmtIDR(w.net_income))}</b>`);
  L.push('');
  L.push(`🔮 <b>Already booked</b>`);
  L.push(`     Next 14 days: <b>${b.books.next14.occupancy}%</b> · ${e(fmtIDR(b.books.next14.revenue))}`);
  L.push(`     Next 30 days: <b>${b.books.next30.occupancy}%</b> · ${e(fmtIDR(b.books.next30.revenue))}`);
  if (b.books.weak_nights.length) {
    const list = b.books.weak_nights.slice(0, 7).map(n => `${fmtDay(n.night, { weekday: 'short', day: 'numeric' })} ${n.occupancy}%`).join(', ');
    L.push(b.books.weak_nights.length > 7
      ? `     ⚠️ ${b.books.weak_nights.length} of the next 14 nights under 30% booked`
      : `     ⚠️ Weak nights (under 30%): ${e(list)}`);
  }
  L.push('');
  L.push(`📅 New bookings: <b>${b.pace.made}</b> · ${b.pace.made_nights} nights · ${e(fmtIDR(b.pace.made_value))}${arrowTxt(b.change.made)}`);
  if (b.pace.cancelled) L.push(`❌ Cancelled: ${b.pace.cancelled} · ${e(fmtIDR(b.pace.cancelled_value))}`);
  const top = w.by_source.filter(s => s.revenue > 0).slice(0, 3);
  const stayRevenue = w.room + w.fnb;   // by_source covers stays only (not extras)
  if (top.length && stayRevenue > 0) L.push(`🔗 Top sources: ${e(top.map(s => `${s.source} ${Math.round((s.revenue / stayRevenue) * 100)}%`).join(' · '))}`);
  if (b.agents.total > 0) {
    L.push(`🧾 Agents owe: <b>${e(fmtIDR(b.agents.total))}</b>${b.agents.overdue > 0 ? ` · ${e(fmtIDR(b.agents.overdue))} overdue` : ''}`);
  }
  return L.join('\n');
}

function weeklyOwnerEmail(b) {
  const esc = telegram.escapeHtml;
  const w = b.week;
  const p = b.prev;
  const cmp = (pct, suffix = '%') => pct == null ? '' :
    `<div style="font-size:12px;line-height:17px;margin-top:2px;color:${pct > 0 ? '#15803d' : pct < 0 ? '#b91c1c' : '#6b7280'};">${pct === 0 ? 'same as the week before' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}${suffix} vs the week before`}</div>`;
  const tile = (label, value, sub) => card(label, value, sub, { height: CARD_HEIGHT.two });
  const section = (title, inner) => `
    <div style="margin-top:22px;">
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">${title}</div>${inner}
    </div>`;
  const table = (heads, rows, empty) => rows.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>${heads.map(h => `<th style="text-align:${h.right ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;">${h.label}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map((c, i) => `<td style="padding:8px;border-bottom:1px solid #f3f4f6;text-align:${heads[i].right ? 'right' : 'left'};">${c}</td>`).join('')}</tr>`).join('')}
    </table>` : `<div style="font-size:13px;color:#9ca3af;">${empty}</div>`;
  const sub = t => `<div style="font-size:12px;line-height:17px;color:#6b7280;margin-top:2px;">${t}</div>`;

  const revRows = [['Room', w.room, p.room], ['Meals (rate plan)', w.fnb, p.fnb], ['Extras', w.extras, p.extras]]
    .filter(([, a, c]) => a || c).map(([k, a, c]) => [k, esc(fmtIDR(a)), esc(fmtIDR(c))]);
  revRows.push(['<b>Total revenue</b>', `<b>${esc(fmtIDR(w.total))}</b>`, esc(fmtIDR(p.total))]);
  if (b.has_expenses) {
    revRows.push(['Expenses', esc(fmtIDR(w.expenses)), esc(fmtIDR(p.expenses))]);
    revRows.push(['<b>Net income</b>', `<b>${esc(fmtIDR(w.net_income))}</b>`, esc(fmtIDR(p.net_income))]);
  }
  const stayRevenue = w.room + w.fnb;

  const html = `
  <div class="hk-wrap" style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#111827;">
    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Weekly Owner Report</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px;">${esc(b.property_name)}</div>
    <div style="font-size:14px;color:#6b7280;margin-bottom:16px;">${esc(fmtDay(b.from, { weekday: 'short', day: 'numeric', month: 'short' }))} – ${esc(fmtDay(b.to, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))} · compared with the week before</div>

    ${CARD_TABLE_OPEN}
    <tr>
      ${tile('Revenue', esc(fmtIDR(w.total)), cmp(b.change.total))}
      ${tile('Occupancy', `${w.occupancy}%`, sub(`${w.rooms_sold} room-nights`) + cmp(b.change.occupancy_pts, ' pts'))}
    </tr>
    <tr>
      ${tile('ADR', esc(fmtIDR(w.adr)), cmp(b.change.adr))}
      ${tile('RevPAR', esc(fmtIDR(w.revpar)), cmp(b.change.revpar))}
    </tr>
    <tr>
      ${tile('Booked · next 14 days', `${b.books.next14.occupancy}%`, sub(esc(fmtIDR(b.books.next14.revenue))))}
      ${tile('Booked · next 30 days', `${b.books.next30.occupancy}%`, sub(esc(fmtIDR(b.books.next30.revenue))))}
    </tr>
    ${CARD_TABLE_CLOSE}

    ${section('Revenue', table([{ label: '' }, { label: 'Last week', right: true }, { label: 'Week before', right: true }], revRows, ''))}
    ${b.books.weak_nights.length ? section('⚠️ Weak nights ahead (under 30% booked)', `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7;color:#78350f;">${b.books.weak_nights.length > 7 ? `<b>${b.books.weak_nights.length} of the next 14 nights</b> are under 30% booked. The next ones:<br>` : ''}${b.books.weak_nights.slice(0, 7).map(n => `${esc(fmtDay(n.night, { weekday: 'short', day: 'numeric', month: 'short' }))} — ${n.occupancy}% (${n.rooms} of ${b.sellable})`).join('<br>')}<div style="font-size:12px;margin-top:6px;">Worth a promotion, a rate adjustment or a push on your channels.</div></div>`) : ''}
    ${section('Booking pace', table([{ label: '' }, { label: 'Last week', right: true }, { label: 'Week before', right: true }], [
      ['New bookings', `${b.pace.made} · ${b.pace.made_nights} nights`, `${b.pace_prev.made} · ${b.pace_prev.made_nights} nights`],
      ['Value booked', esc(fmtIDR(b.pace.made_value)), esc(fmtIDR(b.pace_prev.made_value))],
      ['Cancelled', `${b.pace.cancelled} · ${esc(fmtIDR(b.pace.cancelled_value))}`, `${b.pace_prev.cancelled} · ${esc(fmtIDR(b.pace_prev.cancelled_value))}`],
    ], ''))}
    ${section('Where last week\'s stays came from', table([{ label: 'Source' }, { label: 'Bookings', right: true }, { label: 'Revenue', right: true }, { label: 'Share', right: true }],
      w.by_source.filter(s => s.revenue > 0).map(s => [esc(s.source), s.count, esc(fmtIDR(s.revenue)), `${stayRevenue ? Math.round((s.revenue / stayRevenue) * 100) : 0}%`]), 'No stays last week.'))}
    ${b.agents.total > 0 ? section('What agents owe', table([{ label: 'Agent' }, { label: 'Owed', right: true }, { label: 'Overdue', right: true }],
      b.agents.agents.map(a => [esc(a.agent), esc(fmtIDR(a.total)), a.overdue > 0 ? `<span style="color:#b91c1c;">${esc(fmtIDR(a.overdue))}</span>` : '—']), '')) : ''}
    <div style="margin-top:28px;font-size:11px;color:#9ca3af;">All amounts are net — after discounts, before service charge and tax. Sent by Smart Reports.</div>
  </div>`;
  const pct = b.change.total;
  return {
    subject: `📈 ${b.property_name} — Weekly report ${fmtDay(b.from)}–${fmtDay(b.to)}: ${fmtIDR(w.total)}${pct != null && pct !== 0 ? ` (${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}%)` : ''}, ${w.occupancy}% occupancy`,
    html,
  };
}

module.exports = { buildWeeklyOwner, weeklyOwnerTelegram, weeklyOwnerEmail };
