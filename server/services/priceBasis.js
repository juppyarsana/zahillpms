const db = require('../db');
const { round2 } = require('./folioService');

// How a property's prices are entered (migration 079): before tax ("++") or
// including service charge + tax ("nett"). Room type rates, pricing periods,
// rate-plan meal prices and Sales item prices are all entered the same way.
// Internally everything stays NET (bookings.room_revenue, sale lines, folio
// lines) and the folio adds service + tax on top — so a nett price is turned
// into NET where it's read (toNet) and back into the all-in figure where it's
// shown (shown). Activities have their own per-activity setting (078).

// Same factor computeFolioTotals applies: service on the subtotal, then tax
// on subtotal + service.
function factor(taxRate, serviceChargeRate) {
  return (1 + (parseFloat(serviceChargeRate) || 0) / 100) * (1 + (parseFloat(taxRate) || 0) / 100);
}

// From a property_settings row (tax_rate, service_charge_rate, prices_include_tax).
function basisFrom(s) {
  const F = factor(s?.tax_rate, s?.service_charge_rate);
  const include = !!s?.prices_include_tax;
  return {
    tax_rate: parseFloat(s?.tax_rate ?? 0) || 0,
    service_charge_rate: parseFloat(s?.service_charge_rate ?? 0) || 0,
    include,
    F,
    divisor: include ? F : 1,   // entered price ÷ divisor = NET
  };
}

async function priceBasis(propertyId, client = db) {
  const { rows: [s] } = await client.query(
    'SELECT tax_rate, service_charge_rate, prices_include_tax FROM property_settings WHERE property_id = $1', [propertyId]
  );
  return basisFrom(s);
}

// A price as entered → NET.
function toNet(price, basis) {
  const p = parseFloat(price) || 0;
  return round2(basis?.include ? p / basis.F : p);
}

// A NET amount → the figure to show (all-in when prices include tax).
function shown(net, basis) {
  const n = parseFloat(net) || 0;
  return round2(basis?.include ? n * basis.F : n);
}

module.exports = { factor, basisFrom, priceBasis, toNet, shown };
