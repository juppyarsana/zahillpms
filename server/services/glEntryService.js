// Accounting step 2, phase B (migration 111): the accountant's own journal
// entries, the opening balances and the first day of the books.
//
// An entry is never edited or deleted. While its day is still open (after the
// last closed day) it can be voided; after that it is reversed — a new entry
// with the sides swapped, dated on an open day — so a closed day never
// changes. Its lines reach the journal, P&L, trial balance and balance sheet
// through journalService.collectPosts (key `acct.<account id>`).
const db = require('../db');
const { round2 } = require('./folioService');

const ymd = expr => `to_char(${expr}, 'YYYY-MM-DD')`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = s => DATE_RE.test(s || '') && !isNaN(Date.parse(s));
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthEnd = day => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 0)).toISOString().slice(0, 10);
const entryNo = n => `JE-${String(n).padStart(4, '0')}`;
const BALANCE_SHEET = ['asset', 'liability', 'equity'];
const OPENING_EQUITY = '3190';
const PMS_KEYS = ['ledger.guest', 'ledger.deposits', 'ledger.agent', 'tax.service', 'tax.pb1', 'commission.payable'];
const fail = (error, status = 400) => ({ error, status });

async function settings(propertyId, q = db) {
  const [{ rows: [s] }, { rows: [c] }] = await Promise.all([
    q.query(`SELECT ${ymd('books_start')} AS books_start FROM gl_settings WHERE property_id = $1`, [propertyId]),
    q.query(`SELECT ${ymd('MAX(business_date)')} AS through FROM gl_closed_days WHERE property_id = $1`, [propertyId]),
  ]);
  return { books_start: s?.books_start || null, closed_through: c?.through || null };
}

// A day an entry can be dated on: on / after the first day of the books, after
// the last closed day, and no later than the end of this month.
function dateProblem(date, st, today) {
  if (!isDate(date)) return 'Choose the date of the entry';
  if (st.books_start && date < st.books_start) return `The books start on ${st.books_start} — date the entry on or after that day`;
  if (st.closed_through && date <= st.closed_through) return `Days up to ${st.closed_through} are closed — date the entry after that day`;
  if (date > monthEnd(today)) return 'An entry can be dated up to the end of this month';
  return null;
}

async function activeAccounts(propertyId, q = db) {
  const { rows } = await q.query('SELECT id, code, name, type, is_active FROM gl_accounts WHERE property_id = $1', [propertyId]);
  return new Map(rows.map(a => [a.id, a]));
}

// lines: [{ account_id, debit, credit, memo }] → clean lines, balanced.
function cleanLines(lines, accounts) {
  if (!Array.isArray(lines)) return { error: 'Add the lines of the entry' };
  const out = [];
  for (const [i, l] of lines.entries()) {
    const debit = round2(parseFloat(l?.debit) || 0), credit = round2(parseFloat(l?.credit) || 0);
    if (!l?.account_id && !debit && !credit) continue;   // an empty row of the form
    const a = accounts.get(l?.account_id);
    if (!a || !a.is_active) return { error: `Line ${i + 1}: choose an account from the list` };
    if (debit < 0 || credit < 0) return { error: `Line ${i + 1}: amounts can't be negative` };
    if ((debit > 0) === (credit > 0)) return { error: `Line ${i + 1}: enter either a debit or a credit` };
    if (Math.max(debit, credit) > 999999999999) return { error: `Line ${i + 1}: amount too large` };
    out.push({ account_id: a.id, debit, credit, memo: String(l.memo || '').trim().slice(0, 200) || null });
  }
  if (out.length < 2) return { error: 'An entry needs at least two lines' };
  const dr = round2(out.reduce((s, l) => s + l.debit, 0)), cr = round2(out.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) >= 0.005) return { error: `Debits (${dr.toLocaleString('id-ID')}) and credits (${cr.toLocaleString('id-ID')}) must be equal` };
  return { lines: out, total: dr };
}

