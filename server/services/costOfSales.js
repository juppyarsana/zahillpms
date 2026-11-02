// Food & drink by the inventory method (migration 148, accountant 2026-10-30).
// From gl_settings.fnb_inventory_from, food and drinks bought (Expenses and
// supplier bills, category food / drinks) go to inventory, not cost
// (journalService). Each month the accountant posts one journal entry:
//
//   cost of sales = stock at the start + bought − stock at the end
//
// Stock at the start and bought are read from the inventory account, so
// anything bought and not kept in stock (market food for today) still reaches
// cost at month end. Stock at the end comes from the PMS stock (category food /
// drinks) and the POS stock (food / drink flag), at midnight after the month,
// and can be typed over. Stored as an ordinary journal entry, reference
// COGS-YYYY-MM: voided while its day is open, reversed once closed.
const db = require('../db');
const { loadMapping } = require('./accountingService');
const gl = require('./glEntryService');
const { ledgerPosts, addDays } = require('./ledgerService');
const stock = require('./stockService');
const { config, call } = require('./posRoomOrders');
const { round2 } = require('./folioService');

const fail = (error, status = 400) => ({ error, status });
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINES = [
  { key: 'food', label: 'Food', inventory: 'inventory.food', cost: 'expense.food.fnb' },
  { key: 'drinks', label: 'Drinks', inventory: 'inventory.drinks', cost: 'expense.drinks.fnb' },
];
const monthEnd = month => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const reference = month => `COGS-${month}`;
const ymd = col => `to_char(${col}, 'YYYY-MM-DD')`;

async function methodFrom(propertyId, q = db) {
  const { rows: [s] } = await q.query(`SELECT ${ymd('fnb_inventory_from')} AS d FROM gl_settings WHERE property_id = $1`, [propertyId]);
  return s?.d || null;
}

// The month's entry, unless it was voided or reversed.
async function liveEntry(propertyId, month) {
  const { rows: [e] } = await db.query(
    `SELECT e.id, e.entry_no, ${ymd('e.entry_date')} AS date FROM gl_entries e
     WHERE e.property_id = $1 AND e.reference = $2 AND e.is_voided = false
       AND NOT EXISTS (SELECT 1 FROM gl_entries r WHERE r.reverses_id = e.id AND r.is_voided = false)
     ORDER BY e.entry_no DESC LIMIT 1`, [propertyId, reference(month)]);
  if (!e) return null;
  const { rows: lines } = await db.query('SELECT account_id, debit, credit FROM gl_entry_lines WHERE entry_id = $1', [e.id]);
  return { ...e, entry_no: gl.entryNo(e.entry_no), lines };
}

// The opening balances entry's lines, when it falls inside the month: they are
// stock at the start, not purchases.
async function openingLines(propertyId, from, to) {
  const { rows } = await db.query(
    `SELECT l.account_id, l.debit, l.credit FROM gl_entries e JOIN gl_entry_lines l ON l.entry_id = e.id
     WHERE e.property_id = $1 AND e.kind = 'opening' AND e.is_voided = false AND e.entry_date BETWEEN $2::date AND $3::date`, [propertyId, from, to]);
  return rows;
}

const signed = (lines, accountId) => lines
  .filter(l => l.account_id === accountId)
  .reduce((s, l) => s + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0), 0);

async function posStock(propertyId, at) {
  const cfg = await config(propertyId);
  if (!cfg.url || !cfg.key) return { linked: false, food: 0, drinks: 0, unset: [], last_count: null };
  try {
    const r = await call(cfg, 'GET', `/api/hotel/stock-at?at=${encodeURIComponent(at)}`);
    const items = Array.isArray(r?.items) ? r.items : [];
    const sum = test => round2(items.filter(test).reduce((s, i) => s + (i.value || 0), 0));
    return {
      linked: true,
      food: sum(i => i.fnb_kind === 'food' || i.fnb_kind === 'both' || !i.fnb_kind),
      drinks: sum(i => i.fnb_kind === 'drink'),
      unset: items.filter(i => !i.fnb_kind && i.value > 0).map(i => i.name),
      last_count: r?.last_opname || null,
    };
  } catch (err) {
    return { linked: true, error: err.message, food: 0, drinks: 0, unset: [], last_count: null };
  }
}

