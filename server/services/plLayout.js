// The Profit & Loss layout (migration 110): which line of the P&L a revenue
// or expense account shows on. A USALI-style statement cut down to a small
// hotel: departments (Rooms, F&B, Other operated) with their own revenue and
// costs → departmental profit → undistributed expenses → gross operating
// profit (GOP) → fixed charges → net profit. Each account carries its line
// (gl_accounts.pl_line), so the accountant moves an account without code.

const REVENUE_LINES = [
  ['rev.rooms', 'Rooms'],
  ['rev.fnb', 'Food & beverage'],
  ['rev.other', 'Other operated departments'],
  ['rev.misc', 'Miscellaneous income'],
];
const DEPARTMENTS = [
  // [department key, label, its revenue line, its expense line]
  ['rooms', 'Rooms', 'rev.rooms', 'dept.rooms'],
  ['fnb', 'Food & beverage', 'rev.fnb', 'dept.fnb'],
  ['other', 'Other operated departments', 'rev.other', 'dept.other'],
];
const EXPENSE_LINES = [
  ['dept.rooms', 'Rooms — departmental expenses'],
  ['dept.fnb', 'Food & beverage — departmental expenses'],
  ['dept.other', 'Other operated — departmental expenses'],
  ['und.admin', 'Administrative & general'],
  ['und.sales', 'Sales & marketing'],
  ['und.maint', 'Property operation & maintenance'],
  ['und.utilities', 'Utilities'],
  ['fixed', 'Fixed charges (rent, insurance, property tax, depreciation)'],
];
const UNDISTRIBUTED = EXPENSE_LINES.filter(([k]) => k.startsWith('und.'));

const NONE = 'none';
const PL_LINES = [...REVENUE_LINES, ...EXPENSE_LINES].map(([k]) => k).concat(NONE);
const LINE_LABEL = Object.fromEntries([...REVENUE_LINES, ...EXPENSE_LINES, [NONE, 'Not on the P&L']]);

const DEFAULT_LINE = { revenue: 'rev.misc', expense: 'und.admin' };
const fitsType = (type, line) =>
  line === NONE || (type === 'revenue' ? line.startsWith('rev.') : type === 'expense' && !line.startsWith('rev.'));

// The line an account is stored with: null for asset / liability / equity,
// otherwise the chosen line when it fits the kind, else null (= the default).
function plLineFor(type, line) {
  if (!DEFAULT_LINE[type] || !line) return null;
  return PL_LINES.includes(line) && fitsType(type, line) ? line : null;
}

// The line an account shows on (null = not a P&L account).
function lineOf(account) {
  if (!account || !DEFAULT_LINE[account.type]) return null;
  return plLineFor(account.type, account.pl_line) || DEFAULT_LINE[account.type];
}

// A posting with no account chosen yet: its line guessed from the journal key,
// so the P&L still adds up (and warns).
function lineOfKey(key) {
  if (key === 'revenue.room') return { type: 'revenue', line: 'rev.rooms' };
  if (key.startsWith('revenue.fnb')) return { type: 'revenue', line: 'rev.fnb' };
  if (key.startsWith('revenue.')) return { type: 'revenue', line: 'rev.other' };
  if (key === 'commission.expense') return { type: 'expense', line: 'dept.rooms' };
  if (key.startsWith('expense.')) return { type: 'expense', line: 'und.admin' };
  return null;
}

module.exports = { REVENUE_LINES, DEPARTMENTS, EXPENSE_LINES, UNDISTRIBUTED, PL_LINES, LINE_LABEL, NONE, plLineFor, lineOf, lineOfKey };
