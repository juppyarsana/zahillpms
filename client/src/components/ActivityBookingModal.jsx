import { useState, useEffect } from 'react';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';

// New Activity Booking — shared by the Activities page and the reservation's
// Activities tab ("+ Book activity"). With `reservation` the guest is fixed
// and Room Charge is the default; without it staff can search a reservation
// or book a walk-up guest.
//
// Service charge + tax follow each activity's setting (migration 078):
//   added     — before tax, like rooms: charged to the room the folio adds
//               them at checkout; paid directly they're added now
//   included  — all-in price, the guest pays exactly the price
//   none      — no service charge or tax

// Reservation statuses a staff desk activity booking can reasonably link
// to — excludes cancelled/no_show (never had or lost the stay) and
// checked_out (stay already over); pending/deposit_paid are included so
// staff can book ahead of a guest's arrival, not just once checked in.
const LINKABLE_STATUSES = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
const HIDDEN_PAY_METHODS = ['ota_managed'];
const EMPTY = { activity_id: '', scheduled_date: '', scheduled_time: '', num_participants: 1, guest_name: '', guest_phone: '', payment_method: '', pickup_location: '', notes: '', booking_id: '' };

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const ymd = d => String(d || '').slice(0, 10);

// What the guest pays for an activity booking row: the price, plus service +
// tax when they were added on top at booking (paid directly, 'added').
export function activityPaidTotal(b) {
  const extra = (b.tax_mode || 'added') === 'added' ? parseFloat(b.service_charge_amount || 0) + parseFloat(b.tax_amount || 0) : 0;
  return parseFloat(b.total_amount || 0) + extra;
}

