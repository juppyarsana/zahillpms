import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import api from '../services/api';

const CATEGORIES = ['tour', 'transport', 'wellness', 'other'];
const CAT_ICONS = { tour: '🥾', transport: '🚐', wellness: '🧘', other: '📦' };
const STATUSES = ['requested', 'confirmed', 'completed', 'cancelled', 'no_show'];
const STATUS_BADGE = { requested: 'amber', confirmed: 'blue', completed: 'green', cancelled: 'gray', no_show: 'red' };
const EMPTY_ACTIVITY_FORM = { name: '', category: 'tour', price: '', duration_minutes: '', capacity_per_slot: '', description: '', is_available: true };
const EMPTY_BOOKING_FORM = { activity_id: '', scheduled_date: '', scheduled_time: '', num_participants: 1, guest_name: '', guest_phone: '', payment_method: '', pickup_location: '', notes: '', booking_id: '' };
// Reservation statuses a staff desk activity booking can reasonably link
// to — excludes cancelled/no_show (never had or lost the stay) and
// checked_out (stay already over); pending/deposit_paid are included so
// staff can book ahead of a guest's arrival, not just once checked in.
const LINKABLE_STATUSES = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function Activities() {
  const { user } = useAuth();
  const { paymentMethods } = useSettings();
  const activePaymentMethods = paymentMethods.filter(m => m.is_active);
  function defaultPaymentMethod() { return activePaymentMethods[0]?.id || ''; }
  const isOwner = user?.role === 'owner';

  const [tab, setTab] = useState('bookings');
  const [activities, setActivities] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [summary, setSummary] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const [activityModal, setActivityModal] = useState(null); // { mode: 'add'|'edit', id? }
  const [activityForm, setActivityForm] = useState(EMPTY_ACTIVITY_FORM);
  const [bookingModal, setBookingModal] = useState(false);
  const [bookingForm, setBookingForm] = useState(EMPTY_BOOKING_FORM);
  const [error, setError] = useState('');

  // Reservation picker (optional) for the New Activity Booking modal — lets
  // staff link the activity to an existing guest's stay instead of typing a
  // walk-up name, so it shows the real guest and can be charged to the room.
  const [guestQueryInput, setGuestQueryInput] = useState('');
  const [guestQuery, setGuestQuery] = useState(''); // debounced
  const [guestResults, setGuestResults] = useState([]);
  const [searchingGuest, setSearchingGuest] = useState(false);
  const [pickedReservation, setPickedReservation] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setGuestQuery(guestQueryInput.trim()), 300);
    return () => clearTimeout(t);
  }, [guestQueryInput]);
  useEffect(() => {
    if (!bookingModal || !guestQuery) { setGuestResults([]); return; }
    let cancelled = false;
    setSearchingGuest(true);
    api.get('/api/bookings', { params: { q: guestQuery } }).then(r => {
      if (cancelled) return;
      setGuestResults(r.data.filter(b => LINKABLE_STATUSES.includes(b.status)));
    }).finally(() => { if (!cancelled) setSearchingGuest(false); });
    return () => { cancelled = true; };
  }, [guestQuery, bookingModal]);

  function pickReservation(b) {
    setPickedReservation(b);
    setBookingForm(f => ({ ...f, booking_id: b.id, guest_name: '', guest_phone: '' }));
    setGuestQueryInput('');
    setGuestQuery('');
    setGuestResults([]);
  }
  function clearReservation() {
    setPickedReservation(null);
    setBookingForm(f => ({ ...f, booking_id: '', payment_method: f.payment_method === 'room_charge' ? defaultPaymentMethod() : f.payment_method }));
  }

  async function loadActivities() { const r = await api.get('/api/activities'); setActivities(r.data); }
  async function loadBookings() {
    const params = {};
    if (statusFilter) params.status = statusFilter;
    if (dateFilter) params.date = dateFilter;
    const r = await api.get('/api/activities/bookings', { params });
    setBookings(r.data);
  }
  async function loadSummary() {
    if (!isOwner) return;
    const now = new Date();
    const r = await api.get('/api/activities/bookings/summary', { params: { month: now.getMonth() + 1, year: now.getFullYear() } });
    setSummary(r.data);
  }

  useEffect(() => { loadActivities(); loadSummary(); }, []);
  useEffect(() => { loadBookings(); }, [statusFilter, dateFilter]);

  function openAddActivity() { setActivityForm(EMPTY_ACTIVITY_FORM); setActivityModal({ mode: 'add' }); }
  function openEditActivity(a) {
    setActivityForm({
      name: a.name, category: a.category, price: a.price, duration_minutes: a.duration_minutes ?? '',
      capacity_per_slot: a.capacity_per_slot ?? '', description: a.description || '', is_available: a.is_available,
    });
    setActivityModal({ mode: 'edit', id: a.id });
  }
  async function saveActivity() {
    if (!activityForm.name || !activityForm.price) return;
    const payload = {
      name: activityForm.name, category: activityForm.category, price: activityForm.price,
      description: activityForm.description,
      duration_minutes: activityForm.duration_minutes === '' ? null : parseInt(activityForm.duration_minutes),
      capacity_per_slot: activityForm.capacity_per_slot === '' ? null : parseInt(activityForm.capacity_per_slot),
    };
    if (activityModal.mode === 'add') {
      await api.post('/api/activities', payload);
    } else {
      await api.put(`/api/activities/${activityModal.id}`, { ...payload, is_available: activityForm.is_available });
    }
    setActivityModal(null);
    loadActivities();
  }

  function openNewBooking() {
    setBookingForm({ ...EMPTY_BOOKING_FORM, payment_method: defaultPaymentMethod() });
    setError('');
    setPickedReservation(null);
    setGuestQueryInput('');
    setGuestQuery('');
    setGuestResults([]);
    setBookingModal(true);
  }
  async function saveBooking() {
    if (!bookingForm.activity_id || !bookingForm.scheduled_date) { setError('Activity and date are required'); return; }
    setError('');
    try {
      await api.post('/api/activities/bookings', bookingForm);
      setBookingModal(false);
      loadBookings();
      loadSummary();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create booking');
    }
  }

  async function downloadReceipt(b) {
    try {
      const r = await api.get(`/api/activities/bookings/${b.id}/receipt`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `activity-receipt-${b.id.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      alert('Failed to download receipt');
    }
  }

  async function setBookingStatus(b, status) {
    try {
      await api.patch(`/api/activities/bookings/${b.id}/status`, { status });
      loadBookings();
      loadSummary();
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not update booking');
    }
  }

  const totalRevenue = summary.filter(s => ['confirmed', 'completed'].includes(s.status)).reduce((sum, s) => sum + parseFloat(s.total), 0);
  const requestedCount = summary.find(s => s.status === 'requested')?.count || 0;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Activities</h1>
      </div>

      <div className="tab-bar">
        <button className={`tab-bar-item${tab === 'bookings' ? ' active' : ''}`} onClick={() => setTab('bookings')}>Bookings</button>
        <button className={`tab-bar-item${tab === 'catalog' ? ' active' : ''}`} onClick={() => setTab('catalog')}>Catalog</button>
      </div>

      {tab === 'bookings' && (
        <div>
          {isOwner && (
            <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              <div className="stat-card">
                <div className="stat-label">This month's revenue</div>
                <div className="stat-value" style={{ fontSize: 24 }}>{fmtIDR(totalRevenue)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Pending requests</div>
                <div className="stat-value" style={{ fontSize: 24, color: requestedCount > 0 ? '#B45309' : undefined }}>{requestedCount}</div>
              </div>
            </div>
          )}

          <div className="flex gap-2" style={{ marginBottom: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="flex gap-2">
              <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className="form-input" type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={openNewBooking}>+ New Booking</button>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Activity</th><th>Guest</th><th>Pax</th><th>Total</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {bookings.map(b => (
                    <tr key={b.id}>
                      <td>{String(b.scheduled_date).slice(0, 10)}{b.scheduled_time ? ` ${b.scheduled_time.slice(0, 5)}` : ''}</td>
                      <td style={{ fontWeight: 600 }}>{CAT_ICONS[b.activity_category]} {b.activity_name}</td>
                      <td>{b.room_guest_name || b.guest_name || '—'}{b.unit_name ? ` (${b.unit_name})` : ''}</td>
                      <td>{b.num_participants}</td>
                      <td>{fmtIDR(b.total_amount)}</td>
                      <td><span className={`badge badge-${STATUS_BADGE[b.status]}`}>{b.status}</span></td>
                      <td>
                        <div className="flex gap-2">
                          {b.status === 'requested' && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'confirmed')}>Confirm</button>}
                          {b.status === 'confirmed' && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'completed')}>Complete</button>}
                          {b.status === 'confirmed' && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'no_show')}>No-show</button>}
                          {['requested', 'confirmed'].includes(b.status) && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'cancelled')}>Cancel</button>}
                          {b.payment_method && b.payment_method !== 'room_charge' && !['cancelled', 'no_show'].includes(b.status) && (
                            <button className="btn btn-sm btn-secondary" onClick={() => downloadReceipt(b)} title="Paid directly — print a receipt separate from the room invoice">🖨 Receipt</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {bookings.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No bookings found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'catalog' && (
        <div>
          {isOwner && (
            <div className="flex" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={openAddActivity}>+ Add Activity</button>
            </div>
          )}
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Duration</th><th>Capacity/Slot</th><th>Available</th>{isOwner && <th></th>}</tr></thead>
                <tbody>
                  {activities.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td>{CAT_ICONS[a.category]} {a.category}</td>
                      <td>{fmtIDR(a.price)}</td>
                      <td>{a.duration_minutes ? `${a.duration_minutes} min` : '—'}</td>
                      <td>{a.capacity_per_slot ?? 'Unlimited'}</td>
                      <td><span className={`badge badge-${a.is_available ? 'green' : 'gray'}`}>{a.is_available ? 'Yes' : 'No'}</span></td>
                      {isOwner && <td><button className="btn btn-sm btn-secondary" onClick={() => openEditActivity(a)}>Edit</button></td>}
                    </tr>
                  ))}
                  {activities.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No activities yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activityModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{activityModal.mode === 'add' ? 'Add Activity' : 'Edit Activity'}</div>
              <button className="btn btn-icon" onClick={() => setActivityModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={activityForm.name} onChange={e => setActivityForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Category</label>
                  <select className="form-select" value={activityForm.category} onChange={e => setActivityForm(f => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Price (IDR) *</label><input className="form-input" type="number" value={activityForm.price} onChange={e => setActivityForm(f => ({ ...f, price: e.target.value }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Duration (minutes)</label><input className="form-input" type="number" value={activityForm.duration_minutes} onChange={e => setActivityForm(f => ({ ...f, duration_minutes: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Capacity per Slot</label><input className="form-input" type="number" value={activityForm.capacity_per_slot} onChange={e => setActivityForm(f => ({ ...f, capacity_per_slot: e.target.value }))} placeholder="Leave blank for unlimited" /></div>
              </div>
              <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={activityForm.description} onChange={e => setActivityForm(f => ({ ...f, description: e.target.value }))} /></div>
              {activityModal.mode === 'edit' && (
                <div className="form-group">
                  <label className="form-label flex gap-2 flex-center" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={activityForm.is_available} onChange={e => setActivityForm(f => ({ ...f, is_available: e.target.checked }))} />
                    Available for booking
                  </label>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActivityModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveActivity}>{activityModal.mode === 'add' ? 'Add Activity' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {bookingModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">New Activity Booking</div>
              <button className="btn btn-icon" onClick={() => setBookingModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="text-red" style={{ marginBottom: 8, fontSize: 13 }}>{error}</div>}
              <div className="form-group"><label className="form-label">Activity *</label>
                <select className="form-select" value={bookingForm.activity_id} onChange={e => setBookingForm(f => ({ ...f, activity_id: e.target.value }))}>
                  <option value="">Select an activity</option>
                  {activities.filter(a => a.is_available).map(a => <option key={a.id} value={a.id}>{a.name} — {fmtIDR(a.price)}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Date *</label><input className="form-input" type="date" value={bookingForm.scheduled_date} onChange={e => setBookingForm(f => ({ ...f, scheduled_date: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Time</label><input className="form-input" type="time" value={bookingForm.scheduled_time} onChange={e => setBookingForm(f => ({ ...f, scheduled_time: e.target.value }))} /></div>
              </div>
              <div className="form-group"><label className="form-label">Participants</label><input className="form-input" type="number" min="1" value={bookingForm.num_participants} onChange={e => setBookingForm(f => ({ ...f, num_participants: e.target.value }))} /></div>

              <div className="form-group">
                <label className="form-label">Guest</label>
                {pickedReservation ? (
                  <div className="flex items-center gap-2" style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{pickedReservation.guest_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {pickedReservation.unit_name} · {String(pickedReservation.check_in_date).slice(0, 10)} → {String(pickedReservation.check_out_date).slice(0, 10)}
                      </div>
                    </div>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={clearReservation}>✕ Change</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      value={guestQueryInput}
                      onChange={e => setGuestQueryInput(e.target.value)}
                      placeholder="Search a reservation by guest name (optional)…"
                    />
                    {guestQueryInput && (
                      <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 220, overflowY: 'auto', padding: 4, marginTop: 2 }}>
                        {searchingGuest ? (
                          <div style={{ padding: 8, fontSize: 13, color: 'var(--text-muted)' }}>Searching…</div>
                        ) : guestResults.length === 0 ? (
                          <div style={{ padding: 8, fontSize: 13, color: 'var(--text-muted)' }}>No matching reservation — will book as a walk-up guest.</div>
                        ) : guestResults.map(b => (
                          <div
                            key={b.id}
                            onClick={() => pickReservation(b)}
                            style={{ padding: 8, cursor: 'pointer', borderRadius: 4 }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f3f4f6)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{b.guest_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {b.unit_name} · {String(b.check_in_date).slice(0, 10)} → {String(b.check_out_date).slice(0, 10)} · {b.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!pickedReservation && (
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Guest Name</label><input className="form-input" value={bookingForm.guest_name} onChange={e => setBookingForm(f => ({ ...f, guest_name: e.target.value }))} placeholder="Walk-up guest (no room booking)" /></div>
                  <div className="form-group"><label className="form-label">Guest Phone</label><input className="form-input" value={bookingForm.guest_phone} onChange={e => setBookingForm(f => ({ ...f, guest_phone: e.target.value }))} /></div>
                </div>
              )}
              <div className="form-group"><label className="form-label">Pickup Location</label><input className="form-input" value={bookingForm.pickup_location} onChange={e => setBookingForm(f => ({ ...f, pickup_location: e.target.value }))} placeholder="For transport / pickup activities" /></div>
              <div className="form-group"><label className="form-label">Payment Method</label>
                <select className="form-select" value={bookingForm.payment_method} onChange={e => setBookingForm(f => ({ ...f, payment_method: e.target.value }))}>
                  <option value="">Not specified</option>
                  {activePaymentMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  {pickedReservation && <option value="room_charge">Room Charge</option>}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={bookingForm.notes} onChange={e => setBookingForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setBookingModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBooking}>Create Booking</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