// Inserts one entry with its lines inside the caller's transaction.
async function insertEntry(client, propertyId, userId, { kind = 'manual', date, memo, reference = null, reversesId = null, lines }) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gl_entry:${propertyId}`]);
  const { rows: [n] } = await client.query('SELECT COALESCE(MAX(entry_no), 0) + 1 AS no FROM gl_entries WHERE property_id = $1', [propertyId]);
  const { rows: [e] } = await client.query(
    `INSERT INTO gl_entries (property_id, entry_no, kind, entry_date, memo, reference, reverses_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, entry_no`,
    [propertyId, n.no, kind, date, memo, reference, reversesId, userId || null]);
  for (const [i, l] of lines.entries()) {
    await client.query(
      'INSERT INTO gl_entry_lines (entry_id, line_no, account_id, debit, credit, memo) VALUES ($1, $2, $3, $4, $5, $6)',
      [e.id, i + 1, l.account_id, l.debit, l.credit, l.memo]);
  }
  return e;
}

async function inTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query(r && r.error ? 'ROLLBACK' : 'COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// { date, memo, reference?, lines }
async function createEntry(propertyId, userId, body, today) {
  const memo = String(body?.memo || '').trim();
  if (!memo) return fail('Describe the entry (e.g. "Payroll October")');
  if (memo.length > 300) return fail('Description: at most 300 characters');
  const reference = String(body?.reference || '').trim().slice(0, 100) || null;
  return inTransaction(async client => {
    const st = await settings(propertyId, client);
    const problem = dateProblem(String(body?.date || ''), st, today);
    if (problem) return fail(problem);
    const { lines, error } = cleanLines(body?.lines, await activeAccounts(propertyId, client));
    if (error) return fail(error);
    const e = await insertEntry(client, propertyId, userId, { date: body.date, memo, reference, lines });
    return { id: e.id, entry_no: entryNo(e.entry_no) };
  });
}

async function listEntries(propertyId, { from, to, q, voided = false } = {}) {
  const params = [propertyId];
  let where = 'e.property_id = $1';
  if (!voided) where += ' AND e.is_voided = false';
  if (isDate(from)) { params.push(from); where += ` AND e.entry_date >= $${params.length}`; }
  if (isDate(to)) { params.push(to); where += ` AND e.entry_date <= $${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (e.memo ILIKE $${params.length} OR e.reference ILIKE $${params.length})`; }
  const { rows } = await db.query(`
    SELECT e.id, e.entry_no, e.kind, ${ymd('e.entry_date')} AS date, e.memo, e.reference, e.is_voided, e.void_reason,
           e.created_at, u.name AS created_by_name,
           COALESCE(SUM(l.debit), 0) AS total, COUNT(l.id)::int AS lines,
           (SELECT r.entry_no FROM gl_entries r WHERE r.reverses_id = e.id AND r.is_voided = false LIMIT 1) AS reversed_by_no,
           (SELECT o.entry_no FROM gl_entries o WHERE o.id = e.reverses_id) AS reverses_no
    FROM gl_entries e
    LEFT JOIN gl_entry_lines l ON l.entry_id = e.id
    LEFT JOIN users u ON u.id = e.created_by
    WHERE ${where}
    GROUP BY e.id, u.name
    ORDER BY e.entry_date DESC, e.entry_no DESC
    LIMIT 500`, params);
  return rows.map(r => ({
    ...r, entry_no: entryNo(r.entry_no), total: round2(parseFloat(r.total)),
    reversed_by: r.reversed_by_no ? entryNo(r.reversed_by_no) : null, reverses: r.reverses_no ? entryNo(r.reverses_no) : null,
  }));
}

async function getEntry(propertyId, id) {
  const { rows: [e] } = await db.query(`
    SELECT e.id, e.entry_no, e.kind, ${ymd('e.entry_date')} AS date, e.memo, e.reference, e.is_voided, e.void_reason,
           e.voided_at, e.created_at, u.name AS created_by_name, v.name AS voided_by_name,
           (SELECT o.entry_no FROM gl_entries o WHERE o.id = e.reverses_id) AS reverses_no,
           (SELECT r.entry_no FROM gl_entries r WHERE r.reverses_id = e.id AND r.is_voided = false LIMIT 1) AS reversed_by_no
    FROM gl_entries e
    LEFT JOIN users u ON u.id = e.created_by
    LEFT JOIN users v ON v.id = e.voided_by
    WHERE e.id = $1 AND e.property_id = $2`, [id, propertyId]);
  if (!e) return null;
  const { rows: lines } = await db.query(`
    SELECT l.line_no, l.account_id, a.code AS account_code, a.name AS account_name, l.debit, l.credit, l.memo
    FROM gl_entry_lines l JOIN gl_accounts a ON a.id = l.account_id
    WHERE l.entry_id = $1 ORDER BY l.line_no`, [id]);
  const st = await settings(propertyId);
  return {
    ...e, entry_no: entryNo(e.entry_no),
    reverses: e.reverses_no ? entryNo(e.reverses_no) : null,
    reversed_by: e.reversed_by_no ? entryNo(e.reversed_by_no) : null,
    lines: lines.map(l => ({ ...l, debit: round2(parseFloat(l.debit)), credit: round2(parseFloat(l.credit)) })),
    day_closed: !!(st.closed_through && e.date <= st.closed_through),
  };
}

async function voidEntry(propertyId, id, userId, reason) {
  const why = String(reason || '').trim();
  if (!why) return fail('Say why the entry is voided');
  return inTransaction(async client => {
    const { rows: [e] } = await client.query(
      `SELECT id, kind, is_voided, ${ymd('entry_date')} AS date FROM gl_entries WHERE id = $1 AND property_id = $2 FOR UPDATE`, [id, propertyId]);
    if (!e) return fail('Entry not found', 404);
    if (e.is_voided) return fail('This entry is already voided', 409);
    const st = await settings(propertyId, client);
    if (st.closed_through && e.date <= st.closed_through) {
      return fail(`${e.date} is closed — reverse the entry instead (it posts the opposite on an open day)`, 409);
    }
    await client.query(
      'UPDATE gl_entries SET is_voided = true, voided_by = $3, voided_at = NOW(), void_reason = $4 WHERE id = $1 AND property_id = $2',
      [id, propertyId, userId || null, why.slice(0, 300)]);
    return { ok: true };
  });
}

// { date, memo? } — a new entry with debits and credits swapped.
async function reverseEntry(propertyId, id, userId, body, today) {
  return inTransaction(async client => {
    const { rows: [e] } = await client.query(
      `SELECT id, kind, entry_no, memo, is_voided FROM gl_entries WHERE id = $1 AND property_id = $2 FOR UPDATE`, [id, propertyId]);
    if (!e) return fail('Entry not found', 404);
    if (e.is_voided) return fail('A voided entry has nothing to reverse', 409);
    if (e.kind === 'opening') return fail('Opening balances are changed on the Opening balances card, not reversed', 409);
    const { rows: [done] } = await client.query('SELECT entry_no FROM gl_entries WHERE reverses_id = $1 AND is_voided = false', [id]);
    if (done) return fail(`Already reversed by ${entryNo(done.entry_no)}`, 409);
    const st = await settings(propertyId, client);
    const date = String(body?.date || today);
    const problem = dateProblem(date, st, today);
    if (problem) return fail(problem);
    const { rows: lines } = await client.query(
      'SELECT account_id, debit, credit, memo FROM gl_entry_lines WHERE entry_id = $1 ORDER BY line_no', [id]);
    const memo = String(body?.memo || '').trim() || `Reversal of ${entryNo(e.entry_no)} — ${e.memo}`;
    const r = await insertEntry(client, propertyId, userId, {
      date, memo: memo.slice(0, 300), reversesId: id,
      lines: lines.map(l => ({ account_id: l.account_id, debit: round2(parseFloat(l.credit)), credit: round2(parseFloat(l.debit)), memo: l.memo })),
    });
    return { id: r.id, entry_no: entryNo(r.entry_no) };
  });
}

// ── First day of the books ──
async function setBooksStart(propertyId, userId, date, today) {
  if (!isDate(date)) return fail('Choose a date');
  if (date > today) return fail('The books can start today at the latest');
  const st = await settings(propertyId);
  if (st.closed_through) return fail(`Days are already closed from ${st.books_start || 'the first day'} — the first day of the books can't move any more`, 409);
  const { rows: [blocking] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE kind = 'opening')::int AS opening, COUNT(*) FILTER (WHERE kind = 'manual' AND entry_date < $2)::int AS before
     FROM gl_entries WHERE property_id = $1 AND is_voided = false`, [propertyId, date]);
  if (blocking.opening && date !== st.books_start) return fail('Clear the opening balances first — they are dated on the first day of the books', 409);
  if (blocking.before) return fail(`${blocking.before} journal entr${blocking.before === 1 ? 'y is' : 'ies are'} dated before ${date} — void them first`, 409);
  await db.query(
    `INSERT INTO gl_settings (property_id, books_start, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (property_id) DO UPDATE SET books_start = EXCLUDED.books_start, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [propertyId, date, userId || null]);
  return { books_start: date };
}

// ── Opening balances ──
// The earliest day the PMS has anything for this property.
async function firstPmsDay(propertyId) {
  const { rows: [r] } = await db.query(`
    SELECT ${ymd('LEAST(MIN(b.check_in_date), MIN((b.created_at AT TIME ZONE \'Asia/Makassar\')::date))')} AS d
    FROM bookings b WHERE b.property_id = $1`, [propertyId]);
  const { rows: [x] } = await db.query(
    `SELECT ${ymd('MIN(incurred_on)')} AS d FROM expenses WHERE property_id = $1`, [propertyId]);
  return [r?.d, x?.d].filter(Boolean).sort()[0] || null;
}

// Every balance-sheet account with: what the PMS itself posted to it before
// the books start (for the guest ledger, deposits, agents, service & tax —
// a hint, the accountant decides) and the opening balance saved now.
async function openingView(propertyId) {
  const st = await settings(propertyId);
  const { rows: accounts } = await db.query(
    `SELECT id, code, name, type, is_active FROM gl_accounts WHERE property_id = $1 AND type = ANY($2) ORDER BY code`,
    [propertyId, BALANCE_SHEET]);
  const { rows: [entry] } = await db.query(
    `SELECT id, entry_no, ${ymd('entry_date')} AS date, created_at FROM gl_entries
     WHERE property_id = $1 AND kind = 'opening' AND is_voided = false`, [propertyId]);
  const saved = new Map();
  if (entry) {
    const { rows } = await db.query('SELECT account_id, debit, credit FROM gl_entry_lines WHERE entry_id = $1', [entry.id]);
    for (const l of rows) saved.set(l.account_id, round2((saved.get(l.account_id) || 0) + parseFloat(l.debit) - parseFloat(l.credit)));
  }
  const pms = new Map();
  if (st.books_start) {
    const first = await firstPmsDay(propertyId);
    if (first && first < st.books_start) {
      const { postingsFor } = require('./journalService');
      const { posts } = await postingsFor(propertyId, first, addDays(st.books_start, -1));
      for (const p of posts) if (p.account) pms.set(p.account.id, round2((pms.get(p.account.id) || 0) + p.amount));
    }
  }
  // The accounts only the PMS knows (what guests and agents owe, deposits,
  // service charge / tax / commission to pay): their PMS figure is the one to
  // take. Cash and bank come from the old system's books.
  const { loadMapping } = require('./accountingService');
  const mapping = await loadMapping(propertyId);
  const pmsOwned = new Set(PMS_KEYS.map(k => mapping.resolve(k).account?.id).filter(Boolean));
  return {
    books_start: st.books_start,
    closed_through: st.closed_through,
    editable: !!st.books_start && !(st.closed_through && st.books_start <= st.closed_through),
    entry: entry ? { id: entry.id, entry_no: entryNo(entry.entry_no), date: entry.date, created_at: entry.created_at } : null,
    accounts: accounts.map(a => ({
      ...a, pms_before: pms.get(a.id) || 0, pms_owned: pmsOwned.has(a.id), amount: saved.get(a.id) || 0,
    })),
  };
}

// balances: [{ account_id, amount }] — amount signed: + debit balance, − credit
// balance. The difference goes to Opening balance equity (3190). Replaces the
// opening balances saved before (the old entry is voided, kept).
async function saveOpening(propertyId, userId, balances) {
  if (!Array.isArray(balances)) return fail('Nothing to save');
  return inTransaction(async client => {
    const st = await settings(propertyId, client);
    if (!st.books_start) return fail('Set the first day of the books first');
    if (st.closed_through && st.books_start <= st.closed_through) return fail(`${st.books_start} is closed — the opening balances can't change any more`, 409);
    const accounts = await activeAccounts(propertyId, client);
    const lines = [];
    for (const b of balances) {
      const amount = round2(parseFloat(b?.amount) || 0);
      if (!amount) continue;
      const a = accounts.get(b.account_id);
      if (!a || !BALANCE_SHEET.includes(a.type)) return fail('Opening balances go on asset, liability and equity accounts only');
      if (!a.is_active) return fail(`${a.code} · ${a.name} is not in use — choose another account`);
      lines.push({ account_id: a.id, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, memo: null });
    }
    const diff = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
    if (Math.abs(diff) >= 0.005) {
      const eq = [...accounts.values()].find(a => a.code === OPENING_EQUITY && a.type === 'equity' && a.is_active);
      if (!eq) return fail(`The difference (Rp ${diff.toLocaleString('id-ID')}) needs an equity account ${OPENING_EQUITY} "Opening balance equity" — add it on the Accounts tab`);
      const mine = lines.find(l => l.account_id === eq.id);
      if (mine) {
        const v = round2(mine.debit - mine.credit - diff);
        mine.debit = v > 0 ? v : 0; mine.credit = v < 0 ? -v : 0;
        if (!v) lines.splice(lines.indexOf(mine), 1);
      } else {
        lines.push({ account_id: eq.id, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0, memo: 'Difference — opening balance equity' });
      }
    }
    await client.query(
      `UPDATE gl_entries SET is_voided = true, voided_by = $2, voided_at = NOW(), void_reason = 'Replaced by new opening balances'
       WHERE property_id = $1 AND kind = 'opening' AND is_voided = false`, [propertyId, userId || null]);
    if (!lines.length) return { ok: true, entry_no: null };
    const e = await insertEntry(client, propertyId, userId, { kind: 'opening', date: st.books_start, memo: 'Opening balances', lines });
    return { ok: true, entry_no: entryNo(e.entry_no) };
  });
}

module.exports = {
  settings, createEntry, listEntries, getEntry, voidEntry, reverseEntry, setBooksStart, openingView, saveOpening, entryNo,
};