function countWarning(who, last, first, last_day) {
  if (!last) return `${who}: no stock opname yet, so its figure is what the system expects, not a count.`;
  if (last < first) return `${who}: last stock opname ${last}, before this month. Its figure is what the system expects, not a count.`;
  if (last > last_day) return `${who}: the stock opname of ${last} is after the month ended, so what it found falls into the next month.`;
  return null;
}

async function view(propertyId, month, today) {
  if (!MONTH_RE.test(String(month || ''))) return fail('Choose a month');
  const first = `${month}-01`, last = monthEnd(month);
  if (first > today) return fail("That month hasn't started yet");
  const st = await gl.settings(propertyId);
  const from = await methodFrom(propertyId);
  const base = { month, from, books_start: st.books_start, closed_through: st.closed_through, last_day: last };
  if (!from) return { ...base, enabled: false };
  if (last < from) return { ...base, enabled: true, before_method: true };

  const ledger = await ledgerPosts(propertyId, last);
  if (ledger.error) return ledger;
  const mapping = await loadMapping(propertyId);
  const [entry, opening] = await Promise.all([liveEntry(propertyId, month), openingLines(propertyId, first, last)]);
  const ended = today > last;
  // Midnight at the hotel after the month's last day; a running month = now.
  const at = ended ? `${addDays(last, 1)}T00:00:00+08:00` : new Date().toISOString();
  const [hotel, pos, waiting] = await Promise.all([stock.fnbValueAt(propertyId, at), posStock(propertyId, at), require('./posHandover').waitingAt(propertyId, at)]);

  const warnings = [];
  const lines = LINES.map(l => {
    const inv = mapping.resolve(l.inventory).account;
    const cost = mapping.resolve(l.cost).account;
    let before = 0, inMonth = 0;
    for (const p of ledger.posts) {
      if (p.acc?.id !== inv?.id) continue;
      if (p.date < first) before += p.amount; else inMonth += p.amount;
    }
    const openingHere = inv ? signed(opening, inv.id) : 0;
    const posted = entry && inv ? signed(entry.lines, inv.id) : 0;
    const start = round2(before + openingHere);
    const bought = round2(inMonth - openingHere - posted);
    const closing_hotel = round2(hotel[l.key] || 0), closing_pos = round2(pos[l.key] || 0);
    const closing = round2(closing_hotel + closing_pos);
    return {
      key: l.key, label: l.label, start, bought, closing_hotel, closing_pos, closing, cost: round2(start + bought - closing),
      posted: entry && inv ? round2(-posted) : null,
      inventory_account: inv ? `${inv.code} ${inv.name}` : null, cost_account: cost ? `${cost.code} ${cost.name}` : null,
    };
  });

  if (pos.error) warnings.push(`The restaurant app (POS) can't be reached: ${pos.error}. Its stock is missing from the figures, type the stock at the end yourself.`);
  if (pos.linked && pos.unset.length) warnings.push(`${pos.unset.length} restaurant stock items don't say food or drink and are counted as food: ${pos.unset.slice(0, 5).join(', ')}${pos.unset.length > 5 ? '…' : ''}. Set them in the POS: Stock → Set food or drink.`);
  if (waiting.count) warnings.push(`${waiting.count} restaurant ${waiting.count === 1 ? 'delivery' : 'deliveries'} worth Rp ${Math.round(waiting.value).toLocaleString('id-ID')} had not been confirmed by the kitchen at that moment, so ${waiting.count === 1 ? 'it is' : 'they are'} not in the POS stock figure. Type the stock at the end yourself if ${waiting.count === 1 ? 'it was' : 'they were'} in the kitchen by then.`);
  if (hotel.uncosted) warnings.push(`${hotel.uncosted} hotel stock items have no cost yet and count as Rp 0.`);
  const w1 = countWarning('Hotel stock', hotel.last_count, first, last);
  if (w1 && hotel.items) warnings.push(w1);
  const w2 = pos.linked && !pos.error ? countWarning('Restaurant stock', pos.last_count, first, last) : null;
  if (w2) warnings.push(w2);
  for (const l of lines) {
    if (l.cost < 0 && !entry) warnings.push(`${l.label}: the stock at the end is more than the stock at the start plus what was bought. Check the opening balance and that purchases carry the right category.`);
  }
  if (!ended) warnings.push('This month is still running, so the stock figures are as of now. You can post on its last day or later.');

  return { ...base, enabled: true, ended, can_post: today >= last, at, lines, warnings, entry: entry && { id: entry.id, entry_no: entry.entry_no, date: entry.date } };
}

