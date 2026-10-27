// Costs by department (Insights → Costs) as Excel: the same figures as the
// page (costsService.buildCosts) — departments, categories per department,
// and every entry — for the accountant or the owner's own files.
const ExcelJS = require('exceljs');
const db = require('../db');

const RP = '"Rp" #,##0';

async function buildCostsXlsx(propertyId, c) {
  const { rows: [p] } = await db.query(
    `SELECT COALESCE(NULLIF(ps.property_name, ''), pr.name) AS name FROM properties pr
     LEFT JOIN property_settings ps ON ps.property_id = pr.id WHERE pr.id = $1`, [propertyId]);
  const wb = new ExcelJS.Workbook();
  const period = `${c.from} to ${c.to}${c.partial ? ' (so far)' : ''}`;
  const sheet = (name, title, columns) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.addRow([`${p?.name || ''} — ${title}`]).font = { bold: true, size: 13 };
    ws.addRow([`${period} · compared with ${c.prev.from} to ${c.prev.to} · Expenses + supplier bills, by department (salaries and journal entries not included)`]).font = { color: { argb: 'FF6B7280' } };
    ws.addRow([]);
    const head = ws.addRow(columns.map(x => x[0]));
    head.font = { bold: true };
    columns.forEach(([, width, fmt], i) => { const col = ws.getColumn(i + 1); col.width = width; if (fmt) col.numFmt = fmt; });
    return ws;
  };

  const d = sheet('Departments', 'Costs by department', [['Department', 30], ['Amount', 18, RP], ['Before', 18, RP], ['Change', 18, RP], ['Change %', 11, '0%'], ['Share', 9, '0%'], ['Entries', 9]]);
  for (const x of c.departments) {
    d.addRow([x.label, x.amount, x.before, x.change_amount, x.change == null ? null : x.change / 100, x.share / 100, x.entries]);
  }
  const t = d.addRow(['Total', c.total, c.before, c.change_amount, c.change == null ? null : c.change / 100, 1, c.entries_count]);
  t.font = { bold: true };

  const k = sheet('By category', 'Costs by department and category', [['Department', 30], ['Category', 38], ['Amount', 18, RP], ['Before', 18, RP], ['Change', 18, RP], ['Entries', 9]]);
  for (const x of c.departments) for (const cat of x.categories) k.addRow([x.label, cat.label, cat.amount, cat.before, cat.change_amount, cat.entries]);

  const labels = Object.fromEntries(c.departments.map(x => [x.department, x.label]));
  const e = sheet('Entries', 'Every cost entry', [['Date', 12], ['Kind', 10], ['Bill no.', 12], ['Department', 26], ['Category', 32], ['Supplier', 26], ['Reference', 18], ['What', 44], ['Amount', 18, RP]]);
  for (const x of [...c.entries].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : b.amount - a.amount))) {
    e.addRow([x.day, x.kind === 'bill' ? 'Bill' : 'Expense', x.bill_no || '', labels[x.department] || x.department, x.category_label, x.supplier, x.reference, x.text, x.amount]);
  }
  e.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 9 } };
  return wb.xlsx.writeBuffer();
}

module.exports = { buildCostsXlsx };
