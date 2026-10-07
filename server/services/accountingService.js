// Accounting, step 1 (migration 101): the chart of accounts and which account
// each kind of amount goes to. The journal (journalService.js) asks
// loadMapping() for the account behind a key such as 'revenue.room'.
const db = require('../db');

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// The standard chart a property starts with. Codes can be changed afterwards;
// `key` ties a mapping key to its starting account.
const DEFAULT_CHART = [
  ['1110', 'Cash on hand', 'asset'],
  ['1120', 'Bank', 'asset'],
  ['1130', 'QRIS — to be settled', 'asset'],
  ['1140', 'Card (EDC) — to be settled', 'asset'],
  ['1150', 'Other receipts — to be settled', 'asset'],
  ['1160', 'Restaurant takings (POS)', 'asset'],
  ['1210', 'Guest ledger', 'asset'],
  ['1220', 'Agent & company receivables', 'asset'],
  ['1230', 'OTA receivables', 'asset'],
  ['2110', 'Advance deposits', 'liability'],
  ['2120', 'Service charge payable', 'liability'],
  ['2130', 'Hotel & restaurant tax payable (PB1)', 'liability'],
  ['2140', 'Agent commission payable', 'liability'],
  ['4110', 'Room revenue', 'revenue'],
  ['4210', 'F&B revenue — meal plans', 'revenue'],
  ['4220', 'F&B revenue — restaurant', 'revenue'],
  ['4310', 'Room add-ons', 'revenue'],
  ['4320', 'Transport', 'revenue'],
  ['4330', 'Laundry', 'revenue'],
  ['4340', 'Services', 'revenue'],
  ['4350', 'Merchandise', 'revenue'],
  ['4360', 'Minibar', 'revenue'],
  ['4390', 'Other revenue', 'revenue'],
  ['4410', 'Activities', 'revenue'],
  ['6110', 'Agent commission', 'expense'],
  ['6210', 'Utilities', 'expense'],
  ['6220', 'Laundry cost', 'expense'],
  ['6230', 'Maintenance', 'expense'],
  ['6240', 'Staff', 'expense'],
  ['6250', 'Supplies', 'expense'],
  ['6260', 'Marketing', 'expense'],
  ['6270', 'Admin & bank fees', 'expense'],
  ['6290', 'Other expenses', 'expense'],
];

// Every fixed mapping key: [key, label, group, starting account code].
const MAP_KEYS = [
  ['revenue.room', 'Room nights', 'Revenue', '4110'],
  ['revenue.fnb_package', 'Meals in the rate plan (breakfast, half / full board, breakfast with an extra bed)', 'Revenue', '4210'],
  ['revenue.fnb_outlet', 'Restaurant & POS food and drinks', 'Revenue', '4220'],
  ['revenue.extra.room_addon', 'Extras — room add-ons (extra bed, early / late check-out)', 'Revenue', '4310'],
  ['revenue.extra.transport', 'Extras — transport', 'Revenue', '4320'],
  ['revenue.extra.laundry', 'Extras — laundry', 'Revenue', '4330'],
  ['revenue.extra.service', 'Extras — services', 'Revenue', '4340'],
  ['revenue.extra.merchandise', 'Extras — merchandise', 'Revenue', '4350'],
  ['revenue.extra.minibar', 'Extras — minibar', 'Revenue', '4360'],
  ['revenue.extra.other', 'Extras — other', 'Revenue', '4390'],
  ['revenue.activities', 'Activities', 'Revenue', '4410'],
  ['tax.service', 'Service charge collected', 'Service charge & tax', '2120'],
  ['tax.pb1', 'Tax collected (PB1)', 'Service charge & tax', '2130'],
  ['ledger.guest', 'Guest ledger — what guests who have arrived owe (or have paid ahead)', 'Guests & agents', '1210'],
  ['ledger.deposits', 'Advance deposits — money received before the guest arrives', 'Guests & agents', '2110'],
  ['ledger.agent', 'Agents & companies — stays billed to them', 'Guests & agents', '1220'],
  ['commission.expense', 'Agent commission (cost)', 'Guests & agents', '6110'],
  ['commission.payable', 'Agent commission still to pay', 'Guests & agents', '2140'],
  ['pos.takings', 'Restaurant bills paid at the restaurant (from the POS sessions)', 'Money received', '1160'],
  ['expense.utilities', 'Utilities', 'Expenses', '6210'],
  ['expense.laundry', 'Laundry', 'Expenses', '6220'],
  ['expense.maintenance', 'Maintenance', 'Expenses', '6230'],
  ['expense.staff', 'Staff', 'Expenses', '6240'],
  ['expense.supplies', 'Supplies', 'Expenses', '6250'],
  ['expense.marketing', 'Marketing', 'Expenses', '6260'],
  ['expense.admin_fees', 'Admin & bank fees', 'Expenses', '6270'],
  ['expense.other', 'Other', 'Expenses', '6290'],
];
const EXTRA_CATEGORIES = ['room_addon', 'transport', 'laundry', 'service', 'merchandise', 'minibar', 'other'];
const EXPENSE_CATEGORIES = ['utilities', 'laundry', 'maintenance', 'staff', 'supplies', 'marketing', 'admin_fees', 'other'];

