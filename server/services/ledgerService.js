// Accounting step 2, phase B (migration 111): trial balance and balance sheet,
// added up from the journal (journalService.postingsFor — the PMS's own
// postings + the accountant's entries + the opening balances) from the first
// day of the books. Nothing stored.
//
// There is no year-end closing entry: revenue and expense accounts start each
// calendar year at zero, and what they made in earlier years shows as
// "Profit of earlier years" under equity — so the books always balance.
const db = require('../db');
const { postingsFor } = require('./journalService');
const { settings } = require('./glEntryService');
const { round2 } = require('./folioService');

const PL_TYPES = ['revenue', 'expense'];
const TYPE_ORDER = { asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5 };
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const yearStart = day => `${day.slice(0, 4)}-01-01`;
const fail = (error, status = 400) => ({ error, status });
const short = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Postings from the first day of the books to `to`, each with its account
// (today's name / kind for accounts still in the chart).
async function ledgerPosts(propertyId, to) {
  const st = await settings(propertyId);
  if (!st.books_start) return fail('Set the first day of the books first (Accounting → Journal entries)');
  if (to < st.books_start) return fail(`The books start on ${st.books_start}`);
  const [{ posts }, { rows: accounts }] = await Promise.all([
    postingsFor(propertyId, st.books_start, to),
    db.query('SELECT id, code, name, type FROM gl_accounts WHERE property_id = $1', [propertyId]),
  ]);
  const byId = new Map(accounts.map(a => [a.id, a]));
  const unmapped = new Set();
  for (const p of posts) {
    if (p.account) p.acc = byId.get(p.account.id) || p.account;
    else { unmapped.add(p.label || p.key); p.acc = { id: `unmapped:${p.key}`, code: '—', name: `No account chosen: ${p.label || p.key}`, type: '' }; }
  }
  return { st, posts, unmapped: [...unmapped] };
}

const sortRows = rows => rows.sort((a, b) => (TYPE_ORDER[a.type] || 9) - (TYPE_ORDER[b.type] || 9) || a.code.localeCompare(b.code));
const dc = v => ({ debit: v > 0 ? round2(v) : 0, credit: v < 0 ? round2(-v) : 0 });

// Trial balance for a period: per account the balance before it, the debits
// and credits in it, and the balance at its end.
async function trialBalance(propertyId, from, to) {
  const L = await ledgerPosts(propertyId, to);
  if (L.error) return L;
  const start = from < L.st.books_start ? L.st.books_start : from;
  const ys = yearStart(start);
  const rows = new Map();
  let earlier = 0;   // revenue / expense of earlier years → profit of earlier years
  for (const p of L.posts) {
    const pl = PL_TYPES.includes(p.acc.type);
    if (p.date < start && pl && p.date < ys) { earlier += p.amount; continue; }
    const r = rows.get(p.acc.id) || { code: p.acc.code, name: p.acc.name, type: p.acc.type, opening: 0, debit: 0, credit: 0 };
    if (p.date < start) r.opening += p.amount;
    else if (p.amount > 0) r.debit += p.amount;
    else r.credit -= p.amount;
    rows.set(p.acc.id, r);
  }
  const list = sortRows([...rows.values()]).map(r => {
    const closing = r.opening + r.debit - r.credit;
    return { code: r.code, name: r.name, type: r.type, opening: dc(r.opening), debit: round2(r.debit), credit: round2(r.credit), closing: dc(closing) };
  }).filter(r => r.opening.debit || r.opening.credit || r.debit || r.credit || r.closing.debit || r.closing.credit);
  if (Math.abs(earlier) >= 0.005) {
    list.push({ code: '', name: `Profit of earlier years (before ${ys.slice(0, 4)})`, type: 'equity', virtual: true, opening: dc(earlier), debit: 0, credit: 0, closing: dc(earlier) });
  }
  const tot = k => round2(list.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] : 0), 0));
  const tot2 = (k, side) => round2(list.reduce((s, r) => s + r[k][side], 0));
  const totals = {
    opening: { debit: tot2('opening', 'debit'), credit: tot2('opening', 'credit') },
    debit: tot('debit'), credit: tot('credit'),
    closing: { debit: tot2('closing', 'debit'), credit: tot2('closing', 'credit') },
  };
  return {
    from: start, to, books_start: L.st.books_start, closed_through: L.st.closed_through,
    rows: list, totals,
    balanced: Math.abs(totals.closing.debit - totals.closing.credit) < 0.01 && Math.abs(totals.debit - totals.credit) < 0.01,
    unmapped: L.unmapped,
  };
}

// Balance sheet at the end of `date`.
async function balanceSheet(propertyId, date) {
  const L = await ledgerPosts(propertyId, date);
  if (L.error) return L;
  const ys = yearStart(date);
  const bal = new Map();
  let earlier = 0, thisYear = 0;
  for (const p of L.posts) {
    if (PL_TYPES.includes(p.acc.type)) { if (p.date < ys) earlier -= p.amount; else thisYear -= p.amount; continue; }
    const r = bal.get(p.acc.id) || { code: p.acc.code, name: p.acc.name, type: p.acc.type, balance: 0 };
    r.balance += p.amount;
    bal.set(p.acc.id, r);
  }
  const rows = sortRows([...bal.values()]).filter(r => Math.abs(r.balance) >= 0.005);
  const section = (type, sign) => rows.filter(r => r.type === type).map(r => ({ code: r.code, name: r.name, amount: round2(sign * r.balance) }));
  const assets = section('asset', 1);
  const liabilities = section('liability', -1);
  const equity = section('equity', -1);
  if (Math.abs(earlier) >= 0.005) equity.push({ code: '', name: `Profit of earlier years (before ${ys.slice(0, 4)})`, amount: round2(earlier), virtual: true });
  equity.push({ code: '', name: `Profit this year (${short(ys < L.st.books_start ? L.st.books_start : ys)} – ${short(date)})`, amount: round2(thisYear), virtual: true });
  const unknown = rows.filter(r => !r.type).map(r => ({ code: r.code, name: r.name, amount: round2(r.balance) }));
  const sum = list => round2(list.reduce((s, r) => s + r.amount, 0));
  const totals = { assets: sum(assets), liabilities: sum(liabilities), equity: sum(equity) };
  totals.liabilities_equity = round2(totals.liabilities + totals.equity);
  totals.difference = round2(totals.assets - totals.liabilities_equity);
  return {
    date, books_start: L.st.books_start, closed_through: L.st.closed_through,
    assets, liabilities, equity, unknown, totals,
    balanced: Math.abs(totals.difference) < 0.01,
    unmapped: L.unmapped,
  };
}

module.exports = { trialBalance, balanceSheet, addDays };
