import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import ActivityBookingModal, { activityPaidTotal } from '../components/ActivityBookingModal';
import ActivityPaymentModal from '../components/ActivityPaymentModal';

const CATEGORIES = ['tour', 'transport', 'wellness', 'other'];
const CAT_ICONS = { tour: '🥾', transport: '🚐', wellness: '🧘', other: '📦' };
const STATUSES = ['requested', 'confirmed', 'completed', 'cancelled', 'no_show'];
const STATUS_BADGE = { requested: 'amber', confirmed: 'blue', completed: 'green', cancelled: 'gray', no_show: 'red' };
const EMPTY_ACTIVITY_FORM = { name: '', category: 'tour', price: '', duration_minutes: '', capacity_per_slot: '', description: '', is_available: true, tax_mode: 'added' };
// How service charge + tax work for an activity (migration 078).
const TAX_MODES = [
  { key: 'added',    label: 'Added on top (price is before tax)', short: '++', hint: 'Like rooms: service charge and tax are added to the price. Usual for things the hotel runs itself.' },
  { key: 'included', label: 'Included in the price (all-in)',     short: 'nett', hint: 'The guest pays the price, nothing more. The service and tax inside it are worked out for the reports. Usual for vendor tours resold under the hotel name.' },
  { key: 'none',     label: 'No service charge or tax',           short: 'no tax', hint: 'The guest pays the price and none of it is counted as service or tax. Ask your accountant which fits.' },
];
function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function Activities() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [tab, setTab] = useState('bookings');
  const [activities, setActivities] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [payingActivity, setPayingActivity] = useState(null);
  const [summary, setSummary] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const [activityModal, setActivityModal] = useState(null); // { mode: 'add'|'edit', id? }
  const [activityForm, setActivityForm] = useState(EMPTY_ACTIVITY_FORM);
  const [bookingModal, setBookingModal] = useState(false);

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
      tax_mode: a.tax_mode || 'added',
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
      tax_mode: activityForm.tax_mode,
    };
    if (activityModal.mode === 'add') {
      await api.post('/api/activities', payload);
    } else {
      await api.put(`/api/activities/${activityModal.id}`, { ...payload, is_available: activityForm.is_available });
    }
    setActivityModal(null);
    loadActivities();
  }

  function openNewBooking() { setBookingModal(true); }

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
                      <td>
                        {fmtIDR(activityPaidTotal(b))}
                        {(parseFloat(b.service_charge_amount) > 0 || parseFloat(b.tax_amount) > 0) && <div className="text-muted" style={{ fontSize: 11 }}>incl. tax</div>}
                      </td>
                      <td><span className={`badge badge-${STATUS_BADGE[b.status]}`}>{b.status}</span></td>
                      <td>
                        <div className="flex gap-2">
                          {b.status === 'requested' && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'confirmed')}>Confirm</button>}
                          {b.status === 'confirmed' && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'completed')}>Complete</button>}
                          {b.status === 'confirmed' && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'no_show')}>No-show</button>}
                          {['requested', 'confirmed'].includes(b.status) && <button className="btn btn-sm btn-secondary" onClick={() => setBookingStatus(b, 'cancelled')}>Cancel</button>}
                          {!b.payment_method && !['cancelled', 'no_show'].includes(b.status) && (
                            <button className="btn btn-sm btn-primary" onClick={() => setPayingActivity(b)} title="Booked as not paid yet — charge it to the room or record it paid">Take payment</button>
                          )}
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
                      <td>{fmtIDR(a.price)} <span className="badge badge-gray" style={{ fontSize: 10 }} title={TAX_MODES.find(m => m.key === (a.tax_mode || 'added'))?.label}>{TAX_MODES.find(m => m.key === (a.tax_mode || 'added'))?.short}</span></td>
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
              <div className="form-group">
                <label className="form-label">Service charge &amp; tax</label>
                <select className="form-select" value={activityForm.tax_mode} onChange={e => setActivityForm(f => ({ ...f, tax_mode: e.target.value }))}>
                  {TAX_MODES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {TAX_MODES.find(m => m.key === activityForm.tax_mode)?.hint} Applies to new bookings.
                </div>
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

      {payingActivity && (
        <ActivityPaymentModal activityBooking={payingActivity} onClose={() => setPayingActivity(null)}
          onDone={() => { setPayingActivity(null); loadBookings(); loadSummary(); }} />
      )}
      {bookingModal && (
        <ActivityBookingModal onClose={() => setBookingModal(false)}
          onDone={() => { setBookingModal(false); loadBookings(); loadSummary(); }} />
      )}
    </div>
  );
}
