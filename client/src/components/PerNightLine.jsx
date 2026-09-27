import StayNightsPicker from './StayNightsPicker';

// The editable part of a per-night extra (extra bed, migrations 074/075),
// shared by the Sales till and the reservation's "+ Add item":
//   units per night · price per night (the item's price, can be bargained)
//   · breakfasts per night (units × the item's breakfasts per unit, can be
//   changed — e.g. a double extra bed for one person) · which nights.
// `line` = { quantity, price_per_night, breakfasts, breakfasts_touched, nights }
// `product` = the item row (price, meal_price, meal_pax).
const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

export function defaultBreakfasts(product, units) {
  return parseFloat(product.meal_price) > 0 ? (parseInt(units) || 0) * (parseInt(product.meal_pax) || 0) : 0;
}

// Units changed → breakfasts follow the default unless FO typed their own.
export function withUnits(line, product, units) {
  return { ...line, quantity: units, breakfasts: line.breakfasts_touched ? line.breakfasts : defaultBreakfasts(product, units) };
}

export default function PerNightLine({ booking, product, line, onChange, compact = false }) {
  const hasBreakfast = parseFloat(product.meal_price) > 0;
  const priceChanged = line.price_per_night !== '' && parseFloat(line.price_per_night) !== parseFloat(product.price);
  const dflt = defaultBreakfasts(product, line.quantity);
  const cell = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };
  const lbl = { fontSize: 11, color: 'var(--text-muted)' };
  return (
    <div style={{ marginTop: compact ? 6 : 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: hasBreakfast ? '1fr 1fr' : '1fr', gap: 8, marginBottom: 8 }}>
        <label style={cell}>
          <span style={lbl}>Price per night (normal {fmtIDR(product.price)})</span>
          <input className="form-input" type="number" min="0" value={line.price_per_night}
            onChange={e => onChange({ ...line, price_per_night: e.target.value })} style={{ padding: '5px 8px' }} />
        </label>
        {hasBreakfast && (
          <label style={cell}>
            <span style={lbl}>Breakfasts per night (normal {dflt})</span>
            <input className="form-input" type="number" min="0" max="50" value={line.breakfasts}
              onChange={e => onChange({ ...line, breakfasts: e.target.value === '' ? '' : parseInt(e.target.value), breakfasts_touched: true })}
              style={{ padding: '5px 8px' }} />
          </label>
        )}
      </div>
      {(priceChanged || (hasBreakfast && line.breakfasts !== '' && line.breakfasts !== dflt)) && (
        <div style={{ fontSize: 11, color: '#92400E', marginBottom: 6 }}>
          Changed from normal — saved in the booking's Edit History.
        </div>
      )}
      <div style={lbl}>Which nights</div>
      <StayNightsPicker booking={booking} value={line.nights || []} onChange={n => onChange({ ...line, nights: n })} />
    </div>
  );
}
