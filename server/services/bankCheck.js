// Bank check (accountant's request, 2026-11): every movement of money in and
// out of each account in the books, line by line, to tick off against the
// bank statement. Read only — nothing is stored.
//
// Money in = exactly the lines of Cashier Closing (so it equals Daily Close /
// Reports → Money; the check line below proves it). Money out = expenses,
// supplier payments and vendor payouts paid with a method, by the day paid.
// The account of a line is the one its payment method maps to in
// Accounting → Accounts (key pay.<method>), so several methods of one bank
// land together as they would on its statement.
// Gross = what the guest paid, fee = the bank's fee on this method (Settings →
// Sources & Payments), net = what the bank pays out, on the expected day.
const db = require('../db');
const accounting = require('./accountingService');
const cashierClosing = require('./cashierClosing');
const { collected } = require('./dailyClose');

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const MAX_DAYS = 62;
const ymd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

function days(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// day + N days; a bank does not pay on Saturday or Sunday, so it moves to Monday
function settleOn(day, n) {
  if (!n) return day;
  let s = addDays(day, n);
  const dow = new Date(s + 'T00:00:00Z').getUTCDay();
  if (dow === 6) s = addDays(s, 2); else if (dow === 0) s = addDays(s, 1);
  return s;
}

async function build(propertyId, from, to) {
  const list = days(from, to);
  if (list.length > MAX_DAYS) return { error: 'At most ' + MAX_DAYS + ' days at a time', status: 400 };

  const [mapping, { rows: methods }] = await Promise.all([
    accounting.loadMapping(propertyId),
    db.query('SELECT id, label, fee_percent, settle_days FROM payment_methods WHERE property_id = $1', [propertyId]),
  ]);
  const meth = new Map(methods.map(m => [m.id, m]));
  const accountOf = id => mapping.resolve('pay.' + (id || 'other')).account;

  const lines = [];
  const push = (l, methodId) => {
    const m = meth.get(methodId);
    const acc = accountOf(methodId);
    const gross = round2(l.gross);
    const pct = Number(m && m.fee_percent) || 0;
    const fee = l.kind === 'in' && gross > 0 && pct > 0 ? round2(gross * pct / 100) : 0;
    lines.push({
      ...l, gross, fee, net: round2(gross - fee),
      method: (m && m.label) || l.method || 'Other',
      settle_on: l.kind === 'in' && gross > 0 ? settleOn(l.day, Number(m && m.settle_days) || 0) : l.day,
      account_id: acc ? acc.id : null, account_code: acc ? acc.code : '', account_name: acc ? acc.name : 'No account chosen',
    });
  };

  // money in — Cashier Closing, a few days at a time
  for (let i = 0; i < list.length; i += 4) {
    const chunk = await Promise.all(list.slice(i, i + 4).map(d => cashierClosing.load(propertyId, d)));
    chunk.forEach((c, k) => {
      for (const g of c.groups) {
        if (g.ledger) continue;
        for (const l of g.lines) {
          push({
            day: list[i + k], kind: 'in', what: l.what, reference: l.reference || '', notes: l.notes || '',
            party: [l.room, l.guest].filter(Boolean).join(' · '), user: l.user_name === '—' ? '' : l.user_name,
            time: l.time || '', booking_id: l.booking_id, group_id: l.group_id, event_id: l.event_id, gross: l.amount,
          }, l.method_id);
        }
      }
    });
  }

  // money out
  const P = [propertyId, from, to];
  const [{ rows: exp }, { rows: sup }, { rows: ven }] = await Promise.all([
    db.query(`SELECT e.payment_method AS method, e.amount, e.description, e.reference, s.name AS supplier, to_char(e.incurred_on, 'YYYY-MM-DD') AS day
              FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
              WHERE e.property_id = $1 AND e.is_voided = false AND e.incurred_on BETWEEN $2::date AND $3::date`, P),
    db.query(`SELECT p.method, p.amount, p.reference, s.name AS supplier, to_char(p.paid_on, 'YYYY-MM-DD') AS day
              FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
              WHERE p.property_id = $1 AND p.is_voided = false AND p.paid_on BETWEEN $2::date AND $3::date`, P),
    db.query(`SELECT p.method, p.amount, p.reference, p.payout_no, s.name AS supplier, to_char(p.paid_on, 'YYYY-MM-DD') AS day
              FROM vendor_payouts p JOIN suppliers s ON s.id = p.supplier_id
              WHERE p.property_id = $1 AND p.is_voided = false AND p.paid_on BETWEEN $2::date AND $3::date`, P),
  ]);
  const out = (day, what, party, reference, notes, amount, method) =>
    push({ day, kind: 'out', what, reference: reference || '', notes: notes || '', party: party || '', user: '', time: '', gross: -Number(amount) }, method);
  for (const e of exp) out(e.day, 'Expense', e.supplier, e.reference, e.description, e.amount, e.method);
  for (const p of sup) out(p.day, 'Supplier payment', p.supplier, p.reference, '', p.amount, p.method);
  for (const p of ven) out(p.day, 'Vendor payout', p.supplier, p.reference, p.payout_no ? 'VP-' + String(p.payout_no).padStart(4, '0') : '', p.amount, p.method);

  lines.sort((a, b) => a.day.localeCompare(b.day) || (a.time || '99').localeCompare(b.time || '99') || a.method.localeCompare(b.method));

  // per account, per day
  const byAcc = new Map();
  for (const l of lines) {
    const key = l.account_id || 'none';
    let a = byAcc.get(key);
    if (!a) { a = { account_id: l.account_id, code: l.account_code, name: l.account_name, methods: new Set(), lines: [], days: new Map(), in: 0, out: 0, fee: 0, net: 0 }; byAcc.set(key, a); }
    a.methods.add(l.method);
    a.lines.push(l);
    const d = a.days.get(l.day) || { day: l.day, in: 0, out: 0, fee: 0, net: 0 };
    if (l.gross >= 0) { a.in = round2(a.in + l.gross); d.in = round2(d.in + l.gross); } else { a.out = round2(a.out + l.gross); d.out = round2(d.out + l.gross); }
    a.fee = round2(a.fee + l.fee); d.fee = round2(d.fee + l.fee);
    a.net = round2(a.net + l.net); d.net = round2(d.net + l.net);
    a.days.set(l.day, d);
  }
  const accounts = [...byAcc.values()]
    .map(a => ({ ...a, methods: [...a.methods].sort(), days: [...a.days.values()].sort((x, y) => x.day.localeCompare(y.day)) }))
    .sort((a, b) => (a.code || 'zzz').localeCompare(b.code || 'zzz'));

  // proof: money in here = Daily Close's "money received" for the same days
  const inTotal = round2(lines.filter(l => l.kind === 'in').reduce((s, l) => s + l.gross, 0));
  const dc = await collected(propertyId, from, to);
  const sumOf = k => round2(accounts.reduce((s, a) => s + a[k], 0));
  return {
    from, to, accounts,
    totals: { in: sumOf('in'), out: sumOf('out'), fee: sumOf('fee'), net: sumOf('net') },
    check: { money_in: inTotal, daily_close: round2(dc.total), difference: round2(dc.total - inTotal) },
    unmapped: lines.filter(l => !l.account_id).length,
  };
}

async function buildXlsx(d, propertyName) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HALF PMS';
  const IDR = '#,##0;[Red]-#,##0';
  const head = (ws, title, cols) => {
    ws.getCell('A1').value = propertyName + ' · ' + title;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = d.from + ' to ' + d.to + '. Gross = paid by the guest; fee = bank fee on the method; net = what the bank pays out, on the expected date.';
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width || 14;
      if (c.money) col.numFmt = IDR;
      const h = ws.getCell(3, i + 1);
      h.value = c.header; h.font = { bold: true }; h.border = { bottom: { style: 'thin' } };
    });
    ws.views = [{ state: 'frozen', ySplit: 3 }];
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  };
  const bold = r => { r.font = { bold: true }; r.eachCell(c => { c.border = { top: { style: 'thin' } }; }); };

  const sum = wb.addWorksheet('Summary');
  head(sum, 'Bank check — by account', [
    { header: 'Account', width: 34 }, { header: 'Methods', width: 30 }, { header: 'Money in', money: true, width: 16 }, { header: 'Money out', money: true, width: 16 },
    { header: 'Bank fees', money: true, width: 14 }, { header: 'Net', money: true, width: 16 },
  ]);
  for (const a of d.accounts) sum.addRow([(a.code + ' ' + a.name).trim(), a.methods.join(', '), a.in, a.out, a.fee, a.net]);
  bold(sum.addRow(['Total', '', d.totals.in, d.totals.out, d.totals.fee, d.totals.net]));
  sum.addRow([]);
  sum.addRow(['Money in here', '', d.check.money_in]);
  sum.addRow(['Daily Close, money received', '', d.check.daily_close]);
  sum.addRow(['Difference (should be 0)', '', d.check.difference]);

  const used = new Set(['Summary']);
  for (const a of d.accounts) {
    let name = (a.code + ' ' + a.name).trim().replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Account';
    let n = 2; const base = name; while (used.has(name)) name = base.slice(0, 26) + ' ' + (n++);
    used.add(name);
    const ws = wb.addWorksheet(name);
    const cols = [
      { header: 'Date', width: 12 }, { header: 'Bank pays on', width: 13 }, { header: 'In / out', width: 8 }, { header: 'What', width: 16 }, { header: 'Method', width: 16 },
      { header: 'Room / guest / supplier', width: 34 }, { header: 'Reference', width: 22 }, { header: 'Notes', width: 28 }, { header: 'Taken by', width: 16 },
      { header: 'Gross', money: true, width: 15 }, { header: 'Fee', money: true, width: 12 }, { header: 'Net', money: true, width: 15 }, { header: 'On statement ✓', width: 14 },
    ];
    head(ws, (a.code + ' ' + a.name).trim(), cols);
    let day = null, sub = [0, 0, 0];
    const flush = () => { if (day) { const r = ws.addRow(['', '', '', '', '', 'Total ' + day, '', '', '', ...sub]); r.font = { bold: true, italic: true }; ws.addRow([]); } };
    for (const l of a.lines) {
      if (l.day !== day) { flush(); day = l.day; sub = [0, 0, 0]; }
      ws.addRow([l.day, l.settle_on, l.kind === 'in' ? 'In' : 'Out', l.what, l.method, l.party, l.reference, l.notes, l.user, l.gross, l.fee, l.net]);
      sub = [round2(sub[0] + l.gross), round2(sub[1] + l.fee), round2(sub[2] + l.net)];
    }
    flush();
    bold(ws.addRow(['', '', '', '', '', 'Period total', '', '', '', round2(a.in + a.out), a.fee, a.net]));
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { build, buildXlsx, MAX_DAYS };
