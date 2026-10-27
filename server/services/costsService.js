// Costs by department — the Insights → Costs page (owner, or the `costs`
// permission). "Which part of the hotel spends the most, and what changed."
//
// What it counts: the same costs as the Reports page and Net income
// (costCategories.COSTS_SQL) — Expenses on the day incurred and supplier bills
// (Payables) on the bill date, never voided ones — grouped by the department
// each one is tagged with (migration 131). Salaries, agent commission and the
// accountant's journal entries are NOT in it yet: those live on chart-of-
// accounts lines that carry no department until the standard chart is agreed
// with the accountant (ROADMAP: "Owner insights + menu regroup").
//
// A month is compared with the month before; while the month is still running
// it is compared with the same number of days of the month before (1–27 Oct
// vs 1–27 Sep), never a part month against a whole one — the Dashboard rule.
// Nothing is stored.
const db = require('../db');
const { COSTS_SQL, DEPARTMENTS, CATEGORY_LABEL } = require('./costCategories');
const { todayWITA } = require('./roomChargeService');

const pad = n => String(n).padStart(2, '0');
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const monthLen = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

// The period of a month and the one it is compared with.
// → { month, from, to, partial, days, prev: { month, from, to } } or { error }.
function costPeriod(month, today = todayWITA()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return { error: 'month must be YYYY-MM' };
  const current = today.slice(0, 7);
  if (month > current) return { error: 'That month has not started yet' };
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const last = `${month}-${pad(monthLen(y, m))}`;
  const partial = month === current && today < last;
  const to = partial ? today : last;
  const days = Number(to.slice(8, 10));
  const pm = shiftMonth(month, -1);
  const [py, pmm] = pm.split('-').map(Number);
  const prevDays = partial ? Math.min(days, monthLen(py, pmm)) : monthLen(py, pmm);
  return { month, from, to, partial, days, prev: { month: pm, from: `${pm}-01`, to: `${pm}-${pad(prevDays)}` } };
}

const pctChange = (now, before) => (before > 0 ? r2(((now - before) / before) * 100) : null);

