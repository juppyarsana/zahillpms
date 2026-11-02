// A purchase order's papers (migration 151): the PO for the supplier (with
// prices), how it gets to them (email with the PDF attached, or a link for
// WhatsApp), and the receiving checklist (no prices) for checking a delivery.
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const db = require('../db');
const { drawDocumentHeader } = require('./pdfHeader');
const { resolveSmtp } = require('./mailer');
const { BIG, qtyParts, lineAmount } = require('./poFormat');
const { logEvent } = require('./purchasingService');

const SEND_STATUSES = ['approved', 'received', 'closed'];
const LINK_DAYS = 90;
const fail = (status, error, code) => ({ status, error, code });
const idr = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const dayText = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const isEmail = s => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);

async function load(propertyId, poId) {
  const { rows: [po] } = await db.query(
    `SELECT po.*, s.name AS supplier_name, s.contact_name, s.contact_phone, s.contact_email, s.address AS supplier_address, s.payment_terms_days,
            COALESCE(po.approved_by_name, au.name) AS approver_name,
            to_char(COALESCE(po.approved_at, po.updated_at) AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS po_date,
            (SELECT to_char(MIN(r.needed_by), 'YYYY-MM-DD') FROM purchase_order_items i
             JOIN purchase_request_lines l ON l.id = i.request_line_id JOIN purchase_requests r ON r.id = l.request_id
             WHERE i.purchase_order_id = po.id) AS needed_by,
            ps.property_name, ps.property_address, ps.property_phone, ps.property_email, ps.logo_url,
            ps.smtp_host, ps.smtp_port, ps.smtp_user, ps.smtp_password, ps.smtp_from
     FROM purchase_orders po
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN users au ON au.id = po.approved_by
     LEFT JOIN property_settings ps ON ps.property_id = po.property_id
     WHERE po.id = $1 AND po.property_id = $2`, [poId, propertyId]);
  if (!po) return null;
  const { rows: items } = await db.query(
    `SELECT i.*, COALESCE(rm.unit_of_measure, i.unit, CASE WHEN i.product_id IS NOT NULL THEN 'pcs' END) AS unit_text, pr.section
     FROM purchase_order_items i
     LEFT JOIN raw_materials rm ON rm.id = i.raw_material_id
     LEFT JOIN purchase_request_lines prl ON prl.id = i.request_line_id
     LEFT JOIN purchase_requests pr ON pr.id = prl.request_id
     WHERE i.purchase_order_id = $1 ORDER BY i.description`, [poId]);
  return { ...po, items };
}

const collect = doc => new Promise(resolve => {
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
});

function pageNumbers(doc, label) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
      .text(`${label} · page ${i + 1} of ${pages.count}`, 50, doc.page.height - 30, { width: 495, align: 'center', lineBreak: false });
  }
}

// One row of columns [text, x, width, align?]; returns its height.
function drawRow(doc, cols, y, { bold = false, size = 9.5, color = '#111827' } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  let h = 0;
  for (const [text, x, w] of cols) h = Math.max(h, doc.heightOfString(String(text ?? ''), { width: w }));
  for (const [text, x, w, align] of cols) doc.text(String(text ?? ''), x, y, { width: w, align: align || 'left' });
  return h;
}

function rule(doc, y, color = '#d1d5db') {
  doc.moveTo(50, y).lineTo(545, y).strokeColor(color).lineWidth(0.5).stroke();
}

