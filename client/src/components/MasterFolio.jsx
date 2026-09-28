import { Link } from 'react-router-dom';
import { lineShown, includesText, shownTotal } from '../lib/priceBasis';

// Group Master Folio: the whole stay of every room, like a single booking's
// Folio tab — an estimate (every night, posted or not, + extras − payments;
// GET /api/folio/group/:id → estimate), per room its lines (room nights
// grouped like the invoice, extras, paid badges, "upcoming" until posted) and
// the group's totals.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const ymd = d => String(d || '').slice(0, 10);
const shortDate = d => (d ? new Date(ymd(d) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const nextDay = d => { const x = new Date(ymd(d) + 'T00:00:00'); x.setDate(x.getDate() + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

function stayLabel(r, hasRoom, hasMeal) {
  const bf = r.includes_breakfast, lu = r.includes_lunch, di = r.includes_dinner;
  const meals = bf && lu && di ? 'Full Board' : bf && di ? 'Half Board' : bf && !lu && !di ? 'Breakfast' : (bf || lu || di) ? (r.rate_plan_name || 'meals') : null;
  if (hasRoom && hasMeal) return meals ? `Room with ${meals}` : 'Room with meals';
  if (hasRoom) return 'Room';
  return meals || 'Meals';
}

// Room + meal-plan nights → one line per run of nights at the same rate
// (and the same posted / upcoming state), like the invoice.
function stayRuns(room, rates) {
  const nights = new Map();
  for (const c of room.charges) {
    if (!['room', 'fnb'].includes(c.type) || !c.service_date) continue;
    const d = ymd(c.service_date);
    const n = nights.get(d) || { amount: 0, room: false, meal: false, posted: true };
    n.amount += lineShown(c.amount, c, rates);
    if (c.type === 'room') n.room = true; else n.meal = true;
    n.posted = n.posted && c.posted;
    nights.set(d, n);
  }
  const runs = [];
  for (const d of [...nights.keys()].sort()) {
    const n = nights.get(d);
    const last = runs[runs.length - 1];
    const label = stayLabel(room, n.room, n.meal);
    if (last && last.label === label && last.posted === n.posted && Math.abs(last.rate - n.amount) < 1 && nextDay(last.to) === d) {
      last.to = d; last.count++; last.sum += n.amount;
    } else runs.push({ from: d, to: d, count: 1, rate: n.amount, sum: n.amount, label, posted: n.posted });
  }
  return runs;
}

// Per-night extras (extra bed) → one line per run of nights with the same
// price, paid / posted state; everything else stays one line each.
function extraLines(room, rates) {
  const out = [];
  const nightly = room.charges.filter(c => c.type === 'addon' && c.service_date)
    .map(c => ({ c, name: String(c.description).replace(/ — \d{4}-\d{2}-\d{2}$/, ''), d: ymd(c.service_date), amount: lineShown(c.amount, c, rates) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.d.localeCompare(b.d));
  for (const n of nightly) {
    const last = out[out.length - 1];
    if (last && last.run && last.name === n.name && last.posted === n.c.posted && last.paid === (n.c.paid_method || null)
      && Math.abs(last.rate - n.amount) < 1 && nextDay(last.to) === n.d) {
      last.to = n.d; last.count++; last.sum += n.amount;
    } else out.push({ run: true, name: n.name, from: n.d, to: n.d, count: 1, rate: n.amount, sum: n.amount, posted: n.c.posted, paid: n.c.paid_method || null });
  }
  for (const c of room.charges.filter(x => !['room', 'fnb'].includes(x.type) && !(x.type === 'addon' && x.service_date))) {
    out.push({ run: false, name: String(c.description).replace(/ — \d{4}-\d{2}-\d{2}$/, ''), date: c.service_date || c.posted_at,
      qty: parseFloat(c.quantity), unit: lineShown(c.unit_price, c, rates), sum: c.complimentary ? null : lineShown(c.amount, c, rates),
      posted: c.posted, paid: c.paid_method || null });
  }
  return out;
}

const STATUS = { pending: 'Pending', deposit_paid: 'Deposit paid', confirmed: 'Confirmed', checked_in: 'Checked in', checked_out: 'Checked out' };

export default function MasterFolio({ folio, onRecordGroupPayment }) {
  const est = folio.estimate;
  if (!est) return null;
  const rates = folio;   // tax_rate / service_charge_rate / prices_include_tax / show_tax_breakdown
  const hasTaxRates = parseFloat(rates.service_charge_rate) > 0 || parseFloat(rates.tax_rate) > 0;
  const money = n => fmtIDR(shownTotal(n, rates));
  const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' };

  return (
    <>
      <div className="flex-between" style={{ padding: '14px 16px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="text-muted" style={{ fontSize: 12 }}>Estimated total · whole stay, {est.rooms.length} room{est.rooms.length === 1 ? '' : 's'}</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{money(est.total)}</div>
        </div>
        <div>
          <div className="text-muted" style={{ fontSize: 12 }}>Received</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtIDR(est.received)}</div>
        </div>
        <div>
          <div className="text-muted" style={{ fontSize: 12 }}>Estimated balance due</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: est.balance_due > 0.5 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>{money(est.balance_due)}</div>
        </div>
        {onRecordGroupPayment && <button className="btn btn-primary btn-sm" onClick={onRecordGroupPayment}>💳 Record Group Payment</button>}
        <div className="text-muted" style={{ fontSize: 11, flexBasis: '100%' }}>
          Projected for the whole stay, including nights not posted yet (they post at night audit). Cancelled rooms aren't included.
        </div>
      </div>

      {est.rooms.map(room => {
        const runs = stayRuns(room, rates);
        const extras = extraLines(room, rates);
        const paid = room.payments.reduce((s, p) => s + parseFloat(p.amount), 0);
        return (
          <div key={room.booking_id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
            <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div>
                <b style={{ fontSize: 15 }}>{room.unit_name}</b>{room.complimentary_scope ? ' 🎁' : ''}
                <span style={{ marginLeft: 8, fontSize: 13 }}>{room.guest_name}</span>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {shortDate(room.check_in)} → {shortDate(room.check_out)} · {room.nights} night{room.nights === 1 ? '' : 's'} · {room.num_guests} guest{room.num_guests === 1 ? '' : 's'} · {STATUS[room.status] || room.status}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13 }}>Total <b>{money(room.total)}</b></div>
                <div style={{ fontSize: 12, color: room.balance_due > 0.5 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                  Balance {money(room.balance_due)}
                </div>
                <div className="flex gap-2" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                  {/* Charges are posted per room — these open that room's reservation. */}
                  {['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(room.status) && (
                    <Link to={`/reservations/${room.booking_id}#add-item`} className="btn btn-sm btn-secondary">+ Add item</Link>
                  )}
                  <Link to={`/reservations/${room.booking_id}`} className="btn btn-sm btn-secondary">Open folio →</Link>
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={`s${i}`}>
                      <td style={cell}>
                        {r.label} · {shortDate(r.from)} – {shortDate(nextDay(r.to))}
                        {!r.posted && <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 10 }}>upcoming</span>}
                      </td>
                      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }} className="text-muted">{r.count} × {fmtIDR(r.rate)}</td>
                      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtIDR(r.sum)}</td>
                    </tr>
                  ))}
                  {extras.map((x, i) => (
                    <tr key={`x${i}`}>
                      <td style={cell}>
                        {x.name}
                        <span className="text-muted"> · {x.run ? `${shortDate(x.from)} – ${shortDate(nextDay(x.to))}` : shortDate(x.date)}</span>
                        {!x.posted && <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 10 }}>upcoming</span>}
                        {x.paid && <span className="badge badge-green" style={{ marginLeft: 6, fontSize: 10 }}>Paid · {x.paid}</span>}
                      </td>
                      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }} className="text-muted">
                        {x.run ? `${x.count} × ${fmtIDR(x.rate)}` : x.qty > 1 ? `${x.qty} × ${fmtIDR(x.unit)}` : ''}
                      </td>
                      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{x.sum === null ? 'Free' : fmtIDR(x.sum)}</td>
                    </tr>
                  ))}
                  {!runs.length && !extras.length && (
                    <tr><td style={cell} className="text-muted" colSpan={3}>Nothing to charge</td></tr>
                  )}
                  {paid > 0 && (
                    <tr>
                      <td style={{ ...cell, borderBottom: 'none' }} className="text-muted">Payments received</td>
                      <td style={{ ...cell, borderBottom: 'none' }} />
                      <td style={{ ...cell, borderBottom: 'none', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-success, #16a34a)' }}>− {fmtIDR(paid)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div style={{ maxWidth: 420, marginLeft: 'auto', marginTop: 8 }}>
        {!rates.prices_include_tax && hasTaxRates && (<>
          <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}><span className="text-muted">Subtotal</span><span>{fmtIDR(est.subtotal)}</span></div>
          {parseFloat(rates.service_charge_rate) > 0 && <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}><span className="text-muted">Service charge ({parseFloat(rates.service_charge_rate)}%)</span><span>{fmtIDR(est.service_charge_amount)}</span></div>}
          {parseFloat(rates.tax_rate) > 0 && <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}><span className="text-muted">Tax ({parseFloat(rates.tax_rate)}%)</span><span>{fmtIDR(est.tax_amount)}</span></div>}
        </>)}
        <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 4 }}>
          <span>Estimated total</span><span>{money(est.total)}</span>
        </div>
        {rates.prices_include_tax && includesText({ ...rates, service_charge_amount: est.service_charge_amount, tax_amount: est.tax_amount }, fmtIDR) && (
          <div className="text-muted" style={{ fontSize: 11, textAlign: 'right', marginBottom: 4 }}>
            {includesText({ ...rates, service_charge_amount: est.service_charge_amount, tax_amount: est.tax_amount }, fmtIDR)}
          </div>
        )}
        <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}><span className="text-muted">Received</span><span>− {fmtIDR(est.received)}</span></div>
        <div className="flex-between" style={{ fontWeight: 800, fontSize: 16, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <span>Estimated balance due</span>
          <span style={{ color: est.balance_due > 0.5 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>{money(est.balance_due)}</span>
        </div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
          Posted to the ledger so far: {money(folio.total)}. To add a charge, open the room's folio.
        </div>
      </div>
    </>
  );
}
