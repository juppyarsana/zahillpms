// Accounting, step 1 (migration 101): the chart of accounts and which account
// each kind of amount goes to. The journal (journalService.js) asks
// loadMapping() for the account behind a key such as 'revenue.room'.
const db = require('../db');
const { PL_LINES, plLineFor } = require('./plLayout');
const { COST_CATEGORIES, CATEGORY_KEYS } = require('./costCategories');
const { STANDARD_CHART, OLD_CHART, OLD_OTHER_INCOME, CHART_VERSION } = require('./standardChart');

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// Every fixed mapping key: [key, label, group, starting account code].
const MAP_KEYS = [
  ['revenue.room', 'Room nights', 'Revenue', '400-11-001'],
  ['revenue.fnb_package', 'Meals in the rate plan (breakfast, half / full board, breakfast with an extra bed)', 'Revenue', '410-21-001'],
  ['revenue.fnb_outlet.food.breakfast', 'Restaurant food — breakfast', 'Revenue', '410-21-001'],
  ['revenue.fnb_outlet.food.lunch', 'Restaurant food — lunch', 'Revenue', '410-21-002'],
  ['revenue.fnb_outlet.food.dinner', 'Restaurant food — dinner', 'Revenue', '410-21-003'],
  ['revenue.fnb_outlet.drink.breakfast', 'Restaurant drinks — breakfast', 'Revenue', '410-21-101'],
  ['revenue.fnb_outlet.drink.lunch', 'Restaurant drinks — lunch', 'Revenue', '410-21-102'],
  ['revenue.fnb_outlet.drink.dinner', 'Restaurant drinks — dinner', 'Revenue', '410-21-103'],
  ['revenue.fnb_outlet', 'Restaurant bills not split (session not sent yet, or sent before the split)', 'Revenue', '410-21-004'],
  ['revenue.extra.room_addon', 'Extras — room add-ons (extra bed, early / late check-out)', 'Revenue', '400-11-003'],
  ['revenue.extra.transport', 'Extras — transport', 'Revenue', '430-32-001'],
  ['revenue.extra.laundry', 'Extras — laundry', 'Revenue', '430-33-001'],
  ['revenue.extra.service', 'Extras — services', 'Revenue', '430-36-001'],
  ['revenue.extra.merchandise', 'Extras — merchandise', 'Revenue', '430-35-001'],
  ['revenue.extra.minibar', 'Extras — minibar', 'Revenue', '410-21-201'],
  ['revenue.extra.other', 'Extras — other', 'Revenue', '470-60-001'],
  ['revenue.activities', 'Activities', 'Revenue', '430-31-001'],
  ['revenue.events', 'Meeting room & events (venue hire and other event lines)', 'Revenue', '410-22-001'],
  ['tax.service', 'Service charge collected', 'Service charge & tax', '250-00-001'],
  ['tax.service.lb', 'Service charge — Loss & Breakage part', 'Service charge & tax', '250-00-002'],
  ['tax.service.hrd', 'Service charge — HR Development part', 'Service charge & tax', '250-00-003'],
  ['tax.pb1', 'Tax collected (PB1)', 'Service charge & tax', '220-00-001'],
  ['ledger.guest', 'Guest ledger — what guests who have arrived owe (or have paid ahead)', 'Guests & agents', '120-00-001'],
  ['ledger.deposits', 'Advance deposits — money received before the guest arrives', 'Guests & agents', '240-00-001'],
  ['ledger.agent', 'Agents & companies — stays billed to them', 'Guests & agents', '120-00-002'],
  ['commission.expense', 'Agent commission (cost)', 'Guests & agents', '602-11-018'],
  ['commission.payable', 'Agent commission still to pay', 'Guests & agents', '230-00-009'],
  ['commission.ota', 'Commission kept back by OTAs / agents from their payouts', 'Guests & agents', '602-11-019'],
  ['pos.takings', 'Restaurant bills paid at the restaurant (from the POS sessions)', 'Money received', '110-20-002'],
  ['payables.supplier', 'Supplier bills not paid yet (Payables)', 'Suppliers', '210-00-001'],
  // Food & drink by the inventory method (migration 148, costOfSales.js)
  ['inventory.food', 'Food bought, kept as stock until used', 'Food & drink stock', '130-00-001'],
  ['inventory.drinks', 'Drinks bought, kept as stock until used', 'Food & drink stock', '130-00-002'],
  // Vendor share of tours / transport (migration 140)
  ['vendor.share', "Vendor's part of activities — taken off revenue", 'Tour & transport vendors', '430-31-098'],
  ['vendor.cost', "Vendor's part of activities — booked as a cost", 'Tour & transport vendors', '530-31-001'],
  ['vendor.owed', 'Owed to tour & transport vendors, not paid yet', 'Tour & transport vendors', '210-00-002'],
  // one key per cost category, used by Expenses and Payables (costCategories.js)
  ...COST_CATEGORIES.map(([k, label, code]) => [`expense.${k}`, label, 'Expenses & supplier bills', code]),
];
const EXTRA_CATEGORIES = ['room_addon', 'transport', 'laundry', 'service', 'merchandise', 'minibar', 'other'];
const EXPENSE_CATEGORIES = CATEGORY_KEYS;

// Categories whose standard account depends on the department of the cost:
// the department's cost group + the category's number (602-12-002 =
// Housekeeping guest supplies). A number the department doesn't have goes to
// that department's Other Expenses (099).
const DEPT_SEGMENT = {
  front_office: '602-11', housekeeping: '602-12', fnb: '622-21', activities: '632-30',
  admin: '702-71', sales: '722-73', engineering: '732-74',
};
const CATEGORY_NUMBER = { guest_supplies: '002', supplies: '003', laundry: '005', other: '099' };
const hasDeptAccount = key => !!CATEGORY_NUMBER[key.split('.')[1]];

// Payment methods → the three standard accounts money arrives on. A method
// naming a bank goes to that bank's own account when the property has one.
const BANKS = ['bca', 'bni', 'mandiri', 'cimb', 'bri', 'bpd'];
function accountForMethod(id, label, accounts) {
  const s = `${id} ${label || ''}`.toLowerCase();
  const bank = BANKS.find(b => s.includes(b));
  const named = (re) => bank && accounts.find(a => a.type === 'asset' && a.is_active && re.test(a.name) && a.name.toLowerCase().includes(bank));
  const byCode = code => accounts.find(a => a.code === code) || null;
  if (/vcc|virtual/.test(s)) return byCode('120-10-001');
  if (/ota/.test(s)) return byCode('120-00-004');
  if (/cash|tunai/.test(s)) return byCode('110-20-001');
  if (/qris|card|edc|debit|credit|kartu|visa|master/.test(s)) {
    return named(/settlement/i) || byCode(/qris/.test(s) ? '120-10-002' : '120-10-001');
  }
  if (/bank|transfer|wise/.test(s) || bank) return named(/^bank/i) || byCode('110-10-001');
  return byCode('120-10-003');
}

// The optional accounts the PMS posts to by itself stay switched on.
const autoCodes = () => new Set([
  ...MAP_KEYS.map(k => k[3]), '120-00-004', '120-10-001', '120-10-002', '120-10-003', '110-20-001', '110-10-001',
  ...Object.values(DEPT_SEGMENT).flatMap(seg => [...Object.values(CATEGORY_NUMBER), '099'].map(n => `${seg}-${n}`)),
]);