// ── The PO for the supplier ──
function renderPo(po) {
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  const done = collect(doc);
  drawDocumentHeader(doc, po, {
    title: 'PURCHASE ORDER',
    refLine: 'Pesanan Pembelian',
    extraLines: [po.po_number, `Date / Tanggal: ${dayText(po.po_date)}`],
    dateLine: null,
  });
  doc.moveDown(1);

  const blockY = doc.y;
  const block = (x, title, lines) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b7280').text(title, x, blockY, { width: 235 });
    doc.font('Helvetica').fontSize(9.5).fillColor('#111827');
    lines.filter(Boolean).forEach((l, i) => doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').text(l, x, doc.y, { width: 235 }));
    return doc.y;
  };
  const a = block(50, 'SUPPLIER / PEMASOK', [po.supplier_name, po.contact_name, po.contact_phone, po.contact_email, po.supplier_address]);
  const b = block(310, 'DELIVER TO / KIRIM KE', [po.property_name, po.property_address, po.property_phone]);
  doc.y = Math.max(a, b) + 10;

  const terms = po.payment_terms_days > 0 ? `${po.payment_terms_days} days / ${po.payment_terms_days} hari` : 'Cash / Tunai';
  doc.font('Helvetica').fontSize(9.5).fillColor('#111827');
  doc.text(`Payment terms / Pembayaran: ${terms}`, 50, doc.y, { width: 495 });
  if (po.needed_by) doc.text(`Needed by / Dibutuhkan: ${dayText(po.needed_by)}`, 50, doc.y, { width: 495 });
  doc.moveDown(0.8);

  const C = { no: [50, 22], item: [74, 195], qty: [271, 45], unit: [318, 40], price: [360, 90], amount: [452, 93] };
  const head = () => {
    const y = doc.y;
    const h = drawRow(doc, [
      ['No', ...C.no], ['Item / Barang', ...C.item], ['Qty', ...C.qty, 'right'], ['Unit', ...C.unit],
      ['Unit price / Harga', ...C.price, 'right'], ['Amount / Jumlah', ...C.amount, 'right'],
    ], y, { bold: true, size: 8, color: '#6b7280' });
    rule(doc, y + h + 2);
    doc.y = y + h + 6;
  };
  head();
  po.items.forEach((it, k) => {
    if (doc.y > 730) { doc.addPage(); head(); }
    const [q, u] = qtyParts(it.quantity, it.unit_text);
    const amount = lineAmount(it);
    const per = Number(it.quantity) > 0 ? amount / Number(it.quantity) : 0;
    const big = BIG[it.unit_text];
    const price = big ? `${idr(Math.round(per * big[1] * 100) / 100)}/${big[0]}` : idr(Math.round(per * 100) / 100);
    const y = doc.y;
    const h = drawRow(doc, [
      [k + 1, ...C.no], [it.description, ...C.item], [q, ...C.qty, 'right'], [u, ...C.unit],
      [price, ...C.price, 'right'], [idr(amount), ...C.amount, 'right'],
    ], y);
    rule(doc, y + h + 2, '#f3f4f6');
    doc.y = y + h + 6;
  });
  doc.moveDown(0.3);
  const ty = doc.y;
  drawRow(doc, [['TOTAL', 300, 140, 'right'], [idr(po.total_amount), 442, 103, 'right']], ty, { bold: true, size: 11 });
  doc.y = ty + 22;

  if (po.notes) doc.font('Helvetica').fontSize(9.5).fillColor('#111827').text(`Notes / Catatan: ${po.notes}`, 50, doc.y, { width: 495 }).moveDown(0.5);
  if (po.approver_name) doc.font('Helvetica').fontSize(9.5).text(`Approved by / Disetujui oleh: ${po.approver_name}`, 50, doc.y, { width: 495 }).moveDown(0.5);
  doc.font('Helvetica-Oblique').fontSize(9).fillColor('#374151')
    .text('Please put this PO number on your delivery note (surat jalan) and invoice.', 50, doc.y, { width: 495 })
    .text('Mohon cantumkan nomor PO ini di surat jalan dan invoice.', 50, doc.y, { width: 495 });

  pageNumbers(doc, po.po_number);
  doc.end();
  return done;
}

function renderCancelled(po) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const done = collect(doc);
  drawDocumentHeader(doc, po, { title: 'PURCHASE ORDER', refLine: po.po_number, dateLine: null });
  doc.moveDown(3);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#b91c1c').text('This purchase order was cancelled', 50, doc.y, { width: 495, align: 'center' });
  doc.moveDown(0.3).fontSize(13).text('Pesanan pembelian ini dibatalkan', { width: 495, align: 'center' });
  doc.moveDown(1).font('Helvetica').fontSize(10).fillColor('#374151')
    .text(`Please do not deliver against ${po.po_number}. Contact ${po.property_name || 'the hotel'}${po.property_phone ? ` (${po.property_phone})` : ''} with any question.`, 50, doc.y, { width: 495, align: 'center' });
  doc.end();
  return done;
}

async function checkSendable(propertyId, poId) {
  const po = await load(propertyId, poId);
  if (!po) return { fail: fail(404, 'Purchase order not found') };
  if (po.is_direct) return { fail: fail(409, 'This was bought without a PO', 'DIRECT_PURCHASE') };
  if (!SEND_STATUSES.includes(po.status)) return { fail: fail(409, 'A purchase order can go to the supplier once it is approved', 'NOT_APPROVED') };
  return { po };
}

async function poPdf(propertyId, poId, { logDownloadBy } = {}) {
  const { po, fail: f } = await checkSendable(propertyId, poId);
  if (f) return f;
  const buffer = await renderPo(po);
  if (logDownloadBy) await logEvent(db, poId, 'PDF downloaded', logDownloadBy);
  return { buffer, po_number: po.po_number };
}

async function publicPdf(token) {
  const gone = fail(404, 'This link is not valid. Please ask the hotel for the purchase order again.');
  if (!/^[\w-]{20,64}$/.test(String(token || ''))) return gone;
  const { rows: [row] } = await db.query(
    `SELECT id, property_id, COALESCE(approved_at, updated_at) < NOW() - make_interval(days => $2) AS expired
     FROM purchase_orders WHERE share_token = $1`, [token, LINK_DAYS]);
  if (!row) return gone;
  if (row.expired) return fail(410, 'This link has expired. Please ask the hotel for the purchase order again.');
  const po = await load(row.property_id, row.id);
  if (po.status === 'cancelled') return { buffer: await renderCancelled(po), po_number: po.po_number };
  return { buffer: await renderPo(po), po_number: po.po_number };
}

// First time it goes out; a later send keeps the first date.
const markSent = poId => db.query('UPDATE purchase_orders SET sent_to_supplier_at = COALESCE(sent_to_supplier_at, NOW()) WHERE id = $1', [poId]);

// WhatsApp can't attach a file, so the message carries a link to the PDF.
async function shareLink(propertyId, poId, phone, userId) {
  const { po, fail: f } = await checkSendable(propertyId, poId);
  if (f) return f;
  const base = String(process.env.SERVER_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!base) return fail(409, 'This server has no public address (SERVER_PUBLIC_URL), so a link would not open for the supplier — use Download PDF', 'NO_PUBLIC_URL');
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8) return fail(400, "The supplier's phone number doesn't look right");
  const { rows: [t] } = await db.query(
    `UPDATE purchase_orders SET share_token = COALESCE(share_token, $2) WHERE id = $1 RETURNING share_token`,
    [poId, crypto.randomBytes(32).toString('base64url')]);
  const url = `${base}/api/public/po/${t.share_token}`;
  const message = [
    `Selamat siang${po.contact_name ? ` ${po.contact_name}` : ''},`,
    '',
    `Berikut PO ${po.po_number} dari ${po.property_name || 'hotel kami'} — total ${idr(po.total_amount)}:`,
    url,
    '',
    'Mohon cantumkan nomor PO di surat jalan dan invoice. Terima kasih.',
  ].join('\n');
  await logEvent(db, poId, `WhatsApp opened for +${digits}`, userId);
  await markSent(poId);
  return { url, message };
}

async function sendEmail(propertyId, poId, body, userId) {
  const { po, fail: f } = await checkSendable(propertyId, poId);
  if (f) return f;
  const to = String(body.to || '').trim();
  const cc = String(body.cc || '').trim();
  if (!isEmail(to)) return fail(400, "The supplier's email address doesn't look right");
  if (cc && !isEmail(cc)) return fail(400, "The CC address doesn't look right");
  const smtp = resolveSmtp(po);
  if (!smtp) return fail(409, 'No email account is set up for this property (Settings → Email & Messages)', 'NO_SMTP');
  const subject = String(body.subject || '').trim().slice(0, 200) || `Purchase Order ${po.po_number} — ${po.property_name || ''}`;
  const buffer = await renderPo(po);
  try {
    await nodemailer.createTransport(smtp.transportConfig).sendMail({
      from: smtp.from, to, cc: cc || undefined, replyTo: po.property_email || undefined, subject,
      text: String(body.message || '').slice(0, 5000),
      attachments: [{ filename: `${po.po_number}.pdf`, content: buffer, contentType: 'application/pdf' }],
    });
  } catch (err) {
    console.error('[PO email]', err.message);
    return fail(502, `The email was not sent: ${err.message}`, 'SEND_FAILED');
  }
  if (body.save_to_supplier && po.supplier_id && to !== po.contact_email) {
    await db.query('UPDATE suppliers SET contact_email = $1 WHERE id = $2 AND property_id = $3', [to, po.supplier_id, propertyId]);
  }
  await logEvent(db, poId, `Sent to supplier by email to ${to}${cc ? ` (cc ${cc})` : ''}`, userId);
  await markSent(poId);
  return { ok: true };
}

// ── The receiving checklist: no prices, what is still to come ──
const GROUP_ORDER = ['Hotel stock', 'Not kept in stock', 'Restaurant — For Kitchen', 'Restaurant — For Resto', 'Restaurant'];
function groupOf(it) {
  if (it.pos_item_id) return it.section === 'kitchen' ? 'Restaurant — For Kitchen' : it.section === 'resto' ? 'Restaurant — For Resto' : 'Restaurant';
  return it.product_id || it.raw_material_id ? 'Hotel stock' : 'Not kept in stock';
}

