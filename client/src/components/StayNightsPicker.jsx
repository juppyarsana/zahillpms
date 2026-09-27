import { propertyToday, addDaysYmd, fmtYmd } from '../lib/propertyTime';

// Pick nights of a stay for a per-night extra (extra bed, migration 074).
// Used by the Sales till and the reservation's "+ Add item", so both doors
// look the same. A night is the date it starts (the night of 28 Sep = 28 Sep).
export function stayNightsOf(booking) {
  if (!booking?.check_in_date || !booking?.check_out_date) return [];
  const out = [];
  for (let d = String(booking.check_in_date).slice(0, 10), end = String(booking.check_out_date).slice(0, 10); d < end; d = addDaysYmd(d, 1)) out.push(d);
  return out;
}

// Default: tonight for a guest in house, otherwise every night still to come.
export function defaultNights(booking) {
  const nights = stayNightsOf(booking);
  const today = propertyToday();
  if (nights.includes(today)) return [today];
  return nights.filter(d => d >= today);
}

export default function StayNightsPicker({ booking, value, onChange, taken = {} }) {
  const nights = stayNightsOf(booking);
  const today = propertyToday();
  const toggle = d => onChange(value.includes(d) ? value.filter(x => x !== d) : [...value, d].sort());
  if (!nights.length) return null;
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {nights.map(d => {
          const on = value.includes(d);
          const note = d === today ? 'tonight' : d < today ? 'passed' : null;
          return (
            <button key={d} type="button" onClick={() => toggle(d)}
              className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flexDirection: 'column', alignItems: 'center', lineHeight: 1.2, padding: '5px 10px', minWidth: 72 }}
              title={taken[d] ? `Already has ${taken[d]} on this night` : undefined}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{on ? '✓ ' : ''}{fmtYmd(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              {(note || taken[d]) && <span style={{ fontSize: 10, opacity: 0.8 }}>{[note, taken[d] && `has ${taken[d]}`].filter(Boolean).join(' · ')}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 11 }}>
        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, fontSize: 11 }} onClick={() => onChange(nights)}>All nights</button>
        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, fontSize: 11 }} onClick={() => onChange(nights.filter(d => d >= today))}>From tonight</button>
        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, fontSize: 11 }} onClick={() => onChange([])}>Clear</button>
      </div>
    </div>
  );
}