// Puts a property on the standard chart: a new one gets it, an older chart is
// converted (same rows, new codes). A code or name the property changed itself
// is left alone, and every standard account it lacks is added.
async function ensureChart(propertyId) {
  const { rows: [s] } = await db.query('SELECT chart_version FROM gl_settings WHERE property_id = $1', [propertyId]);
  if ((s?.chart_version || 0) >= CHART_VERSION) return;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chart:${propertyId}`]);
    const { rows: [again] } = await client.query('SELECT chart_version FROM gl_settings WHERE property_id = $1', [propertyId]);
    if ((again?.chart_version || 0) < CHART_VERSION) {
      const standard = new Map(STANDARD_CHART.map(r => [r[0], r]));
      for (const [oldCode, oldName, oldLine, code] of OLD_CHART) {
        const [, name, , line] = standard.get(code);
        await client.query(
          `UPDATE gl_accounts SET code = $3,
                  name = CASE WHEN name = $4 THEN $5 ELSE name END,
                  pl_line = CASE WHEN pl_line IS NOT DISTINCT FROM $6 THEN $7 ELSE pl_line END, updated_at = NOW()
           WHERE property_id = $1 AND code = $2
             AND NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.property_id = $1 AND x.code = $3)`,
          [propertyId, oldCode, code, oldName, name, oldLine, line]);
      }
      const [oldCode, oldName, , newCode, newName] = OLD_OTHER_INCOME;
      await client.query(
        `UPDATE gl_accounts a SET code = $3, name = CASE WHEN name = $4 THEN $5 ELSE name END, updated_at = NOW(),
                is_active = EXISTS (SELECT 1 FROM gl_entry_lines l WHERE l.account_id = a.id)
         WHERE a.property_id = $1 AND a.code = $2`, [propertyId, oldCode, newCode, oldName, newName]);
      const auto = autoCodes();
      for (const [code, name, type, line, optional] of STANDARD_CHART) {
        await client.query(
          `INSERT INTO gl_accounts (property_id, code, name, type, pl_line, is_active) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (property_id, code) DO NOTHING`, [propertyId, code, name, type, line, !optional || auto.has(code)]);
      }
      await client.query(
        `INSERT INTO gl_settings (property_id, chart_version) VALUES ($1, $2)
         ON CONFLICT (property_id) DO UPDATE SET chart_version = EXCLUDED.chart_version`, [propertyId, CHART_VERSION]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listAccounts(propertyId) {
  await ensureChart(propertyId);
  const { rows } = await db.query(
    `SELECT id, code, name, type, pl_line, is_active FROM gl_accounts WHERE property_id = $1 ORDER BY code`, [propertyId]);
  return rows;
}

// Every mapping key of the property (fixed keys + one per payment method)
// with the account it goes to: the saved choice, else the standard chart's
// account for it, else none (`account` null — the journal flags it).
async function loadMapping(propertyId) {
  const accounts = await listAccounts(propertyId);
  const [{ rows: saved }, { rows: methods }] = await Promise.all([
    db.query('SELECT map_key, account_id FROM gl_account_map WHERE property_id = $1', [propertyId]),
    db.query('SELECT id, label, is_active FROM payment_methods WHERE property_id = $1 ORDER BY sort_order, label', [propertyId]),
  ]);
  const byId = new Map(accounts.map(a => [a.id, a]));
  const byCode = new Map(accounts.map(a => [a.code, a]));
  const savedBy = new Map(saved.map(s => [s.map_key, s.account_id]));
  const keys = [
    ...methods.map(m => [`pay.${m.id}`, `${m.label}${m.is_active ? '' : ' (inactive)'}`, 'Money received', accountForMethod(m.id, m.label, accounts)?.code]),
    ...MAP_KEYS,
  ].map(([key, label, group, code]) => {
    const chosen = savedBy.has(key) ? byId.get(savedBy.get(key)) : null;
    const account = chosen || byCode.get(code) || null;
    return { key, label, group, account_id: account?.id || null, is_default: !chosen, account, by_department: hasDeptAccount(key) && key.startsWith('expense.') && !chosen };
  });
  const map = new Map(keys.map(k => [k.key, k]));
  return {
    accounts, keys,
    // The account behind a key; an unknown payment method (deleted since)
    // falls back to "other receipts".
    resolve(key) {
      // A line of a journal entry names its account itself (glEntryService).
      if (key.startsWith('acct.')) {
        const a = byId.get(key.slice(5));
        return { key, label: a ? a.name : 'Account no longer in the chart', account: a || null };
      }
      const k = map.get(key);
      if (k) return { key, label: k.label, account: k.account };
      if (key.startsWith('pay.')) return { key, label: key.slice(4), account: byCode.get('120-10-003') || null };
      if (key.startsWith('revenue.extra.')) return { key, label: key, account: map.get('revenue.extra.other')?.account || null };
      if (key.startsWith('expense.')) {
        // expense.<category>.<department>: an account chosen for the category
        // wins, else the department's own account for it.
        const [, category, department] = key.split('.');
        const cat = map.get(`expense.${category}`) || map.get('expense.other');
        if (!cat || !cat.is_default) return { key, label: cat?.label || key, account: cat?.account || null };
        const seg = DEPT_SEGMENT[department];
        const account = seg && CATEGORY_NUMBER[category]
          ? byCode.get(`${seg}-${CATEGORY_NUMBER[category]}`) || byCode.get(`${seg}-099`) : null;
        return { key, label: cat.label, account: account || cat.account };
      }
      return { key, label: key, account: null };
    },
  };
}

// The part of the service charge that doesn't go to staff (% of the charge).
async function serviceSplit(propertyId, q = db) {
  const { rows: [s] } = await q.query('SELECT service_lb_pct, service_hrd_pct FROM gl_settings WHERE property_id = $1', [propertyId]);
  return { lb_pct: parseFloat(s?.service_lb_pct) || 0, hrd_pct: parseFloat(s?.service_hrd_pct) || 0 };
}

async function saveServiceSplit(propertyId, body, userId) {
  const lb = parseFloat(body?.lb_pct), hrd = parseFloat(body?.hrd_pct);
  if (!(lb >= 0) || !(hrd >= 0) || lb + hrd > 100) return { error: 'Enter two percentages of the service charge, together at most 100' };
  await db.query(
    `INSERT INTO gl_settings (property_id, service_lb_pct, service_hrd_pct, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (property_id) DO UPDATE SET service_lb_pct = EXCLUDED.service_lb_pct, service_hrd_pct = EXCLUDED.service_hrd_pct,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [propertyId, lb, hrd, userId || null]);
  return { lb_pct: lb, hrd_pct: hrd };
}

