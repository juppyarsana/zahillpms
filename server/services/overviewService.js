// Overview — the owner's / manager's home (owner, or the `overview`
// permission). Everything at a glance, exceptions first. Built only from
// what the other pages already work out, so every figure here equals the
// page it links to:
//   needs_you  — approvals waiting, overdue agents / supplier bills, OTA items,
//                guests past check-out, never-arrived stays, a cost jump
//   tonight    — Dashboard's Today (dashboard.todayAtAGlance)
//   revenue    — this month so far vs the same days of last month (getReport,
//                the Dashboard month card's rule)
//   money_in   — yesterday's money received by method (dailyClose.collected)
//   owed       — room money not paid yet + agents / OTAs (aging)
//   costs      — biggest departments this month (costsService)
//   next_nights — the next 14 nights on the books (forecast)
// A part whose module is off is null. Nothing is stored.
const db = require('../db');
const { todayWITA } = require('./roomChargeService');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const monthLen = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const idr = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtDay = ymd => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// A department counts as "jumped" when it is up this much on the same days of last month.
const JUMP_MIN_PCT = 30;
const JUMP_MIN_AMOUNT = 5000000;

async function buildOverview(propertyId, { today = todayWITA() } = {}) {
  const { rows: mods } = await db.query('SELECT module FROM property_modules WHERE property_id = $1 AND is_enabled', [propertyId]);
  const on = new Set(mods.map(m => m.module));
  const { todayAtAGlance, unpaidRoomMoney } = require('../routes/dashboard');   // lazy: route files
  const { getReport } = require('../routes/reports');
  const { collected } = require('./dailyClose');
  const { aging } = require('./agentStatementService');
  const { buildCosts } = require('./costsService');
  const { buildForecast } = require('./forecast');

  const [y, m, d] = today.split('-').map(Number);
  const first = `${y}-${pad(m)}-01`;
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const prevFirst = `${py}-${pad(pm)}-01`;
  const prevTo = `${py}-${pad(pm)}-${pad(Math.min(d, monthLen(py, pm)))}`;
  const yesterday = addDays(today, -1);
  const res = on.has('reservations');
  const fin = on.has('financial');
  const hasCosts = on.has('back_office') || on.has('accounting');

  const none = Promise.resolve(null);
  const q = (sql, params) => db.query(sql, params).then(r => r.rows);
  const [
    { rows: [u] }, glance, soFar, prev, money, unpaid, agents, costs, forecast,
    compReqs, pos, otaItems, overdueStays, bills,
  ] = await Promise.all([
    db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order') AS sellable FROM units WHERE property_id = $1`, [propertyId]),
    res ? db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order') AS n FROM units WHERE property_id = $1`, [propertyId])
      .then(r => todayAtAGlance(propertyId, parseInt(r.rows[0].n, 10) || 0)) : none,
    fin ? getReport(propertyId, first, today) : none,
    fin ? getReport(propertyId, prevFirst, prevTo) : none,
    fin ? collected(propertyId, yesterday) : none,
    fin ? unpaidRoomMoney(propertyId) : none,
    fin ? aging(propertyId) : none,
    hasCosts ? buildCosts(propertyId, today.slice(0, 7), { today }) : none,
    res ? buildForecast(propertyId, { from: today, days: 14 }) : none,
    res ? q(`
      SELECT cr.booking_id, cr.scope, cr.created_at, u.name AS unit_name, g.name AS guest_name, rq.name AS requested_by
      FROM complimentary_requests cr
      JOIN bookings b ON b.id = cr.booking_id
      LEFT JOIN units u ON u.id = b.unit_id LEFT JOIN guests g ON g.id = b.guest_id
      LEFT JOIN users rq ON rq.id = cr.requested_by
      WHERE cr.property_id = $1 AND cr.status = 'pending' AND cr.expires_at > NOW()
      ORDER BY cr.created_at`, [propertyId]) : none,
    on.has('back_office') ? q(`
      SELECT po.id, po.po_number, po.total_amount, s.name AS supplier
      FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.property_id = $1 AND po.status = 'pending_approval'
      ORDER BY po.created_at`, [propertyId]) : none,
    on.has('channel_manager') ? q(`
      SELECT COUNT(*) AS n FROM channel_revisions
      WHERE property_id = $1 AND result IN ('attention', 'error') AND handled_at IS NULL`, [propertyId]) : none,
    res ? q(`
      SELECT b.id, b.check_out_date, g.name AS guest_name, u.name AS unit_name
      FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN units u ON u.id = b.unit_id
      WHERE b.property_id = $1 AND b.status = 'checked_in' AND b.check_out_date < $2::date
      ORDER BY b.check_out_date, u.name`, [propertyId, today]) : none,
    on.has('accounting') ? require('./payablesService').summary(propertyId) : none,
  ]);

  // ── Needs you ── (most urgent first; each links to where it is sorted)
  const needs = [];
  for (const c of compReqs || []) {
    needs.push({ kind: 'complimentary', title: 'Complimentary stay to approve',
      text: `Room ${c.unit_name || '—'} · ${c.guest_name || ''}${c.requested_by ? ` · asked by ${c.requested_by}` : ''}`,
      to: `/reservations/${c.booking_id}` });
  }
  for (const p of pos || []) {
    needs.push({ kind: 'po', title: `Purchase order ${p.po_number} to approve`,
      text: `${p.supplier || 'Supplier'} · ${idr(p.total_amount)}`, to: '/purchasing' });
  }
  if (otaItems && parseInt(otaItems[0].n, 10) > 0) {
    const n = parseInt(otaItems[0].n, 10);
    needs.push({ kind: 'ota', title: `${n} OTA booking${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} someone`,
      text: 'The channel manager could not book it by itself', to: '/ota-bookings' });
  }
  for (const s of overdueStays || []) {
    needs.push({ kind: 'overdue_stay', title: `Room ${s.unit_name} past check-out`,
      text: `${s.guest_name} · was due out ${fmtDay(typeof s.check_out_date === 'string' ? s.check_out_date.slice(0, 10) : new Date(s.check_out_date).toISOString().slice(0, 10))} — still checked in`,
      to: `/reservations/${s.id}` });
  }
  if (glance?.never_arrived?.length) {
    const n = glance.never_arrived.length;
    needs.push({ kind: 'never_arrived', title: `${n} stay${n === 1 ? '' : 's'} never checked in`,
      text: 'Already over — mark no-show or cancel', to: '/guest-lists' });
  }
  const agentRows = (agents || []).filter(a => a.total_outstanding > 0.5);
  const overdueAgents = agentRows
    .map(a => ({ ...a, overdue: r2(a.d1_30 + a.d31_60 + a.d61_90 + a.d90_plus) }))
    .filter(a => a.overdue >= 1).sort((a, b) => b.overdue - a.overdue);
  for (const a of overdueAgents.slice(0, 3)) {
    needs.push({ kind: 'agent_overdue', title: `${a.agent_name} owes ${idr(a.overdue)} overdue`,
      text: `${idr(a.total_outstanding)} open in all`, to: `/agents/${a.agent_id}` });
  }
  if (overdueAgents.length > 3) {
    needs.push({ kind: 'agent_overdue', title: `${overdueAgents.length - 3} more agents overdue`, text: 'See Receivables', to: '/agents' });
  }
  if (bills && bills.overdue >= 1) {
    needs.push({ kind: 'bills_overdue', title: `Supplier bills overdue · ${idr(bills.overdue)}`,
      text: bills.due_this_week >= 1 ? `${idr(bills.due_this_week)} more due this week` : 'Past their due date', to: '/payables' });
  }
  for (const dpt of (costs?.departments || [])) {
    if (dpt.change_amount >= JUMP_MIN_AMOUNT && dpt.before > 0 && dpt.change >= JUMP_MIN_PCT) {
      needs.push({ kind: 'cost_jump', title: `${dpt.label} costs up ${Math.round(dpt.change)}%`,
        text: `${idr(dpt.change_amount)} more than the same days of last month`, to: `/costs?month=${costs.month}&department=${dpt.department}` });
    }
  }

  // ── Revenue this month so far ──
  const revenue = soFar && {
    from: first, to: today, prev_from: prevFirst, prev_to: prevTo,
    total: r2(soFar.total_revenue), before: r2(prev.total_revenue),
    change: prev.total_revenue > 0 ? r2(((soFar.total_revenue - prev.total_revenue) / prev.total_revenue) * 100) : null,
    rooms: r2(soFar.room_revenue), fnb: r2(soFar.fnb_revenue),
    other: r2(soFar.ancillary_revenue + soFar.activity_revenue + (soFar.event_revenue || 0)),
  };

  // ── Still owed to the hotel ──
  const agentsOwed = r2(agentRows.reduce((s, a) => s + a.total_outstanding, 0));
  const owed = unpaid && {
    guests: r2(unpaid.amount), guest_bookings: unpaid.bookings,
    agents: agentsOwed, agents_count: agentRows.length,
    total: r2(unpaid.amount + agentsOwed),
  };

  return {
    today, sellable: parseInt(u.sellable, 10) || 0,
    needs_you: needs,
    tonight: glance && {
      ...glance.tonight,
      arriving_today: glance.arriving.rooms, departing_today: glance.departing.rooms,
      made_today: glance.made,
    },
    revenue,
    money_in: money && { date: yesterday, total: r2(money.total), by_method: money.by_method.map(x => ({ method: x.method, amount: r2(x.amount) })) },
    owed,
    costs: costs && !costs.error && {
      month: costs.month, month_label: costs.month_label, partial: costs.partial,
      total: costs.total, change: costs.change, prev_label: costs.prev.label,
      departments: costs.departments.filter(x => x.amount > 0).slice(0, 5)
        .map(x => ({ department: x.department, label: x.label, amount: x.amount, share: x.share, change: x.change })),
    },
    next_nights: forecast && {
      occupancy: forecast.totals.occupancy,
      nights: forecast.rows.map(r => ({ date: r.date, sold: r.sold, sellable: r.sellable, occupancy: r.occupancy, holiday: r.holiday })),
    },
  };
}

module.exports = { buildOverview };
