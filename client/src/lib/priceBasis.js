// Prices entered including service & tax (migration 079, Property Details →
// Service charge & tax). The server keeps NET amounts and adds service + tax
// on top; with prices_include_tax on, screens show the all-in figure instead.
// `s` is anything carrying tax_rate / service_charge_rate / prices_include_tax
// (the branding from useSettings(), a folio, an estimate).

export function priceFactor(s) {
  return (1 + (parseFloat(s?.service_charge_rate) || 0) / 100) * (1 + (parseFloat(s?.tax_rate) || 0) / 100);
}

// A NET amount → what to show.
export function shownAmount(net, s) {
  const n = parseFloat(net) || 0;
  return s?.prices_include_tax ? Math.round(n * priceFactor(s)) : n;   // all-in: whole rupiah
}

// A folio line's amount / unit price to show: lines the folio adds service +
// tax to ('added') all-in; tax-included / no-tax activity lines as they are.
export function lineShown(value, line, s) {
  if (line?.tax_mode && line.tax_mode !== 'added') return parseFloat(value) || 0;
  return shownAmount(value, s);
}

// A total / balance to show: whole rupiah when prices include tax.
export function shownTotal(v, s) {
  const n = parseFloat(v) || 0;
  return s?.prices_include_tax ? Math.round(n) : n;
}

// "Includes service charge Rp … (10%) and tax Rp … (11%)" — or '' at 0%, or
// when the property doesn't show it (show_tax_breakdown, migration 080).
export function includesText(t, fmt) {
  if (!t?.show_tax_breakdown) return '';
  const parts = [];
  if (parseFloat(t?.service_charge_rate) > 0) parts.push(`service charge ${fmt(Math.round(t.service_charge_amount))} (${parseFloat(t.service_charge_rate)}%)`);
  if (parseFloat(t?.tax_rate) > 0) parts.push(`tax ${fmt(Math.round(t.tax_amount))} (${parseFloat(t.tax_rate)}%)`);
  return parts.length ? `Includes ${parts.join(' and ')}` : '';
}
