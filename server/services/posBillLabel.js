// How a restaurant bill from the POS reads on a printed invoice / pro forma
// (migration 133): the restaurant's name and the bill number on the guest's
// POS receipt — "SISI GEGE · SG-00001/10/26" — not its items (the guest has
// the itemised receipt; the Folio tab and the event page keep the items).
// A bill sent by a POS without bill numbers shows its POS id, without the
// "~1" a charge made again after a void carries.
function posBillLabel({ outlet, billNo, ref }) {
  const no = billNo || String(ref || '').replace(/~\d+$/, '');
  return [String(outlet || '').trim() || 'Restaurant bill', no].filter(Boolean).join(' · ');
}

// The two fields as the POS sends them, cleaned for saving.
function cleanPosBill({ bill_no, outlet } = {}) {
  const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
  return { billNo: clip(bill_no, 40), outlet: clip(outlet, 60) };
}

module.exports = { posBillLabel, cleanPosBill };
