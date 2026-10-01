import { useState, useEffect } from 'react';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { lineShown, shownAmount, shownTotal } from '../lib/priceBasis';

// Record Payment (migrations 082–083): everything the guest owes, in two
// tables — the room's pending deposit / balance lines, and the extras
// (unpaid folio lines + per-night extras still to come, e.g. an extra bed
// booked with the reservation). Front desk ticks what the guest is paying;
// POST /api/folio/:id/receive records the room part on its lines and the
// items as one payment with its own receipt.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const shortDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const TH = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const TD = { padding: '8px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'middle' };

export default function RecordPaymentModal({ booking, estimate, onClose, onPaid, printReceipt }) {
  const { paymentMethods } = useSettings();
  const methods = paymentMethods.filter(m => m.is_active !== false && m.id !== 'ota_managed');
  const [folio, setFolio] = useState(null);
  const [addons, setAddons] = useState([]);
  const [room, setRoom] = useState({});        // payment_id → { on, amount }
  const [items, setItems] = useState([]);      // folio charge ids
  const [nights, setNights] = useState([]);    // booking_addon ids (not posted yet)
  const [form, setForm] = useState({ method: methods.find(m => m.id === 'bank_transfer')?.id || methods[0]?.id || '', received_at: todayYmd(), reference: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const roomLines = (booking.payments || [])
    .filter(p => ['deposit', 'balance'].includes(p.type) && p.status === 'pending' && parseFloat(p.amount) > 0)
    .sort((a, b) => (a.type === b.type ? new Date(a.created_at) - new Date(b.created_at) : a.type === 'deposit' ? -1 : 1));   // deposit first
  const extrasFree = booking.complimentary_scope === 'all';
  // What can be paid as items: unpaid extras on the folio, and per-night
  // extras still to come (not posted, not paid, not from a Pay-now sale).
  const payableLines = f => (f && !extrasFree ? f.charges.filter(c => !['room', 'fnb'].includes(c.type) && !c.paid_method && !c.complimentary) : []);
  const payableNights = list => (extrasFree ? [] : list.filter(a => a.status === 'active' && a.in_stay && !a.posted && !a.paid_payment_id
    && (!a.payment_method || ['room_charge', 'unpaid'].includes(a.payment_method))));
  const itemLines = payableLines(folio);
  const futureNights = payableNights(addons);

  function selectAll(which, lines = itemLines, nightList = futureNights) {
    setRoom(Object.fromEntries(roomLines.map(l => [l.id, { on: which === 'all' || (which === 'deposit' && l.type === 'deposit'), amount: String(Math.round(parseFloat(l.amount))) }])));
    setItems(which === 'all' ? lines.map(c => c.id) : []);
    setNights(which === 'all' ? nightList.map(a => a.id) : []);
  }

  useEffect(() => {
    Promise.all([
      api.get(`/api/folio/${booking.id}`),
      api.get(`/api/bookings/${booking.id}/addons`).catch(() => ({ data: [] })),
    ]).then(([f, a]) => {
      setFolio(f.data); setAddons(a.data);
      selectAll('all', payableLines(f.data), payableNights(a.data));   // start with everything owed ticked
    }).catch(() => setError('Could not load what the guest owes'));
  }, [booking.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rates = folio || {};
  const nightNet = a => r2(parseFloat(a.unit_price) * a.quantity);
  // Items as the server charges them: service + tax on the 'added' ones.
  const itemsTotal = (() => {
    let taxable = 0, untaxed = 0;
    for (const c of itemLines) if (items.includes(c.id)) {
      if (c.tax_mode && c.tax_mode !== 'added') untaxed += parseFloat(c.amount); else taxable += parseFloat(c.amount);
    }
    for (const a of futureNights) if (nights.includes(a.id)) taxable += nightNet(a);
    const sub = r2(taxable);
    const sc = r2(sub * (parseFloat(rates.service_charge_rate) || 0) / 100);
    const tax = r2((sub + sc) * (parseFloat(rates.tax_rate) || 0) / 100);
    return r2(sub + sc + tax + untaxed);
  })();
  const roomTotal = roomLines.reduce((s, l) => s + (room[l.id]?.on ? (parseFloat(room[l.id].amount) || 0) : 0), 0);
  const total = r2(roomTotal + itemsTotal);
  const roomBad = roomLines.some(l => room[l.id]?.on && !(parseFloat(room[l.id].amount) > 0 && parseFloat(room[l.id].amount) <= parseFloat(l.amount) + 0.005));
  const taxNote = !rates.prices_include_tax && (parseFloat(rates.service_charge_rate) > 0 || parseFloat(rates.tax_rate) > 0);
  const toggle = (list, set, id) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  async function save() {
    setSaving(true); setError('');
    try {
      const r = await api.post(`/api/folio/${booking.id}/receive`, {
        room: roomLines.filter(l => room[l.id]?.on).map(l => ({ payment_id: l.id, amount: parseFloat(room[l.id].amount) })),
        charge_ids: items, addon_ids: nights, ...form,
      });
      setDone(r.data);
      onPaid?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the payment');
    } finally {
      setSaving(false);
    }
  }

  const nothingOwed = folio && !roomLines.length && !itemLines.length && !futureNights.length;
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 780, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Record Payment — {booking.guest_name}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {done ? (
            <>
              <div style={{ fontSize: 14, marginBottom: 12 }}>
                ✓ <b>{fmtIDR(shownTotal(done.total, rates))}</b> received
                {done.room_amount > 0 && <> — room {fmtIDR(done.room_amount)}</>}
                {done.items_count > 0 && <>{done.room_amount > 0 ? ',' : ' —'} {done.items_count} item{done.items_count === 1 ? '' : 's'} {fmtIDR(shownTotal(done.items_amount, rates))}</>}.
              </div>
              {done.items_payment_id && (
                <button className="btn btn-secondary" onClick={() => printReceipt(done.items_payment_id)}>🖨 Print receipt for the items</button>
              )}
            </>
          ) : !folio ? (
            <div className="text-muted">{error || 'Loading…'}</div>
          ) : (
            <>
              <div className="flex-between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  Still owed on this stay: <span style={{ color: 'var(--color-danger, #dc2626)' }}>{fmtIDR(shownTotal(estimate?.balance_due ?? 0, rates))}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => selectAll('all')}>Everything owed</button>
                  {roomLines.some(l => l.type === 'deposit') && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => selectAll('deposit')}>Room deposit</button>
                  )}
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => selectAll('none')}>Clear</button>
                </div>
              </div>

              {nothingOwed && <div className="alert"><div>Nothing is owed on this stay right now.</div></div>}

              {roomLines.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={{ ...TH, width: 28 }} /><th style={TH}>Room</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Due</th><th style={{ ...TH, textAlign: 'right', width: 150 }}>Pay now</th>
                    </tr></thead>
                    <tbody>
                      {roomLines.map(l => {
                        const r = room[l.id] || { on: false, amount: String(Math.round(parseFloat(l.amount))) };
                        return (
                          <tr key={l.id}>
                            <td style={TD}><input type="checkbox" checked={r.on} onChange={() => setRoom(x => ({ ...x, [l.id]: { ...r, on: !r.on } }))} /></td>
                            <td style={TD}>
                              <b style={{ textTransform: 'capitalize' }}>{l.type}</b>
                              {l.notes && <div className="text-muted" style={{ fontSize: 11 }}>{l.notes}</div>}
                            </td>
                            <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(l.amount)}</td>
                            <td style={{ ...TD, textAlign: 'right' }}>
                              <input className="form-input" type="number" min={1} max={Math.round(parseFloat(l.amount))} disabled={!r.on}
                                style={{ maxWidth: 140, textAlign: 'right', padding: '4px 8px' }}
                                value={r.amount} onChange={e => setRoom(x => ({ ...x, [l.id]: { ...r, amount: e.target.value } }))} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Type a smaller amount for a part payment — the rest stays owed on the same line.</div>
                </div>
              )}

              {(itemLines.length > 0 || futureNights.length > 0) && (
                <div className="table-wrap" style={{ marginBottom: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={{ ...TH, width: 28 }} /><th style={TH}>Extras &amp; activities</th>
                      <th style={TH}>Date</th><th style={{ ...TH, textAlign: 'right' }}>Amount</th>
                    </tr></thead>
                    <tbody>
                      {itemLines.map(c => (
                        <tr key={c.id} onClick={() => toggle(items, setItems, c.id)} style={{ cursor: 'pointer' }}>
                          <td style={TD}><input type="checkbox" checked={items.includes(c.id)} readOnly /></td>
                          <td style={TD}>{c.description.replace(/ — \d{4}-\d{2}-\d{2}$/, '')}
                            {c.tax_mode === 'included' && !rates.prices_include_tax && <span className="text-muted" style={{ fontSize: 11 }}> · tax incl.</span>}
                            {c.tax_mode === 'none' && <span className="text-muted" style={{ fontSize: 11 }}> · no tax</span>}
                          </td>
                          <td style={{ ...TD, whiteSpace: 'nowrap' }}>{shortDate(c.service_date || c.posted_at)}</td>
                          <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(lineShown(c.amount, c, rates))}</td>
                        </tr>
                      ))}
                      {futureNights.map(a => (
                        <tr key={a.id} onClick={() => toggle(nights, setNights, a.id)} style={{ cursor: 'pointer' }}>
                          <td style={TD}><input type="checkbox" checked={nights.includes(a.id)} readOnly /></td>
                          <td style={TD}>{a.description}{a.quantity > 1 ? ` × ${a.quantity}` : ''}
                            <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 10 }}>upcoming night</span>
                          </td>
                          <td style={{ ...TD, whiteSpace: 'nowrap' }}>{shortDate(a.service_date)}</td>
                          <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(shownAmount(nightNet(a), rates))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {taxNote && <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Service charge &amp; tax are added to the extras in the total below.</div>}
                </div>
              )}

              <div className="flex-between" style={{ padding: '10px 12px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 13 }}>Room {fmtIDR(roomTotal)} · Extras {fmtIDR(shownTotal(itemsTotal, rates))}{taxNote ? ' (incl. service & tax)' : ''}</span>
                <span style={{ fontWeight: 800, fontSize: 16 }}>Total to receive {fmtIDR(shownTotal(total, rates))}</span>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Method</label>
                  <select className="form-select" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                    {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Date received</label>
                  <input className="form-input" type="date" value={form.received_at} onChange={e => setForm(f => ({ ...f, received_at: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Reference</label>
                  <input className="form-input" value={form.reference} maxLength={120} placeholder="Card trace no. / transfer ref" onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input className="form-input" value={form.notes} placeholder="Optional" onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              {roomBad && <div className="alert alert-error"><div>A room amount must be more than 0 and not more than what's due.</div></div>}
              {error && <div className="alert alert-error"><div>{error}</div></div>}
            </>
          )}
        </div>
        <div className="modal-footer">
          {done ? (
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          ) : (<>
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !folio || !(total > 0) || roomBad || !form.method}>
              {saving ? 'Saving…' : `Receive ${fmtIDR(shownTotal(total, rates))}`}
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}
