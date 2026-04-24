import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';

const SOURCE_BADGE = { direct: 'green', airbnb: 'pink', booking_com: 'blue', traveloka: 'badge-gray', walkin: 'blue' };
const STATUS_BADGE = { confirmed: 'green', pending: 'yellow', checked_in: 'blue', checked_out: 'gray', cancelled: 'red', no_show: 'red' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function BookingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(null);
  const [payForm, setPayForm] = useState({ method: 'bank_transfer', received_at: new Date().toISOString().slice(0,10), notes: '' });
  const [editingAmount, setEditingAmount] = useState(null);
  const [newAmount, setNewAmount] = useState('');

  async function load() {
    try {
      const r = await api.get(`/api/bookings/${id}`);
      setBooking(r.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function markPaid(payment) {
    setPaying(payment);
  }

  async function saveAmount(payment) {
    const amount = parseFloat(newAmount);
    if (!amount || amount < 0) return;
    try {
      await api.put(`/api/payments/${payment.id}`, { amount });
      setEditingAmount(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  async function confirmPayment() {
    try {
      await api.put(`/api/payments/${paying.id}`, { status: 'received', ...payForm });
      setPaying(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  async function confirmBooking() {
    try {
      await api.put(`/api/bookings/${id}`, { status: 'confirmed' });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  async function cancel() {
    if (!confirm('Cancel this booking?')) return;
    await api.delete(`/api/bookings/${id}`);
    nav('/reservations');
  }

  async function addNote() {
    if (!note.trim()) return;
    await api.post(`/api/bookings/${id}/note`, { content: note }).catch(() => {});
    setNote('');
    load();
  }

  function waLink() {
    const msg = encodeURIComponent(`Hi ${booking.guest_name}! 🌿 Thank you for booking at Birdnest Glamping, Kintamani.\n\nBooking details:\n📍 Unit: ${booking.unit_name}\n📅 Check-in: ${booking.check_in_date?.slice(0,10)}\n📅 Check-out: ${booking.check_out_date?.slice(0,10)}\n🌙 ${booking.nights} nights\n💰 Total: ${fmtIDR(booking.total_amount)}\n\nWe look forward to welcoming you! 🌄`);
    window.open(`https://wa.me/${booking.guest_whatsapp?.replace(/\D/g,'')}?text=${msg}`, '_blank');
  }

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!booking) return <div className="alert alert-error">Booking not found</div>;

  const deposit = booking.payments?.find(p => p.type === 'deposit');
  const balance = booking.payments?.find(p => p.type === 'balance');

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Booking #{id.slice(0,8).toUpperCase()}</div>
          <div className="page-subtitle"><Link to="/reservations">← Reservations</Link></div>
        </div>
        <div className="flex gap-2">
          {booking.guest_whatsapp && (
            <button className="btn btn-secondary" onClick={waLink}>💬 WhatsApp</button>
          )}
          {booking.status === 'pending' && (
            <button className="btn btn-primary" onClick={confirmBooking}>Confirm Booking</button>
          )}
          {booking.status === 'confirmed' || booking.status === 'pending' ? (
            <button className="btn btn-danger" onClick={cancel}>Cancel</button>
          ) : null}
        </div>
      </div>

      <div className="grid-2" style={{ gap: 12 }}>
        <div className="card">
          <div className="card-title">Guest</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{booking.guest_name}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>{booking.nationality}</div>
          {booking.guest_whatsapp && <div style={{ fontSize: 13 }}>📱 {booking.guest_whatsapp}</div>}
          {booking.guest_email && <div style={{ fontSize: 13 }}>✉️ {booking.guest_email}</div>}
          <div className="mt-2">
            <Link to={`/guests/${booking.guest_id}`} className="btn btn-sm btn-secondary">View Profile</Link>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Stay Details</div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Unit</span><span style={{ fontWeight: 600 }}>{booking.unit_name}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Check-in</span><span>{booking.check_in_date?.slice(0,10)}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Check-out</span><span>{booking.check_out_date?.slice(0,10)}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Nights</span><span>{booking.nights}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Guests</span><span>{booking.num_guests}</span>
          </div>
          <div className="flex-between" style={{ marginBottom: 6 }}>
            <span className="text-muted">Source</span>
            <span className={`badge badge-${SOURCE_BADGE[booking.source]||'gray'}`}>{booking.source}</span>
          </div>
          <div className="flex-between">
            <span className="text-muted">Status</span>
            <span className={`badge badge-${STATUS_BADGE[booking.status]||'gray'}`}>{booking.status}</span>
          </div>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-title">Payment Tracking</div>
        <div className="grid-2">
          {[deposit, balance].filter(p => p && parseFloat(p.amount) > 0).map(p => (
            <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
              <div className="flex-between mb-3">
                <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{p.type}</span>
                <span className={`badge badge-${p.status === 'received' ? 'green' : 'orange'}`}>{p.status}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Amount</div>
              {editingAmount === p.id ? (
                <div className="flex gap-2 flex-center" style={{ marginBottom: 8 }}>
                  <input className="form-input" type="number" value={newAmount} autoFocus
                    style={{ maxWidth: 160 }} onChange={e => setNewAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveAmount(p)} />
                  <button className="btn btn-sm btn-primary" onClick={() => saveAmount(p)}>Save</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setEditingAmount(null)}>✕</button>
                </div>
              ) : (
                <div className="flex-center gap-2" style={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 18 }}>{fmtIDR(p.amount)}</span>
                  {p.status === 'pending' && (
                    <button className="btn btn-icon btn-sm" title="Edit amount"
                      onClick={() => { setEditingAmount(p.id); setNewAmount(p.amount); }}>✏️</button>
                  )}
                </div>
              )}
              {p.status === 'received' ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  ✓ {p.method?.replace('_',' ')} · {p.received_at?.slice(0,10)}
                </div>
              ) : (
                <button className="btn btn-sm btn-primary mt-2" onClick={() => markPaid(p)}>Mark Received</button>
              )}
            </div>
          ))}
        </div>
        <div className="divider" />
        <div className="flex-between" style={{ fontWeight: 700 }}>
          <span>Total</span><span>{fmtIDR(booking.total_amount)}</span>
        </div>
      </div>

      {booking.special_requests && (
        <div className="card mt-3">
          <div className="card-title">Special Requests</div>
          <p>{booking.special_requests}</p>
        </div>
      )}

      <div className="card mt-3">
        <div className="card-title">Staff Notes</div>
        {booking.notes?.map(n => (
          <div key={n.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.author_name} · {n.created_at?.slice(0,10)}</div>
            <div>{n.content}</div>
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <input className="form-input" placeholder="Add a note…" value={note} onChange={e => setNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNote()} />
          <button className="btn btn-secondary" onClick={addNote}>Add</button>
        </div>
      </div>

      {paying && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Record {paying.type} Payment</div>
              <button className="btn btn-icon" onClick={() => setPaying(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{fmtIDR(paying.amount)}</div>
              <div className="form-group">
                <label className="form-label">Method</label>
                <select className="form-select" value={payForm.method} onChange={e => setPayForm(f=>({...f,method:e.target.value}))}>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="qris">QRIS</option>
                  <option value="cash">Cash</option>
                  <option value="ota_managed">OTA Managed</option>
                  <option value="wise">Wise</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date Received</label>
                <input className="form-input" type="date" value={payForm.received_at} onChange={e => setPayForm(f=>({...f,received_at:e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input className="form-input" value={payForm.notes} onChange={e => setPayForm(f=>({...f,notes:e.target.value}))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPaying(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmPayment}>Confirm Received</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
