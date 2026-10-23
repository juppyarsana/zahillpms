// Stock (migration 136): the printed stock opname count sheet (PDF) and the
// usage report (Excel).
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const db = require('../db');
const { drawDocumentHeader } = require('./pdfHeader');

const dayText = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const qty = (q, unit) => (q == null ? '' : `${+Number(q).toFixed(3)}${unit ? ' ' + unit : ''}`);

async function property(propertyId) {
  const { rows: [p] } = await db.query(
    `SELECT property_name, property_address, property_phone, property_email, logo_url FROM property_settings WHERE property_id = $1`, [propertyId]);
  return p || {};
}

// The count sheet: grouped by category, a blank box to write what is on the
// shelf. A draft prints blank (so the count isn't steered by what the PMS
// expects); a finished one prints what was counted and the difference.
async function stockSheetPdf(propertyId, o) {
  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(r => doc.on('end', r));
  const finished = o.status === 'finished';
  drawDocumentHeader(doc, await property(propertyId), {
    title: 'Stock opname', refLine: `${o.no_text} · ${dayText(o.count_date)}`,
    extraLines: [finished ? `Finished by ${o.finished_by_name || '—'}` : 'Counted by: ____________________'],
  });
  const L = 40, W = 515;
  const cols = finished
    ? [['Item', 0, 230], ['Expected', 230, 85, true], ['Counted', 315, 85, true], ['Difference', 400, 115, true]]
    : [['Item', 0, 300], ['Unit', 300, 60], ['Counted', 360, 155]];
  const head = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b7280');
    const y = doc.y;
    for (const [label, x, w, right] of cols) doc.text(label.toUpperCase(), L + x, y, { width: w, align: right ? 'right' : 'left', lineBreak: false });
    doc.y = y + 13;
    doc.moveTo(L, doc.y - 3).lineTo(L + W, doc.y - 3).strokeColor('#d1d5db').lineWidth(0.5).stroke();
    doc.fillColor('#111827').font('Helvetica').fontSize(9.5);
  };
  doc.moveDown(0.5);
  const groups = new Map();
  for (const l of o.lines) { if (!groups.has(l.category_label)) groups.set(l.category_label, []); groups.get(l.category_label).push(l); }
  for (const [cat, lines] of groups) {
    if (doc.y > 740) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111827').text(cat, L, doc.y);
    doc.moveDown(0.3);
    head();
    for (const l of lines) {
      if (doc.y > 780) { doc.addPage(); head(); }
      const y = doc.y;
      doc.text(l.description, L, y, { width: finished ? 225 : 295, lineBreak: false, ellipsis: true });
      if (finished) {
        doc.text(qty(l.expected, l.unit), L + 230, y, { width: 85, align: 'right', lineBreak: false });
        doc.text(l.counted == null ? 'not counted' : qty(l.counted, l.unit), L + 315, y, { width: 85, align: 'right', lineBreak: false });
        const d = l.difference;
        doc.fillColor(d < 0 ? '#b91c1c' : d > 0 ? '#15803d' : '#111827')
          .text(d ? `${d > 0 ? '+' : ''}${qty(d, l.unit)}` : (l.counted == null ? '' : '—'), L + 400, y, { width: 115, align: 'right', lineBreak: false })
          .fillColor('#111827');
      } else {
        doc.text(l.unit || '', L + 300, y, { width: 60, lineBreak: false });
        doc.rect(L + 362, y - 3, 150, 15).strokeColor('#9ca3af').lineWidth(0.6).stroke();
      }
      doc.y = y + 19;
    }
    doc.moveDown(0.6);
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af')
      .text(`${o.no_text} · page ${i + 1} of ${pages.count}`, L, doc.page.height - 28, { width: W, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

async function usageXlsx(propertyId, u) {
  const p = await property(propertyId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Usage', { views: [{ state: 'frozen', ySplit: 4, xSplit: 1 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.addRow([`${p.property_name || ''} — stock usage`]).font = { bold: true, size: 14 };
  ws.addRow([`${u.from.no_text} (${dayText(u.from.count_date)}) → ${u.to ? `${u.to.no_text} (${dayText(u.to.count_date)})` : 'now'} · used = opening + bought − closing, valued at average cost`]);
  ws.addRow([]);
  const head = ['Item', 'Kind', 'Category', 'Unit', 'Opening', 'Bought', 'Sold', 'Used (not sold)', 'Waste', 'Corrections', 'Opname difference', 'Closing', 'Used in total', 'Average cost', 'Used — value', 'Waste — value', 'Opname — value', 'Closing — value'];
  const h = ws.addRow(head);
  h.font = { bold: true };
  h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
  for (const r of u.rows) {
    ws.addRow([r.name, r.kind_label, r.category_label, r.unit, r.opening, r.bought, r.sold, r.used, r.waste, r.correction, r.opname, r.closing,
      r.used_total, r.avg_cost, r.value.used_total, r.value.waste, r.value.opname, r.value.closing]);
  }
  ws.addRow([]);
  const t = ws.addRow(['Total', '', '', '', '', '', '', '', '', '', '', '', '', '', u.totals.used_total, u.totals.waste, u.totals.opname, u.totals.closing]);
  t.font = { bold: true };
  ws.addRow([]);
  ws.addRow(['By category']).font = { bold: true };
  const ch = ws.addRow(['Category', 'Items', '', '', '', '', '', '', '', '', '', '', '', '', 'Used — value', 'Waste — value', 'Opname — value', 'Closing — value']);
  ch.font = { bold: true };
  for (const c of u.categories) ws.addRow([c.category_label, c.items, '', '', '', '', '', '', '', '', '', '', '', '', c.used_total, c.waste, c.opname, c.closing]);
  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 30 : i < 4 ? 16 : 13;
    if (i >= 4 && i <= 12) col.numFmt = '#,##0.###';
    if (i >= 13) col.numFmt = '"Rp" #,##0';
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: head.length } };
  return wb.xlsx.writeBuffer();
}

module.exports = { stockSheetPdf, usageXlsx };
