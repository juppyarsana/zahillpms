const ExcelJS = require('exceljs');

// Excel version of the daily journal (services/journalService.js):
//   Journal        one line per account per entry per day — the sheet to key
//                  into (or import to) the accounting system
//   Account totals the period's movement per account
//   Detail         every posting behind the journal, by room / guest
//   Checks         the journal against the PMS's own figures
// Numbers are real numbers, dates real dates.

const IDR = '#,##0.00';
const DATE = 'dd mmm yyyy';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const xlDate = s => (s ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))) : null);
const longDate = s => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function sheet(wb, name, meta, cols, note) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.addRow([meta.property]).font = { bold: true, size: 14 };
  ws.addRow([`${name} — ${meta.period}`]).font = { bold: true, size: 12 };
  ws.addRow([note || '']).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  ws.addRow([]);
  const h = ws.addRow(cols.map(c => c.header));
  h.font = { bold: true, size: 10 };
  h.eachCell(c => { c.fill = HEAD_FILL; c.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } }; });
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
    if (c.fmt === IDR) h.getCell(i + 1).alignment = { horizontal: 'right' };
  });
  const add = (values, { bold = false, top = false } = {}) => {
    const row = ws.addRow(values);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.fmt && (typeof cell.value === 'number' || cell.value instanceof Date)) cell.numFmt = c.fmt;
      if (top) cell.border = { top: { style: 'thin', color: { argb: 'FF111827' } } };
    });
    if (bold) row.font = { bold: true };
    return row;
  };
  return { ws, add, headerRow: h.number };
}

// 0 shows as an empty cell, so a line reads as either a debit or a credit.
const amt = n => (n ? n : null);

async function buildJournalXlsx(journal, { propertyName } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HALF PMS';
  wb.created = new Date();
  const meta = {
    property: propertyName || 'Property',
    period: journal.from === journal.to ? longDate(journal.from) : `${longDate(journal.from)} – ${longDate(journal.to)}`,
  };

  // ── Journal ──
  const jCols = [
    { header: 'Date', width: 13, fmt: DATE }, { header: 'Entry', width: 12 }, { header: 'Description', width: 42 },
    { header: 'Account', width: 11 }, { header: 'Account name', width: 40 },
    { header: 'Debit (Rp)', width: 18, fmt: IDR }, { header: 'Credit (Rp)', width: 18, fmt: IDR },
  ];
  const j = sheet(wb, 'Journal', meta, jCols, 'Double entry, one entry per kind of transaction per day. Amounts in Rupiah.');
  let rows = 0;
  for (const day of journal.days) {
    day.entries.forEach((e, i) => {
      const no = `${day.date.replace(/-/g, '')}-${String(i + 1).padStart(2, '0')}`;
      for (const l of e.lines) { j.add([xlDate(day.date), no, e.label, l.account_code, l.account_name, amt(l.debit), amt(l.credit)]); rows++; }
    });
  }
  if (!rows) j.add([null, null, 'Nothing to post in this period.']);
  else {
    j.ws.autoFilter = { from: { row: j.headerRow, column: 1 }, to: { row: j.headerRow + rows, column: jCols.length } };
    j.add([null, null, 'Total', null, null, journal.totals.debit, journal.totals.credit], { bold: true, top: true });
  }

  // ── Account totals ──
  const a = sheet(wb, 'Account totals', meta, [
    { header: 'Account', width: 11 }, { header: 'Account name', width: 44 }, { header: 'Kind', width: 12 },
    { header: 'Debit (Rp)', width: 18, fmt: IDR }, { header: 'Credit (Rp)', width: 18, fmt: IDR },
    { header: 'Net debit (Rp)', width: 18, fmt: IDR }, { header: 'Net credit (Rp)', width: 18, fmt: IDR },
  ], 'What the period added to each account (not a balance — opening balances are not in the PMS).');
  for (const r of journal.accounts) a.add([r.account_code, r.account_name, r.type, amt(r.debit), amt(r.credit), amt(r.net_debit), amt(r.net_credit)]);
  a.add(['', 'Total', '', journal.totals.debit, journal.totals.credit,
    journal.accounts.reduce((s, r) => s + r.net_debit, 0), journal.accounts.reduce((s, r) => s + r.net_credit, 0)], { bold: true, top: true });

  // ── Detail ──
  const dCols = [
    { header: 'Date', width: 13, fmt: DATE }, { header: 'Entry', width: 38 }, { header: 'Room · guest', width: 34 }, { header: 'Note', width: 34 },
    { header: 'Account', width: 11 }, { header: 'Account name', width: 38 },
    { header: 'Debit (Rp)', width: 18, fmt: IDR }, { header: 'Credit (Rp)', width: 18, fmt: IDR },
  ];
  const d = sheet(wb, 'Detail', meta, dCols, 'Every posting behind the journal. Filter by room, guest or account.');
  const detail = journal.detail || [];
  for (const p of detail) d.add([xlDate(p.date), p.entry, p.ref, p.memo, p.account_code, p.account_name, amt(p.debit), amt(p.credit)]);
  if (detail.length) d.ws.autoFilter = { from: { row: d.headerRow, column: 1 }, to: { row: d.headerRow + detail.length, column: dCols.length } };

  // ── Checks ──
  const c = sheet(wb, 'Checks', meta, [
    { header: 'Check', width: 46 }, { header: 'Journal (Rp)', width: 18, fmt: IDR }, { header: 'PMS (Rp)', width: 18, fmt: IDR },
    { header: 'Difference (Rp)', width: 18, fmt: IDR }, { header: 'Note', width: 70 },
  ], 'The journal against the PMS\'s own reports for the same period.');
  c.add(['Debits = credits', journal.totals.debit, journal.totals.credit, journal.totals.debit - journal.totals.credit, journal.balanced ? 'Balanced' : 'NOT balanced — tell support']);
  const m = journal.checks.money;
  c.add(['Money received (Daily Close / Cashier Closing)', m.journal, m.pms, m.difference,
    journal.closed_days ? '0, unless a closed day was corrected later — the correction is in the day it was next closed' : 'Should always be 0']);
  for (const r of journal.checks.revenue) {
    c.add([`Revenue — ${r.label} (Reports page)`, r.journal, r.reports, r.difference,
      r.difference ? 'The journal counts what is posted to folios; Reports also count nights of guests not checked in yet' : '']);
  }
  if (journal.unmapped.length) {
    c.add([]);
    c.add(['No account chosen for:'], { bold: true });
    for (const u of journal.unmapped) c.add([u]);
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildJournalXlsx };
