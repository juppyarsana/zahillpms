// The foot of the pro forma invoice (migration 092): payment terms, the bank
// account to transfer to and the signature lines — each property's own,
// set in Property Details. Nothing set = nothing printed.
const db = require('../db');

const clip = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, n);

// Whatever the browser sent → the shape that is stored (null when empty).
function clean(input) {
  const src = input || {};
  const terms = clip(src.terms, 2000);
  const bank = {
    account_name: clip(src.bank?.account_name, 120),
    account_no: clip(src.bank?.account_no, 60),
    bank_name: clip(src.bank?.bank_name, 120),
  };
  const signers = (Array.isArray(src.signers) ? src.signers : []).slice(0, 3)
    .map(s => ({ label: clip(s?.label, 40), name: clip(s?.name, 80), title: clip(s?.title, 80) }))
    .filter(s => s.label || s.name || s.title);
  const hasBank = !!(bank.account_name || bank.account_no || bank.bank_name);
  if (!terms && !hasBank && !signers.length) return null;
  return { terms, bank, signers };
}

async function load(propertyId) {
  const { rows: [row] } = await db.query('SELECT proforma_footer FROM property_settings WHERE property_id = $1', [propertyId]);
  return clean(row?.proforma_footer);
}

async function save(propertyId, input) {
  const footer = clean(input);
  await db.query('UPDATE property_settings SET proforma_footer = $1 WHERE property_id = $2', [footer ? JSON.stringify(footer) : null, propertyId]);
  return footer;
}

// Draws it at the current position; starts a new page when it won't fit.
function draw(doc, footer) {
  if (!footer) return;
  const L = 50, W = 500;
  const lines = footer.terms ? footer.terms.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const b = footer.bank || {};
  const bankRows = [['Account Name', b.account_name], ['Account No.', b.account_no], ['Bank Name', b.bank_name]].filter(r => r[1]);
  const signers = footer.signers || [];

  const need = (lines.length || bankRows.length ? 30 + lines.length * 14 + (bankRows.length ? 30 + bankRows.length * 15 : 0) : 0)
    + (signers.length ? 110 : 0);
  if (doc.y + need > 780) { doc.addPage(); doc.y = 50; }

  const bullet = text => {
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    const y = doc.y;
    doc.text('•', L, y, { width: 10, lineBreak: false });
    doc.text(text, L + 12, y, { width: W - 12 });
    doc.moveDown(0.25);
  };

  if (lines.length || bankRows.length) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('TERMS & CONDITIONS', L, doc.y);
    doc.moveDown(0.4);
    if (bankRows.length) {
      bullet('Payment may be made to our bank account');
      const top = doc.y + 2;
      const h = 12 + bankRows.length * 15;
      doc.rect(L, top, 340, h).strokeColor('#999').lineWidth(0.7).stroke();
      let y = top + 7;
      for (const [label, value] of bankRows) {
        doc.font('Helvetica').fontSize(9.5).fillColor('#000').text(label, L + 8, y, { width: 90, lineBreak: false });
        doc.font('Helvetica-Bold').text(`: ${value}`, L + 100, y, { width: 232, lineBreak: false });
        y += 15;
      }
      doc.x = L; doc.y = top + h + 8;
    }
    lines.forEach(bullet);
  }

  if (signers.length) {
    doc.y += 22;
    const top = doc.y;
    const colW = W / signers.length;
    signers.forEach((s, i) => {
      const x = L + i * colW;
      doc.font('Helvetica').fontSize(9.5).fillColor('#000').text(s.label || '', x, top, { width: colW, align: 'center' });
      doc.font('Helvetica-Bold').text(s.name || '', x, top + 58, { width: colW, align: 'center' });
      if (s.title) doc.font('Helvetica').fontSize(9).text(`(${s.title})`, x, top + 71, { width: colW, align: 'center' });
    });
    doc.x = L; doc.y = top + 88;
  }
}

module.exports = { clean, load, save, draw };