function renderChecklist(po) {
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  const done = collect(doc);
  drawDocumentHeader(doc, po, {
    title: 'Receiving checklist',
    refLine: po.po_number,
    extraLines: [po.supplier_name, po.po_date ? `Approved ${dayText(po.po_date)}` : null].filter(Boolean),
    dateLine: `Printed ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
  });
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(10).fillColor('#111827')
    .text('Date received: ____________________     Surat jalan no.: ____________________', 50, doc.y, { width: 495 });
  doc.moveDown(0.8);

  const left = i => Number(i.quantity) - Number(i.received_quantity) - Number(i.short_qty);
  const open = po.items.filter(i => left(i) > 0.0005);
  const groups = new Map(GROUP_ORDER.map(g => [g, []]));
  for (const it of open) groups.get(groupOf(it)).push(it);

  const C = { no: [54, 18], item: [74, 150], unit: [226, 28], come: [256, 54], got: [316, 60], ok: [382, 84], note: [472, 73] };
  // A shaded band, each heading over its own column or box.
  const head = () => {
    const y = doc.y, H = 26;
    doc.rect(50, y, 495, H).fill('#E5E7EB');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827');
    const label = (text, [x, w], align, at = y + 9) => doc.text(text, x, at, { width: w, align, lineBreak: false });
    label('No', C.no, 'left');
    label('Item', C.item, 'left');
    label('Unit', C.unit, 'left');
    label('Still to come', C.come, 'right');
    label('Qty received', C.got, 'center');
    label('Condition', C.ok, 'center', y + 5);
    label('Note', C.note, 'center');
    doc.font('Helvetica').fontSize(6.5);
    label('OK / Damaged / Wrong', C.ok, 'center', y + 15);
    doc.y = y + H + 6;
  };
  let n = 0;
  for (const [name, lines] of groups) {
    if (!lines.length) continue;
    if (doc.y > 700) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111827').text(name, 50, doc.y, { width: 495 });
    doc.moveDown(0.3);
    head();
    for (const it of lines) {
      if (doc.y > 740) { doc.addPage(); head(); }
      const [q, u] = qtyParts(left(it), it.unit_text);
      const y = doc.y;
      const h = Math.max(18, drawRow(doc, [[++n, ...C.no], [it.description, ...C.item], [u, ...C.unit], [q, ...C.come, 'right']], y));
      doc.rect(C.got[0], y - 2, C.got[1], 15).rect(C.ok[0], y - 2, C.ok[1], 15).rect(C.note[0], y - 2, C.note[1], 15)
        .strokeColor('#9ca3af').lineWidth(0.5).stroke();
      doc.y = y + h + 4;
    }
    doc.moveDown(0.6);
  }
  const already = po.items.length - open.length;
  if (already) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6b7280').text(`${already} line${already === 1 ? '' : 's'} already received — not listed.`, 50, doc.y, { width: 495 }).moveDown(0.6);

  const sign = (title, a, b) => {
    if (doc.y > 690) doc.addPage();
    doc.moveDown(0.6);
    if (title) doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(title, 50, doc.y, { width: 495 }).moveDown(0.2);
    const y = doc.y + 4;
    for (const [x, label] of [[50, a], [310, b]]) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(label, x, y, { width: 235 });
      doc.font('Helvetica').fontSize(9).text('Name: ______________________________', x, y + 18, { width: 235 });
      doc.text('Signature: ___________________________', x, y + 38, { width: 235 });
    }
    doc.y = y + 58;
  };
  sign(null, 'Received from supplier by', 'Checked by');
  if (open.some(i => i.pos_item_id)) {
    sign('Handed to kitchen / resto', 'Handed over by (purchasing)', 'Received by (chef)');
    doc.font('Helvetica').fontSize(9).fillColor('#111827').text('Date & time: ______________________________', 50, doc.y + 2, { width: 300 });
  }
  pageNumbers(doc, `${po.po_number} checklist`);
  doc.end();
  return done;
}

async function checklistPdf(propertyId, poId) {
  const po = await load(propertyId, poId);
  if (!po) return fail(404, 'Purchase order not found');
  if (po.is_direct || po.status !== 'approved') return fail(409, 'The checklist is for an approved purchase order with goods still to come', 'NOT_APPROVED');
  return { buffer: await renderChecklist(po), po_number: po.po_number };
}

module.exports = { poPdf, publicPdf, shareLink, sendEmail, checklistPdf };
