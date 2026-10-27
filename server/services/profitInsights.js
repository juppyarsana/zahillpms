// Profit — the Insights → Profit page (owner, or the `profit` permission;
// accounting module). The Accounting P&L (plService.buildPl, so the figures
// are the books' own) told in four steps: revenue → department profit → gross
// operating profit → net profit, with what each department keeps and what is
// still missing from the books this month.
//
// Compared with the month before; while the month runs, with the same days of
// it (buildPl's own period column, called with that day as "today").
// Nothing stored.
const db = require('../db');
const { costPeriod } = require('./costsService');
const { todayWITA } = require('./roomChargeService');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };
const pctOf = (a, b) => (Math.abs(b) >= 0.5 ? r2((a / b) * 100) : null);

// The P&L rows → the figures this page shows (the `period` column).
function figures(pl) {
  const v = key => r2(pl.rows.find(r => r.key === key)?.amounts.period || 0);
  const accounts = key => (pl.rows.find(r => r.key === key)?.accounts || [])
    .map(a => ({ code: a.code, name: a.name, amount: r2(a.amounts.period), unmapped: a.unmapped }))
    .filter(a => Math.abs(a.amount) >= 0.5);
  const line = (key, label) => ({ key, label, amount: v(key), accounts: accounts(key) });
  const revenue = v('t.revenue');
  const depts = [
    { key: 'rooms', label: 'Rooms', revenue: v('rev.rooms'), costs: v('dept.rooms'), profit: v('profit.rooms'), accounts: accounts('dept.rooms') },
    { key: 'fnb', label: 'Food & beverage', revenue: v('rev.fnb'), costs: v('dept.fnb'), profit: v('profit.fnb'), accounts: accounts('dept.fnb') },
    { key: 'other', label: 'Other departments', revenue: v('rev.other'), costs: v('dept.other'), profit: v('profit.other'), accounts: accounts('dept.other') },
  ].map(d => ({ ...d, margin: pctOf(d.profit, d.revenue) }));
  const misc = v('rev.misc');
  return {
    revenue,
    revenue_lines: [line('rev.rooms', 'Rooms'), line('rev.fnb', 'Food & beverage'), line('rev.other', 'Other departments'), line('rev.misc', 'Miscellaneous income')]
      .filter(l => Math.abs(l.amount) >= 0.5),
    dept_costs: v('t.dept'),
    departments: depts,
    misc_income: misc,
    dept_profit: v('t.profit'),
    running: [
      line('und.admin', 'Administration & general'),
      line('und.sales', 'Sales & marketing'),
      line('und.maint', 'Maintenance'),
      line('und.utilities', 'Utilities'),
    ],
    running_total: v('t.und'),
    gop: v('gop'),
    fixed: line('fixed', 'Rent, insurance, property tax, depreciation'),
    net: v('net'),
  };
}

async function buildProfit(propertyId, month, { today = todayWITA() } = {}) {
  const p = costPeriod(month, today);
  if (p.error) return p;
  const { buildPl } = require('./plService');
  const { getReport } = require('../routes/reports');   // lazy: route file
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;

  const [cur, prev, { rows: [u] }, { rows: [je] }, { rows: [ops] }, report] = await Promise.all([
    buildPl(propertyId, month, today),
    buildPl(propertyId, p.prev.month, p.prev.to),
    db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'out_of_order') AS sellable FROM units WHERE property_id = $1`, [propertyId]),
    // The accountant's own entries on cost accounts this month (payroll, rent, depreciation…).
    db.query(`
      SELECT COUNT(DISTINCT e.id) AS entries, COALESCE(SUM(l.debit - l.credit), 0) AS amount
      FROM gl_entries e JOIN gl_entry_lines l ON l.entry_id = e.id JOIN gl_accounts a ON a.id = l.account_id
      WHERE e.property_id = $1 AND NOT e.is_voided AND e.kind = 'manual' AND a.type = 'expense'
        AND e.entry_date BETWEEN $2::date AND $3::date`, [propertyId, p.from, p.to]),
    // Costs from the daily work: Expenses + supplier bills.
    db.query(`
      SELECT (SELECT COUNT(*) FROM expenses WHERE property_id = $1 AND NOT is_voided AND incurred_on BETWEEN $2::date AND $3::date)
           + (SELECT COUNT(*) FROM supplier_bills WHERE property_id = $1 AND NOT is_voided AND bill_date BETWEEN $2::date AND $3::date) AS n`,
      [propertyId, p.from, p.to]),
    // The Revenue / Reports pages count nights sold; the books count what is
    // posted to the bills — the difference is explained on the page.
    getReport(propertyId, p.from, p.to),
  ]);
  if (cur.error) return cur;

  const now = figures(cur);
  const before = prev.error ? null : figures(prev);
  const availNights = (parseInt(u.sellable, 10) || 0) * days;

  // The cost lines that moved most on the month before (up first) — the
  // "why" under the four numbers.
  const costLines = f => [...f.departments.map(d => [`dept.${d.key}`, `${d.label} costs`, d.costs]),
    ...f.running.map(l => [l.key, l.label, l.amount]), ['fixed', 'Fixed charges', f.fixed.amount]];
  const movers = before ? costLines(now).map(([key, label, amount]) => {
    const was = costLines(before).find(x => x[0] === key)[2];
    return { key, label, amount, before: was, change: r2(amount - was) };
  }).filter(m => Math.abs(m.change) >= 0.5).sort((a, b) => b.change - a.change) : [];

  // What the books are still missing — so a high profit isn't read as real.
  const missing = [];
  if (!cur.books_start) missing.push({ key: 'books_start', text: 'The first day of the books is not set — until it is, only what the PMS posts by itself is here.' });
  else if (cur.books_start > p.to) missing.push({ key: 'before_books', text: `This month is before the books start (${cur.books_start}) — only what the PMS posts by itself is here.` });
  if (parseInt(je.entries, 10) === 0) missing.push({ key: 'journal', text: 'No journal entries from the accountant this month — salaries, rent and depreciation are not on it yet.' });
  if (parseInt(ops.n, 10) === 0) missing.push({ key: 'costs', text: 'No expenses or supplier bills entered this month.' });
  if (cur.unmapped.length) missing.push({ key: 'unmapped', text: `Some amounts have no account chosen yet (${cur.unmapped.slice(0, 3).join(', ')}${cur.unmapped.length > 3 ? '…' : ''}) — choose them in Accounting → Accounts.` });

  return {
    month, month_label: monthName(month), from: p.from, to: p.to, partial: p.partial, today,
    prev: { ...p.prev, label: monthName(p.prev.month) },
    now, before,
    margins: {
      dept_profit: pctOf(now.dept_profit, now.revenue),
      gop: pctOf(now.gop, now.revenue),
      net: pctOf(now.net, now.revenue),
      gop_before: before ? pctOf(before.gop, before.revenue) : null,
    },
    available_nights: availNights,
    goppar: availNights ? r2(now.gop / availNights) : null,
    movers: movers.slice(0, 3),
    journal: { entries: parseInt(je.entries, 10), amount: r2(je.amount) },
    reports_revenue: r2(report.total_revenue),
    missing,
    books_start: cur.books_start,
    closed_through: cur.closed_through,
  };
}

module.exports = { buildProfit };