function cleanAccount(body, { partial = false } = {}) {
  const out = {};
  if (body.code !== undefined || !partial) {
    out.code = String(body.code || '').trim();
    if (!out.code || out.code.length > 20) return { error: 'Account code is required (at most 20 characters)' };
  }
  if (body.name !== undefined || !partial) {
    out.name = String(body.name || '').trim();
    if (!out.name || out.name.length > 120) return { error: 'Account name is required (at most 120 characters)' };
  }
  if (body.type !== undefined || !partial) {
    out.type = String(body.type || '');
    if (!TYPES.includes(out.type)) return { error: 'Choose the kind of account' };
  }
  if (body.pl_line !== undefined) {
    out.pl_line = body.pl_line ? String(body.pl_line) : null;
    if (out.pl_line && !PL_LINES.includes(out.pl_line)) return { error: 'Choose a line of the Profit & Loss' };
  }
  if (body.is_active !== undefined) out.is_active = !!body.is_active;
  return { value: out };
}

async function createAccount(propertyId, body) {
  const { value, error } = cleanAccount(body);
  if (error) return { error };
  try {
    const { rows: [a] } = await db.query(
      `INSERT INTO gl_accounts (property_id, code, name, type, pl_line) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, type, pl_line, is_active`, [propertyId, value.code, value.name, value.type, plLineFor(value.type, value.pl_line)]);
    return { account: a };
  } catch (err) {
    if (err.code === '23505') return { error: `Account code ${value.code} is already used`, status: 409 };
    throw err;
  }
}

async function updateAccount(propertyId, id, body) {
  const { value, error } = cleanAccount(body, { partial: true });
  if (error) return { error };
  if (value.is_active === false) {
    const mapping = await loadMapping(propertyId);
    const used = mapping.keys.filter(k => k.account_id === id);
    if (used.length) return { error: `This account is still used for: ${used.slice(0, 3).map(k => k.label).join('; ')}${used.length > 3 ? '…' : ''}. Choose another account for those first.`, status: 409 };
  }
  // The P&L line follows the kind: one that doesn't fit the (new) kind goes
  // back to the kind's default.
  const { rows: [cur] } = await db.query('SELECT type, pl_line FROM gl_accounts WHERE id = $1 AND property_id = $2', [id, propertyId]);
  if (!cur) return { error: 'Account not found', status: 404 };
  const plLine = plLineFor(value.type || cur.type, value.pl_line !== undefined ? value.pl_line : cur.pl_line);
  try {
    const { rows: [a] } = await db.query(
      `UPDATE gl_accounts SET code = COALESCE($3, code), name = COALESCE($4, name), type = COALESCE($5, type),
              is_active = COALESCE($6, is_active), pl_line = $7, updated_at = NOW()
       WHERE id = $1 AND property_id = $2 RETURNING id, code, name, type, pl_line, is_active`,
      [id, propertyId, value.code ?? null, value.name ?? null, value.type ?? null, value.is_active ?? null, plLine]);
    return a ? { account: a } : { error: 'Account not found', status: 404 };
  } catch (err) {
    if (err.code === '23505') return { error: `Account code ${value.code} is already used`, status: 409 };
    throw err;
  }
}

// map = { key: account_id | null }; null puts the key back on the standard account.
async function saveMapping(propertyId, map, userId) {
  const mapping = await loadMapping(propertyId);
  const known = new Set(mapping.keys.map(k => k.key));
  const accountIds = new Set(mapping.accounts.filter(a => a.is_active).map(a => a.id));
  const entries = Object.entries(map || {});
  for (const [key, accountId] of entries) {
    if (!known.has(key)) return { error: `Unknown item: ${key}` };
    if (accountId && !accountIds.has(accountId)) return { error: 'Choose an account from the list (active accounts only)' };
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, accountId] of entries) {
      if (!accountId) {
        await client.query('DELETE FROM gl_account_map WHERE property_id = $1 AND map_key = $2', [propertyId, key]);
      } else {
        await client.query(
          `INSERT INTO gl_account_map (property_id, map_key, account_id, updated_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (property_id, map_key) DO UPDATE SET account_id = EXCLUDED.account_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [propertyId, key, accountId, userId || null]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

module.exports = { TYPES, EXTRA_CATEGORIES, EXPENSE_CATEGORIES, listAccounts, loadMapping, createAccount, updateAccount, saveMapping, serviceSplit, saveServiceSplit };
