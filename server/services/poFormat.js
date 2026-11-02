// How a PO's quantities and prices read outside the screens (Telegram, PDFs).
// Quantities are kept in g / ml; shown in kg / L from 1,000 up, prices per kg / L.
const BIG = { g: ['kg', 1000], ml: ['L', 1000] };

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const num = n => Number(Number(n).toFixed(3)).toLocaleString('id-ID');
function qtyParts(qty, unit) {
  const big = BIG[unit];
  if (big && Number(qty) >= big[1]) return [num(qty / big[1]), big[0]];
  return [num(qty), unit || ''];
}
const qtyText = (qty, unit) => qtyParts(qty, unit).filter(Boolean).join(' ');
function perUnitText(cost, unit) {
  const big = BIG[unit];
  return big ? `${fmtIDR(cost * big[1])}/${big[0]}` : `${fmtIDR(cost)}${unit ? '/' + unit : ''}`;
}
// What a line costs, and the part of it for what came in.
const lineAmount = i => (i.line_total != null ? Number(i.line_total) : Number(i.quantity) * Number(i.unit_cost));
const receivedValue = i => (Number(i.quantity) > 0 ? lineAmount(i) * Number(i.received_quantity) / Number(i.quantity) : 0);

module.exports = { BIG, fmtIDR, num, qtyParts, qtyText, perUnitText, lineAmount, receivedValue };
