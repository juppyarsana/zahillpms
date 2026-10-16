// Profit & Loss (migration 110): the journal (journalService.js) added up per
// account and laid out by plLayout.js — nothing is stored. Three columns: the
// chosen month (up to today when it is the current month), the month before,
// and the year to date. Amounts are net (no service charge, no tax): revenue
// = credits − debits, expenses = debits − credits on the accounts.
const db = require('../db');
const { postingsFor } = require('./journalService');
const { round2 } = require('./folioService');
const { REVENUE_LINES, DEPARTMENTS, UNDISTRIBUTED, LINE_LABEL, NONE, lineOf, lineOfKey } = require('./plLayout');

const COLS = ['period', 'previous', 'ytd'];
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const pad = n => String(n).padStart(2, '0');
const monthEnd = (y, m) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
const zero = () => ({ period: 0, previous: 0, ytd: 0 });
const add = (a, b, sign = 1) => Object.fromEntries(COLS.map(c => [c, round2(a[c] + sign * b[c])]));
const sum = list => list.reduce((s, x) => add(s, x), zero());
const label = (from, to) => {
  const f = (d, o) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', o);
  const whole = from.slice(8) === '01' && to === monthEnd(+from.slice(0, 4), +from.slice(5, 7));
  if (whole) return f(from, { month: 'long', year: 'numeric' });
  if (from.slice(0, 7) === to.slice(0, 7)) return `${+from.slice(8)}–${f(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${f(from, { day: 'numeric', month: 'short' })} – ${f(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

// month = 'YYYY-MM'; today = the property's today (WITA).
function periods(month, today) {
  const m = MONTH_RE.exec(month || '');
  if (!m || +m[2] < 1 || +m[2] > 12) return { error: 'Choose a month (YYYY-MM)' };
  const y = +m[1], mo = +m[2];
  const from = `${y}-${pad(mo)}-01`;
  if (from > today) return { error: 'That month has not started yet' };
  const end = monthEnd(y, mo);
  const to = end < today ? end : today;
  const py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1;
  return {
    period: { from, to, label: label(from, to), partial: to !== end },
    previous: { from: `${py}-${pad(pm)}-01`, to: monthEnd(py, pm), label: label(`${py}-${pad(pm)}-01`, monthEnd(py, pm)) },
    ytd: { from: `${y}-01-01`, to, label: `1 Jan – ${new Date(`${to}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` },
  };
}