// { month, date, closing: { food, drinks } }
async function post(propertyId, userId, body, today) {
  const month = String(body?.month || '');
  if (!MONTH_RE.test(month)) return fail('Choose a month');
  const last = monthEnd(month);
  if (today < last) return fail('Post cost of sales on the last day of the month or later');
  const date = String(body?.date || last);
  if (!DATE_RE.test(date) || date < last) return fail(`Date the entry on ${last} or later`);
  const v = await view(propertyId, month, today);
  if (v.error) return v;
  if (!v.enabled || v.before_method) return fail('The inventory method is not on for this month');
  if (v.entry) return fail(`Already posted as ${v.entry.entry_no}. Void or reverse it first`, 409);

  const mapping = await loadMapping(propertyId);
  const entryLines = [], parts = [];
  for (const l of v.lines) {
    const typed = body?.closing?.[l.key];
    const closing = typed === undefined || typed === null || typed === '' ? l.closing : Number(typed);
    if (!Number.isFinite(closing) || closing < 0) return fail(`${l.label}: stock at the end must be 0 or more`);
    const cost = round2(l.start + l.bought - closing);
    parts.push(`${l.label}: start ${l.start.toLocaleString('id-ID')} + bought ${l.bought.toLocaleString('id-ID')} - end ${closing.toLocaleString('id-ID')}`);
    if (Math.abs(cost) < 0.005) continue;
    const def = LINES.find(x => x.key === l.key);
    const inv = mapping.resolve(def.inventory).account, exp = mapping.resolve(def.cost).account;
    if (!inv || !exp) return fail(`${l.label}: choose its accounts in Accounting → Accounts`);
    // A negative figure (stock worth more than the books say) posts the other way round.
    entryLines.push({ account_id: exp.id, debit: cost > 0 ? cost : 0, credit: cost < 0 ? -cost : 0, memo: `Cost of ${l.label.toLowerCase()}` });
    entryLines.push({ account_id: inv.id, debit: cost < 0 ? -cost : 0, credit: cost > 0 ? cost : 0, memo: `${l.label} used` });
  }
  if (!entryLines.length) return fail('Nothing to post: cost of sales is 0');
  return gl.createEntry(propertyId, userId, {
    date, reference: reference(month), memo: `Cost of sales ${month} · ${parts.join(' · ')}`.slice(0, 300), lines: entryLines,
  }, today);
}

// { from: 'YYYY-MM-DD' | null } — from which day food and drinks bought are stock.
async function saveMethod(propertyId, body) {
  const from = body?.from === null || body?.from === '' ? null : String(body?.from || '');
  if (from !== null && !DATE_RE.test(from)) return fail('Choose the first day');
  const st = await gl.settings(propertyId);
  if (from && st.books_start && from < st.books_start) return fail(`The books start on ${st.books_start}`);
  const current = await methodFrom(propertyId);
  for (const d of [from, current]) {
    if (d && st.closed_through && d <= st.closed_through) {
      return fail(`Days up to ${st.closed_through} are closed. The method can only change on days not closed yet`, 409);
    }
  }
  if (!from) {
    const { rows: [e] } = await db.query(
      `SELECT 1 FROM gl_entries WHERE property_id = $1 AND reference LIKE 'COGS-%' AND is_voided = false LIMIT 1`, [propertyId]);
    if (e) return fail('Cost of sales entries are posted. Void them before switching this off', 409);
  }
  await db.query(
    `INSERT INTO gl_settings (property_id, fnb_inventory_from) VALUES ($1, $2)
     ON CONFLICT (property_id) DO UPDATE SET fnb_inventory_from = $2`, [propertyId, from]);
  return { ok: true, from };
}

module.exports = { view, post, saveMethod };
