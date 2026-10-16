// Trial balance (Excel) and balance sheet (Excel + PDF) — the same figures as
// the Accounting page (services/ledgerService.js).
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { drawDocumentHeader } = require('./pdfHeader');

const RP = '#,##0;-#,##0;-';
const KIND = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' };
const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const idr = n => Math.round(Number(n) || 0).toLocaleString('id-ID');

function sheet(wb, title, property, notes, widths) {
  const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.addRow([property.property_name || 'Property']).font = { bold: true, size: 14 };
  ws.addRow([title]).font = { bold: true, size: 12 };
  ws.addRow([notes]).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  ws.addRow([]);
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return ws;
}
function head(ws, cols) {
  const h = ws.addRow(cols);
  h.font = { bold: true, size: 10 };
  h.eachCell((c, i) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
    if (i > 3) c.alignment = { horizontal: 'right' };
  });
}
const money = (row, from) => { for (let i = from; i <= row.cellCount; i++) row.getCell(i).numFmt = RP; };
const topRule = row => row.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin', color: { argb: 'FF111827' } } }; });

async function buildTrialBalanceXlsx(tb, property) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HALF PMS';
  const ws = sheet(wb, `Trial balance — ${fmtDate(tb.from)} to ${fmtDate(tb.to)}`, property,
    `Books start ${fmtDate(tb.books_start)}. Revenue and expense accounts start each year at zero; earlier years' profit is shown under equity.${tb.balanced ? '' : ' NOT BALANCED — tell support.'}`,
    [9, 42, 11, 16, 16, 16, 16, 16, 16]);
  head(ws, ['Code', 'Account', 'Kind', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr']);
  for (const r of tb.rows) {
    const row = ws.addRow([r.code, r.name, KIND[r.type] || '', r.opening.debit, r.opening.credit, r.debit, r.credit, r.closing.debit, r.closing.credit]);
    money(row, 4);
    if (r.virtual) row.font = { italic: true };
  }
  const t = tb.totals;
  const tot = ws.addRow(['', 'Total', '', t.opening.debit, t.opening.credit, t.debit, t.credit, t.closing.debit, t.closing.credit]);
  money(tot, 4); tot.font = { bold: true }; topRule(tot);
  return wb.xlsx.writeBuffer();
}

// Balance sheet rows: [{ kind: heading | line | total | grand, label, amount }]
function bsRows(bs) {
  const rows = [];
  const part = (title, list, totalLabel, total) => {
    rows.push({ kind: 'heading', label: title });
    for (const r of list) rows.push({ kind: 'line', label: r.code ? `${r.code} · ${r.name}` : r.name, amount: r.amount, virtual: r.virtual });
    if (!list.length) rows.push({ kind: 'line', label: 'Nothing', amount: 0 });
    rows.push({ kind: 'total', label: totalLabel, amount: total });
  };
  part('Assets', bs.assets, 'Total assets', bs.totals.assets);
  part('Liabilities', bs.liabilities, 'Total liabilities', bs.totals.liabilities);
  part('Equity', bs.equity, 'Total equity', bs.totals.equity);
  rows.push({ kind: 'grand', label: 'Total liabilities & equity', amount: bs.totals.liabilities_equity });
  return rows;
}
const bsNote = bs => `At the end of ${fmtDate(bs.date)}. Books start ${fmtDate(bs.books_start)}.`
  + (bs.closed_through ? ` Closed through ${fmtDate(bs.closed_through)}.` : ' No day closed yet.')
  + (bs.balanced ? '' : ` NOT BALANCED by Rp ${idr(bs.totals.difference)} — ${bs.unmapped.length ? 'some amounts have no account' : 'tell support'}.`);

async function buildBalanceSheetXlsx(bs, property) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HALF PMS';
  const ws = sheet(wb, `Balance sheet — ${fmtDate(bs.date)}`, property, bsNote(bs), [56, 20]);
  for (const r of bsRows(bs)) {
    if (r.kind === 'heading') { ws.addRow([]); ws.addRow([r.label.toUpperCase()]).font = { bold: true }; continue; }
    const row = ws.addRow([r.label, r.amount]);
    money(row, 2);
    if (r.kind === 'line') { row.getCell(1).alignment = { indent: 1 }; if (r.virtual) row.font = { italic: true }; }
    else { row.font = { bold: true }; topRule(row); }
  }
  return wb.xlsx.writeBuffer();
}

function buildBalanceSheetPdf(bs, property) {
  return new Promise((resolve, reject) => {
    const L = 45, R = 550, W = R - L, BOTTOM = 790;
    const doc = new PDFDocument({ margin: L, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawDocumentHeader(doc, property, { title: 'Balance Sheet', refLine: `As at ${fmtDate(bs.date)}` });
    doc.font('Helvetica').fontSize(7.5).fillColor('#6B7280').text(`Amounts in Rupiah. ${bsNote(bs)}`, L, doc.y + 2, { width: W });
    doc.y += 10;
    for (const r of bsRows(bs)) {
      if (doc.y > BOTTOM - 30) { doc.addPage(); doc.y = 45; }
      if (r.kind === 'heading') {
        doc.y += 8;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(r.label.toUpperCase(), L, doc.y);
        doc.y += 4;
        continue;
      }
      const y = doc.y, bold = r.kind !== 'line';
      if (r.kind === 'grand') doc.rect(L, y - 3, W, 17).fill('#FDF2F2');
      if (bold) doc.moveTo(L, y - 3).lineTo(R, y - 3).lineWidth(0.7).strokeColor('#111827').stroke();
      doc.font(bold ? 'Helvetica-Bold' : (r.virtual ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(9).fillColor('#111827');
      doc.text(r.label, L + (bold ? 2 : 12), y, { width: W * 0.7 });
      doc.text(idr(r.amount), L + W * 0.7, y, { width: W * 0.3 - 2, align: 'right' });
      doc.y = Math.max(doc.y, y + 14) + (bold ? 4 : 0);
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF')
        .text(`${property.property_name || ''} · Balance sheet ${fmtDate(bs.date)} · printed ${new Date().toLocaleDateString('en-GB')} · page ${i + 1} of ${range.count}`,
          L, 815, { width: W, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

module.exports = { buildTrialBalanceXlsx, buildBalanceSheetXlsx, buildBalanceSheetPdf };
