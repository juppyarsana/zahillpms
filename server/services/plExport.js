// Profit & Loss as Excel and PDF (services/plService.js): the same rows as
// the Accounting page's P&L tab — each line with the accounts behind it, the
// month, the month before and the year to date, each with its %.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { drawDocumentHeader } = require('./pdfHeader');

const COLS = ['period', 'previous', 'ytd'];
const NOTE = 'Amounts in Rupiah, net of service charge and tax (service charge goes to staff, tax to the government — neither is revenue). '
  + 'Revenue as posted to guests\' bills night by night; costs as entered. % = of total revenue, or of the department\'s own revenue for its expenses and profit.';
const pctText = v => (v == null ? '' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
const idr = n => Math.round(Number(n) || 0).toLocaleString('id-ID');

function notes(pl) {
  const out = [];
  if (pl.columns.period.partial) out.push(`${pl.columns.period.label} is the month so far.`);
  out.push(pl.closed_through
    ? `Days up to ${pl.closed_through} are closed; later days can still change.`
    : 'No day is closed yet — every figure can still change when something is corrected.');
  if (pl.unmapped.length) out.push(`No account chosen for: ${pl.unmapped.join('; ')}.`);
  return out;
}

// ── Excel ──
async function buildPlXlsx(pl, property) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HALF PMS';
  wb.created = new Date();
  const ws = wb.addWorksheet('Profit & Loss', {
    views: [{ state: 'frozen', ySplit: 6 }],
    properties: { outlineProperties: { summaryBelow: false } },
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const c = pl.columns;
  ws.addRow([property.property_name || 'Property']).font = { bold: true, size: 14 };
  ws.addRow([`Profit & Loss — ${c.period.label}`]).font = { bold: true, size: 12 };
  ws.addRow([NOTE]).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  ws.addRow([notes(pl).join(' ')]).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  ws.addRow([]);
  const h = ws.addRow(['', c.period.label, '%', c.previous.label, '%', c.ytd.label, '%']);
  h.font = { bold: true, size: 10 };
  h.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.alignment = { horizontal: 'right', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
  });
  [46, 17, 8, 17, 8, 17, 8].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const values = (amounts, pct) => COLS.flatMap(k => [Math.round(amounts[k] * 100) / 100, pct && pct[k] != null ? pct[k] / 100 : null]);
  const style = (row, { bold = false, top = false, fill = null, grey = false } = {}) => {
    for (let i = 2; i <= 7; i++) row.getCell(i).numFmt = i % 2 === 0 ? '#,##0;-#,##0;-' : '0.0%';
    row.font = { bold, size: grey ? 9 : 10, color: grey ? { argb: 'FF6B7280' } : undefined };
    if (top || fill) row.eachCell({ includeEmpty: true }, cell => {
      if (top) cell.border = { top: { style: 'thin', color: { argb: 'FF111827' } } };
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
  };
  for (const r of pl.rows) {
    if (r.kind === 'heading') {
      ws.addRow([]);
      ws.addRow([r.label.toUpperCase()]).font = { bold: true, size: 10 };
      continue;
    }
    const row = ws.addRow([r.label, ...values(r.amounts, r.pct)]);
    if (r.kind === 'line') row.getCell(1).alignment = { indent: 1 };
    style(row, { bold: r.kind !== 'line', top: r.kind !== 'line', fill: r.kind === 'grand' ? 'FFFDF2F2' : null });
    for (const a of r.accounts || []) {
      const ar = ws.addRow([`${a.code} · ${a.name}`, ...values(a.amounts, null)]);
      ar.getCell(1).alignment = { indent: 3 };
      ar.outlineLevel = 1;
      style(ar, { grey: true });
    }
  }
  if (pl.off_pl.length) {
    ws.addRow([]);
    ws.addRow(['NOT ON THE P&L (accounts set to "Not on the P&L")']).font = { bold: true, size: 10 };
    for (const a of pl.off_pl) style(ws.addRow([`${a.code} · ${a.name}`, ...values(a.amounts, null)]), { grey: true });
  }
  return wb.xlsx.writeBuffer();
}

// ── PDF ──
const L = 45, R = 550, W = R - L, BOTTOM = 790;
// Label 34%, then per column an amount (15%) and its % (7%).
const LABEL_W = 0.34 * W;
const X = { cols: [0, 1, 2].map(i => [L + LABEL_W + i * 0.22 * W, 0.15 * W]), pctW: 0.07 * W };

function buildPlPdf(pl, property) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: L, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', ch => chunks.push(ch));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const c = pl.columns;

    drawDocumentHeader(doc, property, { title: 'Profit & Loss', refLine: c.period.label });
    doc.font('Helvetica').fontSize(7.5).fillColor('#6B7280').text([NOTE, ...notes(pl)].join(' '), L, doc.y + 2, { width: W });
    doc.y += 8;

    const colHead = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#6B7280');
      [c.period.label, c.previous.label, c.ytd.label].forEach((t, i) => {
        const [x, w] = X.cols[i];
        doc.text(t, x, y, { width: w + X.pctW - 2, align: 'right' });
        doc.font('Helvetica').fontSize(7).text('Rp · %', x, y + 10, { width: w + X.pctW - 2, align: 'right' });
        doc.font('Helvetica-Bold').fontSize(8);
      });
      doc.y = y + 22;
      doc.moveTo(L, doc.y - 4).lineTo(R, doc.y - 4).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
    };
    const ensure = h => { if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = 45; colHead(); } };
    const row = (label, amounts, pct, { bold = false, grey = false, indent = 0, rule = false, fill = null } = {}) => {
      const size = grey ? 7.5 : 9;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      const h = Math.max(doc.heightOfString(label, { width: LABEL_W - 8 - indent }), size) + 5;
      ensure(h);
      const y = doc.y;
      if (fill) doc.rect(L, y - 2, W, h + 1).fill(fill);
      if (rule) doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.7).strokeColor('#111827').stroke();
      doc.fillColor(grey ? '#6B7280' : '#111827').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      doc.text(label, L + 2 + indent, y, { width: LABEL_W - 8 - indent });
      COLS.forEach((k, i) => {
        const [x, w] = X.cols[i];
        doc.text(idr(amounts[k]), x, y, { width: w - 2, align: 'right', lineBreak: false });
        if (pct) doc.text(pctText(pct[k]), x + w, y, { width: X.pctW - 2, align: 'right', lineBreak: false });
      });
      doc.y = y + h;
    };

    colHead();
    for (const r of pl.rows) {
      if (r.kind === 'heading') {
        ensure(40);
        doc.y += 6;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(r.label.toUpperCase(), L + 2, doc.y);
        doc.y += 3;
        continue;
      }
      row(r.label, r.amounts, r.pct, { bold: r.kind !== 'line', indent: r.kind === 'line' ? 8 : 0, rule: r.kind !== 'line', fill: r.kind === 'grand' ? '#FDF2F2' : null });
      for (const a of r.accounts || []) row(`${a.code} · ${a.name}`, a.amounts, null, { grey: true, indent: 20 });
      if (r.kind !== 'line') doc.y += 3;
    }
    if (pl.off_pl.length) {
      ensure(40);
      doc.y += 8;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text('NOT ON THE P&L', L + 2, doc.y);
      doc.y += 3;
      for (const a of pl.off_pl) row(`${a.code} · ${a.name}`, a.amounts, null, { grey: true, indent: 8 });
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF')
        .text(`${property.property_name || ''} · Profit & Loss ${c.period.label} · printed ${new Date().toLocaleDateString('en-GB')} · page ${i + 1} of ${range.count}`,
          L, 815, { width: W, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

module.exports = { buildPlXlsx, buildPlPdf };
