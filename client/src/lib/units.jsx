// Stock kept in g / ml (the restaurant's POS items, some PMS items) is bought
// and counted in kg / litres. A line keeps a `big` flag: when true its
// quantity is typed in kg / L and its price per kg / L (the default — only
// `big: false` means g / ml); toBase() turns them back into the item's own
// unit before saving.
export const isBig = line => line.big !== false;
export const BIG_UNIT = { g: ['kg', 1000], ml: ['L', 1000] };

const nf = n => (+Number(n).toFixed(3)).toLocaleString('id-ID');

// 30520 g → "30,52 kg" (the stored figure stays in g)
export function fmtQty(n, unit) {
  const v = Number(n || 0), big = BIG_UNIT[unit];
  if (big && Math.abs(v) >= big[1]) return `${nf(v / big[1])} ${big[0]}`;
  return `${nf(v)}${unit ? ' ' + unit : ''}`;
}

const scaled = (v, f) => (v === '' || v == null || isNaN(Number(v)) ? v : String(+(Number(v) * f).toFixed(4)));

// Patch for a line when its kg ↔ g switch is flipped: the typed figures follow.
export function flipBig(line, unit, qtyKey = 'quantity', priceKey = 'unit_cost') {
  const f = BIG_UNIT[unit]?.[1] || 1;
  const toBig = !isBig(line);
  const patch = { big: toBig, [qtyKey]: scaled(line[qtyKey], toBig ? 1 / f : f) };
  if (priceKey && priceKey in line) patch[priceKey] = scaled(line[priceKey], toBig ? f : 1 / f);
  return patch;
}

// A line's typed quantity / price in the item's own unit.
export function toBase(line, unit, qtyKey = 'quantity', priceKey = 'unit_cost') {
  const f = isBig(line) && BIG_UNIT[unit] ? BIG_UNIT[unit][1] : 1;
  const out = { quantity: Number(line[qtyKey]) * f };
  if (priceKey) out.unit_cost = Number(line[priceKey]) / f;
  return out;
}

// Starting values for a line from figures in the item's own unit.
export function fromBase(unit, quantity, unitCost) {
  const big = !!BIG_UNIT[unit];
  const f = big ? BIG_UNIT[unit][1] : 1;
  return {
    big,
    quantity: quantity === '' || quantity == null ? '' : String(+(Number(quantity) / f).toFixed(4)),
    ...(unitCost !== undefined ? { unit_cost: unitCost === '' || unitCost == null ? '' : String(+(Number(unitCost) * f).toFixed(2)) } : {}),
  };
}

// The unit shown next to a line's quantity: a kg / g switch, or just the unit.
export function UnitSwitch({ unit, line, onFlip }) {
  const big = isBig(line);
  const b = BIG_UNIT[unit];
  if (!b) return unit ? <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{unit}</span> : null;
  return (
    <select className="form-select" style={{ width: 62, padding: '4px 6px' }} value={big ? 'big' : 'base'} onChange={onFlip}>
      <option value="big">{b[0]}</option>
      <option value="base">{unit}</option>
    </select>
  );
}

// "per kg" / "per g" for a price column.
export const perUnit = (unit, line) => (unit ? `per ${isBig(line) && BIG_UNIT[unit] ? BIG_UNIT[unit][0] : unit}` : 'per unit');