// A payment method's starting account, guessed from its id / label — so a
// method added later in Settings works without visiting the mapping screen.
function defaultCodeForMethod(id, label) {
  const s = `${id} ${label || ''}`.toLowerCase();
  if (/ota/.test(s)) return '1230';
  if (/cash|tunai/.test(s)) return '1110';
  if (/qris/.test(s)) return '1130';
  if (/card|edc|debit|credit|kartu|visa|master/.test(s)) return '1140';
  if (/bank|transfer|wise|bca|mandiri|bni|bri/.test(s)) return '1120';
  return '1150';
}

// Gives a property the standard chart the first time accounting is opened.
async function ensureChart(propertyId) {
  const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM gl_accounts WHERE property_id = $1', [propertyId]);
  if (c.n > 0) return;
  for (const [code, name, type] of DEFAULT_CHART) {
    await db.query(
      `INSERT INTO gl_accounts (property_id, code, name, type) VALUES ($1, $2, $3, $4)
       ON CONFLICT (property_id, code) DO NOTHING`, [propertyId, code, name, type]);
  }
}

async function listAccounts(propertyId) {
  await ensureChart(propertyId);
  const { rows } = await db.query(
    `SELECT id, code, name, type, is_active FROM gl_accounts WHERE property_id = $1 ORDER BY code`, [propertyId]);
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
    ...methods.map(m => [`pay.${m.id}`, `${m.label}${m.is_active ? '' : ' (inactive)'}`, 'Money received', defaultCodeForMethod(m.id, m.label)]),
    ...MAP_KEYS,
  ].map(([key, label, group, code]) => {
    const chosen = savedBy.has(key) ? byId.get(savedBy.get(key)) : null;
    const account = chosen || byCode.get(code) || null;
    return { key, label, group, account_id: account?.id || null, is_default: !chosen, account };
  });
  const map = new Map(keys.map(k => [k.key, k]));
  return {
    accounts, keys,
    // The account behind a key; an unknown payment method (deleted since)
    // falls back to "other receipts".
    resolve(key) {
      const k = map.get(key);
      if (k) return { key, label: k.label, account: k.account };
      if (key.startsWith('pay.')) return { key, label: key.slice(4), account: byCode.get('1150') || null };
      if (key.startsWith('revenue.extra.')) return { key, label: key, account: map.get('revenue.extra.other')?.account || null };
      if (key.startsWith('expense.')) return { key, label: key, account: map.get('expense.other')?.account || null };
      return { key, label: key, account: null };
    },
  };
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
  if (body.is_active !== undefined) out.is_active = !!body.is_active;
  return { value: out };
}

async function createAccount(propertyId, body) {
  const { value, error } = cleanAccount(body);
  if (error) return { error };
  try {
    const { rows: [a] } = await db.query(
      `INSERT INTO gl_accounts (property_id, code, name, type) VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, type, is_active`, [propertyId, value.code, value.name, value.type]);
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
  try {
    const { rows: [a] } = await db.query(
      `UPDATE gl_accounts SET code = COALESCE($3, code), name = COALESCE($4, name), type = COALESCE($5, type),
              is_active = COALESCE($6, is_active), updated_at = NOW()
       WHERE id = $1 AND property_id = $2 RETURNING id, code, name, type, is_active`,
      [id, propertyId, value.code ?? null, value.name ?? null, value.type ?? null, value.is_active ?? null]);
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

module.exports = { TYPES, EXTRA_CATEGORIES, EXPENSE_CATEGORIES, listAccounts, loadMapping, createAccount, updateAccount, saveMapping };