export default function ActivityBookingModal({ reservation, onClose, onDone }) {
  const { paymentMethods, branding } = useSettings();
  const methods = paymentMethods.filter(m => m.is_active && !HIDDEN_PAY_METHODS.includes(m.id));
  const [activities, setActivities] = useState([]);
  const [form, setForm] = useState({
    ...EMPTY,
    booking_id: reservation?.id || '',
    payment_method: reservation ? 'room_charge' : (methods[0]?.id || ''),
    scheduled_date: reservation && reservation.status === 'checked_in' ? '' : ymd(reservation?.check_in_date),
  });
  const [picked, setPicked] = useState(reservation || null);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  useEffect(() => { api.get('/api/activities').then(r => setActivities(r.data.filter(a => a.is_available))); }, []);
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(t);
  }, [queryInput]);
  useEffect(() => {
    if (reservation || !query) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    api.get('/api/bookings', { params: { q: query } }).then(r => {
      if (!cancelled) setResults(r.data.filter(b => LINKABLE_STATUSES.includes(b.status)));
    }).finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [query, reservation]);

  function pick(b) {
    setPicked(b);
    set({ booking_id: b.id, guest_name: '', guest_phone: '' });
    setQueryInput(''); setQuery(''); setResults([]);
  }
  function unpick() {
    setPicked(null);
    setForm(f => ({ ...f, booking_id: '', payment_method: f.payment_method === 'room_charge' ? (methods[0]?.id || '') : f.payment_method }));
  }

  const activity = activities.find(a => a.id === form.activity_id);
  const pax = parseInt(form.num_participants) || 0;
  const net = activity ? parseFloat(activity.price) * pax : 0;
  const paidNow = !!form.payment_method && form.payment_method !== 'room_charge';
  const mode = activity?.tax_mode || 'added';
  const scRate = parseFloat(branding?.service_charge_rate || 0);
  const taxRate = parseFloat(branding?.tax_rate || 0);
  const addOnTop = paidNow && mode === 'added';
  const sc = addOnTop ? round2(net * scRate / 100) : 0;
  const tax = addOnTop ? round2((net + sc) * taxRate / 100) : 0;
  const gross = round2(net + sc + tax);
  const hasRates = scRate > 0 || taxRate > 0;

  async function save() {
    if (!form.activity_id || !form.scheduled_date) { setError('Activity and date are required'); return; }
    if (pax < 1) { setError('At least 1 participant'); return; }
    setError(''); setSaving(true);
    try {
      const { data } = await api.post('/api/activities/bookings', form);
      onDone?.(data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create booking');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{reservation ? `Book activity — ${reservation.guest_name}` : 'New Activity Booking'}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
          <div className="form-group"><label className="form-label">Activity *</label>
            <select className="form-select" value={form.activity_id} onChange={e => set({ activity_id: e.target.value })}>
              <option value="">Select an activity</option>
              {activities.map(a => <option key={a.id} value={a.id}>{a.name} — {fmtIDR(a.price)}</option>)}
            </select>
            {activities.length === 0 && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>No activities yet — add them on the Activities page (Catalog).</div>}
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Date *</label>
              <input className="form-input" type="date" value={form.scheduled_date} onChange={e => set({ scheduled_date: e.target.value })} />
              {reservation && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>Stay: {ymd(reservation.check_in_date)} → {ymd(reservation.check_out_date)}</div>}
            </div>
            <div className="form-group"><label className="form-label">Time</label><input className="form-input" type="time" value={form.scheduled_time} onChange={e => set({ scheduled_time: e.target.value })} /></div>
          </div>
          <div className="form-group"><label className="form-label">Participants</label><input className="form-input" type="number" min="1" value={form.num_participants} onChange={e => set({ num_participants: e.target.value })} style={{ width: 100 }} /></div>

          {!reservation && (
            <div className="form-group">
              <label className="form-label">Guest</label>
              {picked ? (
                <div className="flex items-center gap-2" style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{picked.guest_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{picked.unit_name} · {ymd(picked.check_in_date)} → {ymd(picked.check_out_date)}</div>
                  </div>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={unpick}>✕ Change</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input className="form-input" value={queryInput} onChange={e => setQueryInput(e.target.value)}
                    placeholder="Search a reservation by guest name (optional)…" />
                  {queryInput && (
                    <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 220, overflowY: 'auto', padding: 4, marginTop: 2 }}>
                      {searching ? (
                        <div style={{ padding: 8, fontSize: 13, color: 'var(--text-muted)' }}>Searching…</div>
                      ) : results.length === 0 ? (
                        <div style={{ padding: 8, fontSize: 13, color: 'var(--text-muted)' }}>No matching reservation — will book as a walk-up guest.</div>
                      ) : results.map(b => (
                        <div key={b.id} onClick={() => pick(b)} style={{ padding: 8, cursor: 'pointer', borderRadius: 4 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f3f4f6)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{b.guest_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.unit_name} · {ymd(b.check_in_date)} → {ymd(b.check_out_date)} · {b.status}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {!picked && (
            <div className="form-row">
              <div className="form-group"><label className="form-label">Guest Name</label><input className="form-input" value={form.guest_name} onChange={e => set({ guest_name: e.target.value })} placeholder="Walk-up guest (no room booking)" /></div>
              <div className="form-group"><label className="form-label">Guest Phone</label><input className="form-input" value={form.guest_phone} onChange={e => set({ guest_phone: e.target.value })} /></div>
            </div>
          )}
          <div className="form-group"><label className="form-label">Pickup Location</label><input className="form-input" value={form.pickup_location} onChange={e => set({ pickup_location: e.target.value })} placeholder="For transport / pickup activities" /></div>
          <div className="form-group"><label className="form-label">Payment</label>
            <select className="form-select" value={form.payment_method} onChange={e => set({ payment_method: e.target.value })}>
              {picked && <option value="room_charge">Charge to room</option>}
              {methods.map(m => <option key={m.id} value={m.id}>Paid now — {m.label}</option>)}
              <option value="">Not paid yet</option>
            </select>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.notes} onChange={e => set({ notes: e.target.value })} /></div>

          {activity && pax > 0 && (
            <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 13 }}>
              <div className="flex-between"><span>{activity.name} × {pax}</span><span>{fmtIDR(net)}</span></div>
              {paidNow && sc > 0 && <div className="flex-between text-muted"><span>Service charge ({scRate}%)</span><span>{fmtIDR(sc)}</span></div>}
              {paidNow && tax > 0 && <div className="flex-between text-muted"><span>Tax ({taxRate}%)</span><span>{fmtIDR(tax)}</span></div>}
              <div className="flex-between" style={{ fontWeight: 700, marginTop: 4 }}>
                <span>{paidNow ? 'Total to collect now' : form.payment_method === 'room_charge' ? 'Charged to the room' : 'Total'}</span>
                <span>{fmtIDR(paidNow ? gross : net)}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                {mode === 'included' && hasRates && <>Price includes service charge &amp; tax. </>}
                {mode === 'none' && hasRates && <>No service charge or tax on this activity. </>}
                {form.payment_method === 'room_charge'
                  ? (mode === 'added' && hasRates ? 'Goes on the folio; service charge and tax are added there, like the room.' : 'Goes on the folio at this price.')
                  : paidNow && picked
                    ? 'Also listed on the guest\'s folio as paid, so their bill is complete.'
                    : paidNow ? 'A receipt can be printed from the Activities page.'
                      : 'No payment recorded, and nothing goes on the folio.'}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Booking…' : 'Create Booking'}</button>
        </div>
      </div>
    </div>
  );
}