async function buildCosts(propertyId, month, { today = todayWITA() } = {}) {
  const p = costPeriod(month, today);
  if (p.error) return p;
  const { getReport, ACTIVITY_SQL } = require('../routes/reports');   // lazy: route file
  const trendFrom = `${shiftMonth(month, -5)}-01`;

  const [{ rows: cur }, { rows: prev }, { rows: trend }, { rows: entries }, report, { rows: [vendor] }] = await Promise.all([
    db.query(`
      SELECT department, category, COUNT(*) AS entries, SUM(amount) AS amount
      FROM ${COSTS_SQL} c WHERE property_id = $1 AND day BETWEEN $2::date AND $3::date
      GROUP BY department, category`, [propertyId, p.from, p.to]),
    db.query(`
      SELECT department, category, SUM(amount) AS amount
      FROM ${COSTS_SQL} c WHERE property_id = $1 AND day BETWEEN $2::date AND $3::date
      GROUP BY department, category`, [propertyId, p.prev.from, p.prev.to]),
    // Six months ending with this one (this one up to `to`), by department.
    db.query(`
      SELECT to_char(day, 'YYYY-MM') AS month, department, SUM(amount) AS amount
      FROM ${COSTS_SQL} c WHERE property_id = $1 AND day BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`, [propertyId, trendFrom, p.to]),
    // Every entry of the period — the department panel lists them.
    db.query(`
      SELECT 'expense' AS kind, e.id, e.incurred_on AS day, e.category, e.department, e.amount,
             e.description AS text, e.reference, s.name AS supplier, NULL::int AS bill_no
      FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
      WHERE e.property_id = $1 AND NOT e.is_voided AND e.incurred_on BETWEEN $2::date AND $3::date
      UNION ALL
      SELECT 'bill', b.id, b.bill_date, b.category, b.department, b.total,
             b.notes, b.supplier_ref, s.name, b.bill_no
      FROM supplier_bills b LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.property_id = $1 AND NOT b.is_voided AND b.bill_date BETWEEN $2::date AND $3::date
      ORDER BY amount DESC LIMIT 2000`, [propertyId, p.from, p.to]),
    getReport(propertyId, p.from, p.to),
    // What this month's trips owe their tour / transport vendors (migration 140).
    db.query(`WITH x AS (${ACTIVITY_SQL}) SELECT COALESCE(SUM(vendor) FILTER (WHERE NOT comp), 0) AS amount FROM x`,
      [p.from, p.to, propertyId]),
  ]);

  // ── Departments, biggest first, each with what it spent on ──
  const depts = new Map(DEPARTMENTS.map(([key, label]) => [key, { department: key, label, amount: 0, before: 0, entries: 0, cats: new Map() }]));
  const deptOf = k => depts.get(k) || depts.get('admin');
  const catOf = (d, k) => {
    if (!d.cats.has(k)) d.cats.set(k, { category: k, label: CATEGORY_LABEL[k] || k, amount: 0, before: 0, entries: 0 });
    return d.cats.get(k);
  };
  for (const r of cur) {
    const d = deptOf(r.department), c = catOf(d, r.category), a = parseFloat(r.amount) || 0, n = parseInt(r.entries, 10) || 0;
    d.amount += a; d.entries += n; c.amount += a; c.entries += n;
  }
  for (const r of prev) {
    const d = deptOf(r.department), a = parseFloat(r.amount) || 0;
    d.before += a; catOf(d, r.category).before += a;
  }
  const total = r2([...depts.values()].reduce((s, d) => s + d.amount, 0));
  const before = r2([...depts.values()].reduce((s, d) => s + d.before, 0));

  const entryRows = entries.map(e => ({
    kind: e.kind, id: e.id,
    day: typeof e.day === 'string' ? e.day.slice(0, 10) : new Date(e.day).toISOString().slice(0, 10),
    category: e.category, category_label: CATEGORY_LABEL[e.category] || e.category,
    department: deptOf(e.department).department,
    amount: r2(e.amount), text: e.text || '', reference: e.reference || '', supplier: e.supplier || '',
    bill_no: e.bill_no ? `BILL-${String(e.bill_no).padStart(4, '0')}` : null,
  }));

  const departments = [...depts.values()]
    .filter(d => d.amount > 0.004 || d.before > 0.004)
    .map(d => ({
      department: d.department, label: d.label,
      amount: r2(d.amount), before: r2(d.before), entries: d.entries,
      change_amount: r2(d.amount - d.before), change: pctChange(d.amount, d.before),
      share: total > 0 ? r2((d.amount / total) * 100) : 0,
      categories: [...d.cats.values()].filter(c => c.amount > 0.004 || c.before > 0.004)
        .map(c => ({ ...c, amount: r2(c.amount), before: r2(c.before), change_amount: r2(c.amount - c.before) }))
        .sort((a, b) => b.amount - a.amount || b.before - a.before),
    }))
    .sort((a, b) => b.amount - a.amount || b.before - a.before);

  const biggest = departments[0] && departments[0].amount > 0 ? departments[0] : null;
  const jumps = departments.filter(d => d.change_amount > 0).sort((a, b) => b.change_amount - a.change_amount);
  const jump = jumps[0] || null;

  // ── What each earning department keeps after its own costs ──
  const costOf = (...keys) => r2(keys.reduce((s, k) => s + (depts.get(k)?.amount || 0), 0));
  const vendorShare = r2(vendor.amount);
  const earner = (key, label, revenue, costs, extra = {}) => {
    if (revenue <= 0.004 && costs <= 0.004) return null;
    const profit = r2(revenue - costs);
    return {
      key, label, revenue: r2(revenue), costs, profit,
      margin: revenue > 0 ? r2((profit / revenue) * 100) : null,
      per_100: revenue > 0 ? r2((costs / revenue) * 100) : null,   // spent for every Rp 100 it brings in
      ...extra,
    };
  };
  const roomsSold = report.total_nights || 0;
  const roomCosts = costOf('front_office', 'housekeeping');
  const fnbCosts = costOf('fnb');
  const actCosts = costOf('activities');
  const earners = [
    earner('rooms', 'Rooms (Front Office + Housekeeping)', report.room_revenue, roomCosts,
      { rooms_sold: roomsSold, per_room: roomsSold > 0 ? r2(roomCosts / roomsSold) : null }),
    earner('fnb', 'Food & Beverage', report.fnb_revenue, fnbCosts),
    // Tours / transport: what the trips owe their vendors counts against them too.
    earner('activities', 'Activities', report.activity_revenue, r2(actCosts + vendorShare),
      { vendor_share: vendorShare, own_costs: actCosts }),
  ].filter(Boolean);

  // Food & drinks bought against F&B revenue — bought, not used (stock left
  // over isn't taken off), so it is a rough figure for a single month.
  const foodBought = r2(['food', 'drinks'].reduce((s, k) => s + [...depts.values()].reduce((t, d) => t + (d.cats.get(k)?.amount || 0), 0), 0));

  // ── Six months ──
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(month, -i));
  const trendRows = months.map(ym => {
    const rows = trend.filter(t => t.month === ym);
    const by = {};
    for (const t of rows) {
      const k = deptOf(t.department).department;
      by[k] = r2((by[k] || 0) + (parseFloat(t.amount) || 0));
    }
    return { month: ym, label: MONTH_NAMES[Number(ym.slice(5)) - 1], total: r2(Object.values(by).reduce((s, v) => s + v, 0)), by_department: by,
             partial: ym === month && p.partial };
  });

  return {
    month, month_label: monthName(month), from: p.from, to: p.to, partial: p.partial, today,
    prev: { ...p.prev, label: monthName(p.prev.month) },
    total, before, change_amount: r2(total - before), change: pctChange(total, before),
    entries_count: entryRows.length,
    biggest: biggest && { department: biggest.department, label: biggest.label, amount: biggest.amount, share: biggest.share },
    jump: jump && { department: jump.department, label: jump.label, change_amount: jump.change_amount, change: jump.change },
    revenue: r2(report.total_revenue),
    cost_ratio: report.total_revenue > 0 ? r2((total / report.total_revenue) * 100) : null,
    rooms_sold: roomsSold,
    cost_per_room: roomsSold > 0 ? r2(total / roomsSold) : null,
    departments,
    earners,
    food_bought: foodBought,
    food_ratio: report.fnb_revenue > 0 && foodBought > 0 ? r2((foodBought / report.fnb_revenue) * 100) : null,
    trend: trendRows,
    entries: entryRows,
  };
}

module.exports = { buildCosts, costPeriod };
