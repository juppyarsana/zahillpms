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
      && last.toGroup === !!n.c.to_group && Math.abs(last.rate - n.amount) < 1 && nextDay(last.to) === n.d) {
      last.to = n.d; last.count++; last.sum += n.amount;
    } else out.push({ run: true, name: n.name, from: n.d, to: n.d, count: 1, rate: n.amount, sum: n.amount, posted: n.c.posted, paid: n.c.paid_method || null, toGroup: !!n.c.to_group });
  }
  for (const c of room.charges.filter(x => !['room', 'fnb'].includes(x.type) && !(x.type === 'addon' && x.service_date))) {
    out.push({ run: false, name: String(c.description).replace(/ — \d{4}-\d{2}-\d{2}$/, ''), date: c.service_date || c.posted_at,
      qty: parseFloat(c.quantity), unit: lineShown(c.unit_price, c, rates), sum: c.complimentary ? null : lineShown(c.amount, c, rates),
      posted: c.posted, paid: c.paid_method || null, notPaid: !!c.not_paid, toGroup: !!c.to_group });
  }
  return out;
}

const PAY_TYPE = { deposit: 'Deposit', balance: 'Balance', incidental: 'Extras' };
// The received date FO chose; plus the time it was recorded when that's the
// same day (payments recorded before migration 093 have no time).
const localDay = v => new Date(v).toLocaleDateString('en-CA');
const payDate = p => {
  if (!p.received_at) return '—';
  const day = localDay(p.received_at);
  const d = shortDate(day);
  if (!p.recorded_at || localDay(p.recorded_at) !== day) return d;
  return `${d}, ${new Date(p.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

// Every received payment of the group as transactions: lines recorded in one
// go (Record Group Payment marks several rooms' lines at the same instant,
// same method / person / reference) are one transaction with its rooms.
// A group billed as a whole (migration 097): its own payments are
// transactions "for the group" (voided ones left out).
function transactions(rooms, groupPayments = []) {
  const map = new Map();
  for (const p of groupPayments.filter(x => !x.is_voided)) {
    map.set(p.id, { key: p.id, when: p.recorded_at || p.received_at, date: payDate(p), method: p.method_label, reference: p.reference,
      by: p.received_by_name, notes: p.notes, parts: [{ room: null, type: 'Group payment', amount: parseFloat(p.amount) }], total: parseFloat(p.amount) });
  }
  for (const room of rooms) {
    for (const p of room.payments) {
      const key = p.recorded_at ? `${p.recorded_at}|${p.method}|${p.received_by || ''}|${p.reference || ''}` : p.id;
      let t = map.get(key);
      if (!t) {
        t = { key, when: p.recorded_at || p.received_at, date: payDate(p), method: p.method_label, reference: p.reference,
          by: p.received_by_name, notes: p.notes, parts: [], total: 0 };
        map.set(key, t);
      }
      t.parts.push({ room: room.unit_name, type: PAY_TYPE[p.type] || p.type, amount: parseFloat(p.amount) });
      t.total += parseFloat(p.amount);
    }
  }
  return [...map.values()].sort((a, b) => String(a.when).localeCompare(String(b.when)));
}

function PaymentsReceived({ rooms, groupPayments }) {
  const txns = transactions(rooms, groupPayments);
  if (!txns.length) return null;
  const byMethod = new Map();
  for (const t of txns) byMethod.set(t.method, (byMethod.get(t.method) || 0) + t.total);
  const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' };
  const total = txns.reduce((s, t) => s + t.total, 0);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
      <div className="flex-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <b style={{ fontSize: 15 }}>Payments received</b>
        <span className="text-muted" style={{ fontSize: 12 }}>{txns.length} transaction{txns.length === 1 ? '' : 's'}</span>
      </div>
      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr className="text-muted" style={{ fontSize: 11, textAlign: 'left' }}>
              <th style={cell}>Date</th><th style={cell}>Method</th><th style={cell}>For</th><th style={cell}>By</th>
              <th style={{ ...cell, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {txns.map(t => (
              <tr key={t.key}>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{t.date}</td>
                <td style={cell}>
                  {t.method}
                  {t.reference && <div className="text-muted" style={{ fontSize: 11 }}>Ref {t.reference}</div>}
                </td>
                <td style={cell}>
                  {t.parts.map((p, i) => (
                    <div key={i} style={{ fontSize: 12 }}>
                      {p.room ? `Room ${p.room} · ` : ''}{p.type}{t.parts.length > 1 && <span className="text-muted"> · {fmtIDR(p.amount)}</span>}
                    </div>
                  ))}
                  {t.notes && <div className="text-muted" style={{ fontSize: 11 }}>{t.notes}</div>}
                </td>
                <td style={cell} className="text-muted">{t.by || '—'}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtIDR(t.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ maxWidth: 320, marginLeft: 'auto', marginTop: 8 }}>
        {[...byMethod.entries()].map(([m, amt]) => (
          <div key={m} className="flex-between" style={{ fontSize: 13, marginBottom: 2 }}><span className="text-muted">{m}</span><span>{fmtIDR(amt)}</span></div>
        ))}
        <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 4 }}>
          <span>Total received</span><span>{fmtIDR(total)}</span>
        </div>
      </div>
    </div>
  );
}

const STATUS = { pending: 'Pending', deposit_paid: 'Deposit paid', confirmed: 'Confirmed', checked_in: 'Checked in', checked_out: 'Checked out' };

export default function MasterFolio({ folio, onRecordGroupPayment }) {
  const est = folio.estimate;
  if (!est) return null;
  const rates = folio;   // tax_rate / service_charge_rate / prices_include_tax / show_tax_breakdown
  const hasTaxRates = parseFloat(rates.service_charge_rate) > 0 || parseFloat(rates.tax_rate) > 0;
  const money = n => fmtIDR(shownTotal(n, rates));
  const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' };
  // Billed as a whole (migration 097): one group bill + each room's own part.
  const gb = est.group;
  const due = n => ({ color: n > 0.5 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' });

  return (
    <>
      {gb && (
        <div style={{ padding: '14px 16px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>Group bill · {gb.billing_mode === 'everything' ? 'everything' : 'room & meal plan'}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{money(gb.total)}</div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>Paid by the group</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtIDR(gb.received)}</div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>Group balance due</div>
              <div style={{ fontSize: 22, fontWeight: 800, ...due(gb.balance_due) }}>{money(gb.balance_due)}</div>
            </div>
            {onRecordGroupPayment && <button className="btn btn-primary btn-sm" onClick={onRecordGroupPayment}>💳 Record Group Payment</button>}
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            Rooms pay themselves (their own extras): <b style={due(gb.rooms_own_balance)}>{money(gb.rooms_own_balance)}</b> still to pay
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
            Projected for the whole stay, including nights not posted yet (they post at night audit). Cancelled rooms aren't included.
          </div>
        </div>
      )}
      {!gb && <div className="flex-between" style={{ padding: '14px 16px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
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
      </div>}

      {est.rooms.map(room => {
        const runs = stayRuns(room, rates);
        const extras = extraLines(room, rates);
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
                {gb ? (<>
                  <div style={{ fontSize: 13 }}>On the group bill <b>{money(room.group_total)}</b></div>
                  {(room.own_total > 0.5 || room.balance_due > 0.5) && (
                    <div style={{ fontSize: 12 }}>Room pays {money(room.own_total)} · <span style={due(room.balance_due)}>balance {money(room.balance_due)}</span></div>
                  )}
                </>) : (<>
                  <div style={{ fontSize: 13 }}>Total <b>{money(room.total)}</b></div>
                  <div style={{ fontSize: 12, ...due(room.balance_due) }}>
                    Balance {money(room.balance_due)}
                  </div>
                </>)}
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
                        {x.notPaid ? <span className="badge badge-yellow" style={{ marginLeft: 6, fontSize: 10 }}>not paid yet</span>
                          : !x.posted && <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 10 }}>upcoming</span>}
                        {x.paid && <span className="badge badge-green" style={{ marginLeft: 6, fontSize: 10 }}>Paid · {x.paid}</span>}
                        {gb && !x.paid && !x.toGroup && x.sum !== null && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }} title="Not on the group bill — this room's guest pays it">room pays</span>}
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
                  {room.payments.map((p, i) => (
                    <tr key={`p${p.id}`}>
                      <td style={{ ...cell, borderBottom: i === room.payments.length - 1 ? 'none' : cell.borderBottom }} className="text-muted">
                        {PAY_TYPE[p.type] || p.type} received · {p.method_label} · {payDate(p)}
                        {p.reference && <span> · Ref {p.reference}</span>}
                      </td>
                      <td style={{ ...cell, borderBottom: i === room.payments.length - 1 ? 'none' : cell.borderBottom }} />
                      <td style={{ ...cell, borderBottom: i === room.payments.length - 1 ? 'none' : cell.borderBottom, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-success, #16a34a)' }}>− {fmtIDR(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <PaymentsReceived rooms={est.rooms} groupPayments={gb?.payments || []} />

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
        {gb && (
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4, textAlign: 'right' }}>
            group {money(gb.balance_due)} + rooms' own extras {money(gb.rooms_own_balance)}
          </div>
        )}
        <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
          Posted to the ledger so far: {money(folio.total)}. To add a charge, open the room's folio.
        </div>
      </div>
    </>
  );
}
