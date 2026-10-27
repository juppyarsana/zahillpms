import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import Icon from '../components/Icon';
import ReasonModal from '../components/ReasonModal';
import { useSettings } from '../context/SettingsContext';
import { propertyToday } from '../lib/propertyTime';

// Finance → Vendor payouts (migration 140): the vendors who run the hotel's
// tours / transport, what each trip owes them, and the money paid (cash by
// accounting). Owner or the `vendors` permission.

const idr = n => n == null ? '—' : 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const fmtDate = d => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const errText = err => err.response?.data?.error || err.message || 'Something went wrong';
const STATUS = { confirmed: ['Confirmed', 'blue'], completed: ['Completed', 'green'], cancelled: ['Cancelled', 'gray'], no_show: ['No-show', 'red'] };

async function openPdf(url) {
  const r = await api.get(url, { responseType: 'blob' });
  const blobUrl = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
  const w = window.open(blobUrl, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = blobUrl; a.download = url.split('/').slice(-2, -1)[0] + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

export default function VendorPayouts() {
  const [tab, setTab] = useState('vendors');
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState('');
  const [vendorEdit, setVendorEdit] = useState(null);   // {} new | vendor
  const [paying, setPaying] = useState(null);           // vendor
  const [tripVendor, setTripVendor] = useState('');

  const loadVendors = () => api.get('/api/vendors').then(r => setVendors(r.data)).catch(e => setError(errText(e)));
  useEffect(() => { loadVendors(); }, []);

  const totals = useMemo(() => ({
    due: vendors.reduce((s, v) => s + v.due_now, 0),
    upcoming: vendors.reduce((s, v) => s + v.owed_upcoming, 0),
    toSet: vendors.reduce((s, v) => s + v.to_set, 0),
  }), [vendors]);

  function showTrips(v, show) { setTripVendor({ id: v?.id || '', show: show || 'open' }); setTab('trips'); }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Vendor payouts</div>
          <div className="page-subtitle">Tours and transport run by outside vendors — what each trip owes them and what has been paid · <Link to="/guide/vendor-payouts">📘 Guide</Link></div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => setVendorEdit({})}><Icon name="plus" size={15} /> Add vendor</button>
        </div>
      </div>
      <div className="tab-bar">
        {[['vendors', 'Vendors'], ['trips', 'Trips'], ['payouts', 'Payouts']].map(([k, l]) => (
          <button key={k} className={`tab-bar-item${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {l}{k === 'trips' && totals.toSet > 0 && <span className="tab-count">{totals.toSet}</span>}
          </button>
        ))}
      </div>
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}><div>{error}</div></div>}

      {tab === 'vendors' && (
        <>
          <div className="stat-grid stat-grid-money" style={{ margin: '12px 0' }}>
            <div className="stat-card"><div className="stat-label">Owed for trips done</div><div className="stat-value">{idr(totals.due)}</div></div>
            <div className="stat-card"><div className="stat-label">Upcoming trips</div><div className="stat-value">{idr(totals.upcoming)}</div></div>
            <div className="stat-card"><div className="stat-label">Vendor prices to set</div>
              <div className="stat-value" style={{ color: totals.toSet ? '#B45309' : undefined }}>{totals.toSet}</div></div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table style={{ minWidth: 760 }}>
                <thead><tr><th>Vendor</th><th>Contact</th><th style={{ textAlign: 'right' }}>Owed now</th><th style={{ textAlign: 'right' }}>Upcoming</th><th>Oldest unpaid</th><th></th></tr></thead>
                <tbody>
                  {vendors.map(v => (
                    <tr key={v.id} style={{ opacity: v.is_active ? 1 : 0.55 }}>
                      <td style={{ fontWeight: 600 }}>{v.name}
                        {v.to_set > 0 && <div><button style={{ fontSize: 12, color: "#B45309", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }} onClick={() => showTrips(v, 'to_set')}>{v.to_set} price{v.to_set > 1 ? 's' : ''} to set</button></div>}
                      </td>
                      <td className="text-muted" style={{ fontSize: 13 }}>{[v.contact_name, v.contact_phone].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{idr(v.due_now)}{v.balance < -0.004 && <div className="text-muted" style={{ fontSize: 11 }}>paid ahead {idr(-v.balance)}</div>}</td>
                      <td style={{ textAlign: 'right' }}>{idr(v.owed_upcoming)}</td>
                      <td>{v.oldest_open ? fmtDate(v.oldest_open) : '—'}</td>
                      <td>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          {v.trips_open > 0 && <button className="btn btn-sm btn-primary" onClick={() => setPaying(v)}>Pay</button>}
                          <button className="btn btn-sm btn-secondary" onClick={() => showTrips(v, 'all')}>Trips</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setVendorEdit(v)}>Edit</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!vendors.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                    No vendors yet. Add one, then choose it on the activity in Activities → Catalog → Edit.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'trips' && <TripsTab vendors={vendors} initial={tripVendor} onChanged={loadVendors} onPay={v => setPaying(v)} />}
      {tab === 'payouts' && <PayoutsTab vendors={vendors} onChanged={loadVendors} />}

      {vendorEdit && <VendorModal vendor={vendorEdit} onClose={() => setVendorEdit(null)} onSaved={() => { setVendorEdit(null); loadVendors(); }} />}
      {paying && <PayModal vendor={paying} onClose={() => setPaying(null)} onSaved={() => { loadVendors(); }} />}
    </div>
  );
}

function TripsTab({ vendors, initial, onChanged, onPay }) {
  const [supplierId, setSupplierId] = useState(initial?.id || '');
  const [show, setShow] = useState(initial?.show || 'open');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [trips, setTrips] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get('/api/vendors/trips', { params: { supplier_id: supplierId || undefined, show, from: from || undefined, to: to || undefined } })
    .then(r => setTrips(r.data)).catch(e => setError(errText(e)));
  useEffect(() => { load(); }, [supplierId, show, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendor = vendors.find(v => v.id === supplierId);
  const totalLeft = trips.reduce((s, t) => s + t.remaining, 0);

  return (
    <>
      <div className="page-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select className="form-select" style={{ width: 'auto' }} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="seg">
          {[['open', 'Not paid'], ['to_set', 'Price to set'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={show === k ? 'active' : ''} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
        <input className="form-input" type="date" style={{ width: 'auto' }} value={from} onChange={e => setFrom(e.target.value)} title="From" />
        <input className="form-input" type="date" style={{ width: 'auto' }} value={to} onChange={e => setTo(e.target.value)} title="To" />
        <div className="page-toolbar-end">
          {vendor && vendor.trips_open > 0 && <button className="btn btn-primary btn-sm" onClick={() => onPay(vendor)}>Pay {vendor.name}</button>}
        </div>
      </div>
      {error && <div className="alert alert-danger"><div>{error}</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 860 }}>
            <thead><tr><th>Date</th><th>Activity</th><th>Guest</th><th>Pax</th><th>Vendor</th><th>Status</th>
              <th style={{ textAlign: 'right' }}>For the vendor</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Left</th><th></th></tr></thead>
            <tbody>
              {trips.map(t => (
                <tr key={t.id}>
                  <td>{fmtDate(t.scheduled_date)}{t.scheduled_time ? ` ${t.scheduled_time.slice(0, 5)}` : ''}</td>
                  <td style={{ fontWeight: 600 }}>{t.activity_name}<div className="text-muted" style={{ fontSize: 11, fontWeight: 400 }}>guest paid {idr(t.total_amount)}</div></td>
                  <td>{[t.unit_name, t.guest_name].filter(Boolean).join(' · ')}</td>
                  <td>{t.num_participants}</td>
                  <td>{t.supplier_name}</td>
                  <td><span className={`badge badge-${STATUS[t.status]?.[1] || 'gray'}`}>{STATUS[t.status]?.[0] || t.status}</span>
                    {['cancelled', 'no_show'].includes(t.status) && t.owed_if_cancelled && <div style={{ fontSize: 11 }}>vendor fee owed</div>}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.amount == null ? <span style={{ color: '#B45309' }}>to set</span> : idr(t.amount)}
                    {t.edited_by_name && <div className="text-muted" style={{ fontSize: 11, fontWeight: 400 }}>changed by {t.edited_by_name}</div>}</td>
                  <td style={{ textAlign: 'right' }}>{t.paid > 0 ? idr(t.paid) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{t.remaining > 0 ? idr(t.remaining) : t.overpaid > 0 ? <span style={{ color: '#B91C1C' }}>paid {idr(t.overpaid)} too much</span> : '—'}</td>
                  <td><button className="btn btn-sm btn-secondary" onClick={() => setEditing(t)}>Edit</button></td>
                </tr>
              ))}
              {!trips.length && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No trips</td></tr>}
              {trips.length > 0 && totalLeft > 0 && <tr><td colSpan={8} style={{ textAlign: 'right', fontWeight: 600 }}>Left to pay</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{idr(totalLeft)}</td><td /></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <TripModal trip={editing} vendors={vendors} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); onChanged(); }} />}
    </>
  );
}

function TripModal({ trip, vendors, onClose, onSaved }) {
  const [amount, setAmount] = useState(trip.amount == null ? '' : String(trip.amount));
  const [owedIfCancelled, setOwedIfCancelled] = useState(!!trip.owed_if_cancelled);
  const [note, setNote] = useState(trip.note || '');
  const [addVendor, setAddVendor] = useState({ supplier_id: '', amount: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelled = ['cancelled', 'no_show'].includes(trip.status);

  async function save() {
    setBusy(true); setError('');
    try {
      await api.put(`/api/vendors/trips/${trip.id}`, { amount: amount === '' ? null : amount, owed_if_cancelled: owedIfCancelled, note });
      if (addVendor.supplier_id) await api.post(`/api/vendors/bookings/${trip.activity_booking_id}`, addVendor);
      onSaved();
    } catch (e) { setError(errText(e)); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Take ${trip.supplier_name} off this trip?`)) return;
    setBusy(true); setError('');
    try { await api.delete(`/api/vendors/trips/${trip.id}`); onSaved(); } catch (e) { setError(errText(e)); setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">{trip.activity_name} — {fmtDate(trip.scheduled_date)}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            {[trip.unit_name, trip.guest_name].filter(Boolean).join(' · ')} · {trip.num_participants} pax · guest paid {idr(trip.total_amount)}
          </div>
          <div className="form-group">
            <label className="form-label">For {trip.supplier_name} (Rp)</label>
            <input className="form-input" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Type the vendor's price for this trip" />
            {trip.paid > 0 && <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Already paid {idr(trip.paid)} — it can't go lower than that.</div>}
          </div>
          {cancelled && (
            <label className="flex gap-2 flex-center" style={{ cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={owedIfCancelled} onChange={e => setOwedIfCancelled(e.target.checked)} />
              The trip was {trip.status === 'no_show' ? 'a no-show' : 'cancelled'} but the vendor is still owed this amount (a fee)
            </label>
          )}
          <div className="form-group"><label className="form-label">Note</label>
            <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. extra stop at Amed" /></div>
          <div className="form-group">
            <label className="form-label">Add another vendor to this trip (optional)</label>
            <div className="form-row">
              <select className="form-select" value={addVendor.supplier_id} onChange={e => setAddVendor(a => ({ ...a, supplier_id: e.target.value }))}>
                <option value="">—</option>
                {vendors.filter(v => v.id !== trip.supplier_id).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <input className="form-input" type="number" min="0" placeholder="Rp" value={addVendor.amount} onChange={e => setAddVendor(a => ({ ...a, amount: e.target.value }))} />
            </div>
          </div>
          {error && <div className="alert alert-danger"><div>{error}</div></div>}
        </div>
        <div className="modal-footer">
          {trip.paid === 0 && <button className="btn btn-secondary" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}>Take vendor off</button>}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function PayModal({ vendor, onClose, onSaved }) {
  const { paymentMethods } = useSettings();
  const methods = (paymentMethods || []).filter(m => m.is_active && !/ota/i.test(m.id));
  const today = propertyToday();
  const [trips, setTrips] = useState(null);
  const [pick, setPick] = useState({});      // line id → amount string
  const [total, setTotal] = useState('');
  const [method, setMethod] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get('/api/vendors/trips', { params: { supplier_id: vendor.id, show: 'open' } }).then(r => {
      const open = r.data.filter(t => t.remaining > 0);
      setTrips(open);
      // trips already done are ticked; upcoming ones can be ticked to pay ahead
      setPick(Object.fromEntries(open.filter(t => String(t.scheduled_date).slice(0, 10) <= today).map(t => [t.id, String(t.remaining)])));
    }).catch(e => setError(errText(e)));
  }, [vendor.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!method && methods.length) setMethod((methods.find(m => /cash|tunai/i.test(`${m.id} ${m.label}`)) || methods[0]).id); }, [methods.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = Object.values(pick).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  // An amount typed for the whole payment is spread over the ticked trips, oldest first.
  function spread(value) {
    setTotal(value);
    let left = parseFloat(value) || 0;
    const ids = (trips || []).filter(t => t.id in pick).map(t => t.id);
    const next = {};
    for (const id of ids) {
      const t = trips.find(x => x.id === id);
      const a = Math.min(t.remaining, left);
      next[id] = a > 0 ? String(Math.round(a * 100) / 100) : '0';
      left -= a;
    }
    setPick(next);
  }
  function toggle(t) {
    setTotal('');
    setPick(p => { const n = { ...p }; if (t.id in n) delete n[t.id]; else n[t.id] = String(t.remaining); return n; });
  }

  async function save() {
    const allocations = Object.entries(pick).map(([line_id, a]) => ({ line_id, amount: parseFloat(a) || 0 })).filter(a => a.amount > 0);
    if (!allocations.length) { setError('Tick the trips this payment is for'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/api/vendors/payouts', { supplier_id: vendor.id, paid_on: paidOn, method, reference, notes, allocations });
      setDone(data); onSaved();
    } catch (e) { setError(errText(e)); setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 720, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Pay {vendor.name}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        {done ? (
          <>
            <div className="modal-body">
              <div className="alert alert-success"><div>Payout {done.payout_no} of {idr(done.amount)} recorded. Print the slip for {vendor.name} to sign.</div></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => openPdf(`/api/vendors/payouts/${done.id}/pdf`).catch(e => setError(errText(e)))}><Icon name="download" size={15} /> Print slip</button>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              {!trips ? <div className="text-muted">Loading…</div> : (
                <div className="table-wrap" style={{ marginBottom: 12 }}>
                  <table style={{ minWidth: 560 }}>
                    <thead><tr><th></th><th>Date</th><th>Activity</th><th>Guest</th><th style={{ textAlign: 'right' }}>Left</th><th style={{ textAlign: 'right' }}>Pay now</th></tr></thead>
                    <tbody>
                      {trips.map(t => (
                        <tr key={t.id}>
                          <td><input type="checkbox" checked={t.id in pick} onChange={() => toggle(t)} /></td>
                          <td>{fmtDate(t.scheduled_date)}{String(t.scheduled_date).slice(0, 10) > today && <div className="text-muted" style={{ fontSize: 11 }}>upcoming</div>}</td>
                          <td>{t.activity_name}</td>
                          <td>{[t.unit_name, t.guest_name].filter(Boolean).join(' · ')}</td>
                          <td style={{ textAlign: 'right' }}>{idr(t.remaining)}</td>
                          <td style={{ textAlign: 'right', width: 140 }}>
                            {t.id in pick && <input className="form-input" type="number" min="0" style={{ textAlign: 'right' }} value={pick[t.id]}
                              onChange={e => { setTotal(''); setPick(p => ({ ...p, [t.id]: e.target.value })); }} />}
                          </td>
                        </tr>
                      ))}
                      {!trips.length && <tr><td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: 16 }}>Nothing left to pay</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="form-row">
                <div className="form-group"><label className="form-label">Amount paid (spreads over the ticked trips, oldest first)</label>
                  <input className="form-input" type="number" min="0" value={total} placeholder={String(Math.round(sum))} onChange={e => spread(e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Paid with</label>
                  <select className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
                    {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Date paid</label>
                  <input className="form-input" type="date" max={today} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Reference (optional)</label>
                  <input className="form-input" value={reference} onChange={e => setReference(e.target.value)} /></div>
              </div>
              <div className="form-group"><label className="form-label">Notes (optional)</label>
                <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
              {error && <div className="alert alert-danger"><div>{error}</div></div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || sum <= 0} onClick={save}>Pay {idr(sum)}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PayoutsTab({ vendors, onChanged }) {
  const [supplierId, setSupplierId] = useState('');
  const [rows, setRows] = useState([]);
  const [voiding, setVoiding] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get('/api/vendors/payouts', { params: { supplier_id: supplierId || undefined } }).then(r => setRows(r.data)).catch(e => setError(errText(e)));
  useEffect(() => { load(); }, [supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-toolbar">
        <select className="form-select" style={{ width: 'auto' }} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      {error && <div className="alert alert-danger"><div>{error}</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 720 }}>
            <thead><tr><th>No.</th><th>Date paid</th><th>Vendor</th><th>Trips</th><th>Paid with</th><th>By</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} style={p.is_voided ? { color: 'var(--text-muted)' } : undefined}>
                  <td style={p.is_voided ? { textDecoration: 'line-through' } : undefined}>{p.payout_no_text}</td>
                  <td>{fmtDate(p.paid_on)}</td>
                  <td>{p.supplier_name}{p.reference && <div className="text-muted" style={{ fontSize: 11 }}>ref {p.reference}</div>}</td>
                  <td>{p.trips}</td>
                  <td>{p.method_label}</td>
                  <td>{p.created_by_name || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, textDecoration: p.is_voided ? 'line-through' : undefined }}>{idr(p.amount)}
                    {p.is_voided && <div style={{ fontSize: 11, fontWeight: 400, textDecoration: 'none' }}>voided by {p.voided_by_name || '—'}: {p.void_reason}</div>}</td>
                  <td>
                    <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openPdf(`/api/vendors/payouts/${p.id}/pdf`).catch(e => setError(errText(e)))}>Slip</button>
                      {!p.is_voided && <button className="btn btn-sm btn-secondary" onClick={() => setVoiding(p)}>Void</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No payouts yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {voiding && (
        <ReasonModal title={`Void ${voiding.payout_no_text}`} confirmLabel="Void payout" danger onClose={() => setVoiding(null)}
          onConfirm={async reason => { await api.post(`/api/vendors/payouts/${voiding.id}/void`, { reason }); setVoiding(null); load(); onChanged(); }}>
          The {idr(voiding.amount)} paid to {voiding.supplier_name} is kept on the list, struck through, and its trips are owed again.
        </ReasonModal>
      )}
    </>
  );
}

function VendorModal({ vendor, onClose, onSaved }) {
  const isNew = !vendor.id;
  const [form, setForm] = useState({ name: vendor.name || '', contact_name: vendor.contact_name || '', contact_phone: vendor.contact_phone || '', contact_email: vendor.contact_email || '' });
  const [existing, setExisting] = useState([]);
  const [pickId, setPickId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (isNew) api.get('/api/vendors/suppliers').then(r => setExisting(r.data)).catch(() => {}); }, [isNew]);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  async function save() {
    setBusy(true); setError('');
    try {
      if (isNew && pickId) await api.post('/api/vendors', { supplier_id: pickId });
      else if (isNew) await api.post('/api/vendors', form);
      else await api.put(`/api/vendors/${vendor.id}`, form);
      onSaved();
    } catch (e) { setError(errText(e)); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Take ${vendor.name} off the vendor list? Its trips and payouts stay; it stays a supplier.`)) return;
    try { await api.delete(`/api/vendors/${vendor.id}`); onSaved(); } catch (e) { setError(errText(e)); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 460, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">{isNew ? 'Add vendor' : `Edit ${vendor.name}`}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {isNew && existing.length > 0 && (
            <div className="form-group">
              <label className="form-label">Already a supplier?</label>
              <select className="form-select" value={pickId} onChange={e => setPickId(e.target.value)}>
                <option value="">No — a new vendor</option>
                {existing.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {!pickId && (
            <>
              <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Kintamani Jeep Tours" /></div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Contact person</label><input className="form-input" value={form.contact_name} onChange={e => set({ contact_name: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">Phone / WhatsApp</label><input className="form-input" value={form.contact_phone} onChange={e => set({ contact_phone: e.target.value })} /></div>
              </div>
              <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={form.contact_email} onChange={e => set({ contact_email: e.target.value })} /></div>
            </>
          )}
          <div className="text-muted" style={{ fontSize: 12 }}>A vendor is one of the property's suppliers, ticked as running tours / transport — it also shows in Purchasing and Payables.</div>
          {error && <div className="alert alert-danger" style={{ marginTop: 8 }}><div>{error}</div></div>}
        </div>
        <div className="modal-footer">
          {!isNew && <button className="btn btn-secondary" style={{ marginRight: 'auto' }} onClick={remove}>Take off the list</button>}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || (!pickId && !form.name.trim())} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