async function buildPl(propertyId, month, today) {
  const p = periods(month, today);
  if (p.error) return p;
  const from = p.previous.from < p.ytd.from ? p.previous.from : p.ytd.from;
  const [{ posts }, { rows: accounts }, { rows: [closing] }] = await Promise.all([
    postingsFor(propertyId, from, p.period.to),
    db.query('SELECT id, code, name, type, pl_line FROM gl_accounts WHERE property_id = $1', [propertyId]),
    db.query(`SELECT to_char(MAX(business_date), 'YYYY-MM-DD') AS through FROM gl_closed_days WHERE property_id = $1`, [propertyId]),
  ]);
  const byId = new Map(accounts.map(a => [a.id, a]));
  const inCol = (date, c) => date >= p[c].from && date <= p[c].to;

  // Each posting onto its account (or, with no account chosen, its key).
  const rows = new Map();   // id → { code, name, line, type, amounts }
  const unmapped = new Set();
  for (const post of posts) {
    let id, row;
    if (post.account) {
      const acc = byId.get(post.account.id) || post.account;   // a closed day keeps its account; today's line applies
      const line = lineOf(acc);
      if (!line) continue;                                      // balance-sheet account
      id = acc.id;
      row = rows.get(id) || { code: acc.code, name: acc.name, type: acc.type, line, amounts: zero() };
    } else {
      const guess = lineOfKey(post.key);
      if (!guess) continue;
      id = `unmapped:${post.key}`;
      unmapped.add(post.label || post.key);
      row = rows.get(id) || { code: '—', name: `No account chosen: ${post.label || post.key}`, type: guess.type, line: guess.line, amounts: zero(), unmapped: true };
    }
    // Revenue is a credit (negative amount), an expense a debit (positive).
    const v = row.type === 'revenue' ? -post.amount : post.amount;
    for (const c of COLS) if (inCol(post.date, c)) row.amounts[c] += v;
    rows.set(id, row);
  }
  for (const r of rows.values()) r.amounts = add(zero(), r.amounts);

  const accountsOn = line => [...rows.values()]
    .filter(r => r.line === line && COLS.some(c => Math.abs(r.amounts[c]) >= 0.005))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(r => ({ code: r.code, name: r.name, amounts: r.amounts, unmapped: !!r.unmapped }));
  const lineTotal = line => sum(accountsOn(line).map(a => a.amounts));

  // ── The statement, top to bottom ──
  const revenue = Object.fromEntries(REVENUE_LINES.map(([k]) => [k, lineTotal(k)]));
  const totalRevenue = sum(Object.values(revenue));
  const out = [];   // rows: { kind: heading | line | total | grand, key, label, amounts, base, accounts? }
  const push = (kind, key, lbl, amounts, base = 'total', extra = {}) => out.push({ kind, key, label: lbl, amounts, base, ...extra });
  const shown = (key, amounts, always) => always || COLS.some(c => Math.abs(amounts[c]) >= 0.005) || accountsOn(key).length;

  push('heading', 'h.revenue', 'Revenue');
  for (const [k, lbl] of REVENUE_LINES) {
    if (shown(k, revenue[k], k !== 'rev.misc')) push('line', k, lbl, revenue[k], 'total', { accounts: accountsOn(k) });
  }
  push('total', 't.revenue', 'Total revenue', totalRevenue);

  push('heading', 'h.dept', 'Departmental expenses');
  const deptExp = {};
  for (const [d, lbl, , exp] of DEPARTMENTS) {
    deptExp[d] = lineTotal(exp);
    push('line', exp, lbl, deptExp[d], `dept.${d}`, { accounts: accountsOn(exp) });
  }
  push('total', 't.dept', 'Total departmental expenses', sum(Object.values(deptExp)));

  push('heading', 'h.profit', 'Departmental profit');
  const profits = DEPARTMENTS.map(([d, lbl, rev]) => {
    const v = add(revenue[rev], deptExp[d], -1);
    push('line', `profit.${d}`, lbl, v, `dept.${d}`);
    return v;
  });
  if (shown('rev.misc', revenue['rev.misc'])) push('line', 'profit.misc', 'Miscellaneous income', revenue['rev.misc']);
  const deptProfit = add(sum(profits), revenue['rev.misc']);
  push('total', 't.profit', 'Total departmental profit', deptProfit);

  push('heading', 'h.und', 'Undistributed operating expenses');
  const und = UNDISTRIBUTED.map(([k, lbl]) => {
    const v = lineTotal(k);
    push('line', k, lbl, v, 'total', { accounts: accountsOn(k) });
    return v;
  });
  push('total', 't.und', 'Total undistributed expenses', sum(und));
  const gop = add(deptProfit, sum(und), -1);
  push('grand', 'gop', 'Gross operating profit (GOP)', gop);

  push('heading', 'h.fixed', 'Fixed charges');
  const fixed = lineTotal('fixed');
  push('line', 'fixed', 'Rent, insurance, PBB, depreciation', fixed, 'total', { accounts: accountsOn('fixed') });
  push('grand', 'net', 'Net profit (before income tax)', add(gop, fixed, -1));

  // % of the line's base: total revenue, or the department's own revenue for
  // its expenses and profit (the USALI convention).
  const baseOf = b => (b === 'total' ? totalRevenue : revenue[DEPARTMENTS.find(([d]) => `dept.${d}` === b)[2]]);
  for (const r of out) {
    if (r.kind === 'heading') continue;
    const base = baseOf(r.base);
    r.pct = Object.fromEntries(COLS.map(c => [c,
      Math.abs(base[c]) >= 0.005 && Math.abs(r.amounts[c]) >= 0.5 ? round2((r.amounts[c] / base[c]) * 100) : null]));
  }

  return {
    month, columns: { period: p.period, previous: p.previous, ytd: p.ytd },
    rows: out,
    off_pl: accountsOn(NONE),
    unmapped: [...unmapped],
    closed_through: closing?.through || null,
  };
}

module.exports = { buildPl, periods, LINE_LABEL };
