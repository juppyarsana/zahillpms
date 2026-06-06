import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useSettings, SourceBadge } from '../context/SettingsContext';

const STATUS_BADGE = { confirmed: 'green', deposit_paid: 'amber', pending: 'amber', checked_in: 'blue', checked_out: 'gray', cancelled: 'red', no_show: 'red' };
const STATUS_LABEL = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };


function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function BookingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { paymentMethods, sources } = useSettings();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(null);
  const [payForm, setPayForm] = useState({ method: 'bank_transfer', received_at: new Date().toISOString().slice(0,10), notes: '' });
  const [editingAmount, setEditingAmount] = useState(null);
  const [newAmount, setNewAmount] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutNotes, setCheckoutNotes] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferUnits, setTransferUnits] = useState([]);
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);

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

  async function doCheckout() {
    setCheckoutLoading(true);
    try {
      await api.put(`/api/checkin/checkout/${id}/complete`, { condition_notes: checkoutNotes });
      setCheckingOut(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Checkout failed');
    } finally {
      setCheckoutLoading(false);
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

  async function openTransfer() {
    setTransferTarget(null);
    setTransferring(true);
    try {
      const r = await api.get('/api/bookings/transfer-availability', {
        params: {
          check_in: booking.check_in_date?.slice(0, 10),
          check_out: booking.check_out_date?.slice(0, 10),
          exclude_booking_id: id,
        },
      });
      setTransferUnits(r.data.filter(u => u.id !== booking.unit_id));
    } catch {
      alert('Failed to load unit availability');
      setTransferring(false);
    }
  }

  async function doTransfer() {
    if (!transferTarget) return;
    setTransferLoading(true);
    try {
      await api.put(`/api/bookings/${id}/transfer`, { unit_id: transferTarget });
      setTransferring(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Transfer failed');
    } finally {
      setTransferLoading(false);
    }
  }

  function waLink() {
    const msg = encodeURIComponent(`Hi ${booking.guest_name}! 🌿 Thank you for booking at Birdnest Glamping, Kintamani.\n\nBooking details:\n📍 Unit: ${booking.unit_name}\n📅 Check-in: ${booking.check_in_date?.slice(0,10)}\n📅 Check-out: ${booking.check_out_date?.slice(0,10)}\n🌙 ${booking.nights} nights\n💰 Total: ${fmtIDR(booking.total_amount)}\n\nWe look forward to welcoming you! 🌄`);
    const rawWa = (booking.guest_whatsapp || '').trim();
    let waNum = rawWa.replace(/\D/g, '');
    if (!rawWa.startsWith('+')) {
      if (waNum.startsWith('0')) waNum = '62' + waNum.slice(1);
      else if (!waNum.startsWith('62')) waNum = '62' + waNum;
    }
    window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
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
          {['pending', 'deposit_paid', 'confirmed', 'checked_in'].includes(booking.status) && (
            <button className="btn btn-secondary" onClick={openTransfer}>Transfer Room</button>
          )}
          {booking.guest_whatsapp && (
            <button className="btn btn-secondary" onClick={waLink}>💬 WhatsApp</button>
          )}
          {(() => {
            const isOTA = sources.find(s => s.id === booking.source)?.is_ota;
            const canCheckin = isOTA
              ? ['pending','deposit_paid','confirmed'].includes(booking.status)
              : booking.status === 'confirmed';
            return canCheckin && (
              <button className="btn btn-primary" onClick={() => nav(`/checkin?checkin=${id}`)}>Check In</button>
            );
          })()}
          {booking.status === 'checked_in' && (
            <button className="btn btn-primary" onClick={() => { setCheckingOut(true); setCheckoutNotes(''); }}>Check Out</button>
          )}
          {['pending', 'deposit_paid', 'confirmed'].includes(booking.status) ? (
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
            <SourceBadge sourceId={booking.source} />
          </div>
          <div className="flex-between">
            <span className="text-muted">Status</span>
            <span className={`badge badge-${STATUS_BADGE[booking.status]||'gray'}`}>{STATUS_LABEL[booking.status]||booking.status}</span>
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

      {booking.checkin_record && (
        <div className="card mt-3">
          <div className="card-title">Check-in / Check-out Record</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {booking.checkin_record.checkin_time && (
              <div className="flex-between" style={{ fontSize: 13 }}>
                <span className="text-muted">Checked in</span>
                <span>{new Date(booking.checkin_record.checkin_time).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            )}
            {booking.checkin_record.checkout_time && (
              <div className="flex-between" style={{ fontSize: 13 }}>
                <span className="text-muted">Checked out</span>
                <span>{new Date(booking.checkin_record.checkout_time).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            )}
            <div className="flex-between" style={{ fontSize: 13 }}>
              <span className="text-muted">ID captured</span>
              <span>{booking.checkin_record.id_captured ? '✓ Yes' : '— No'}</span>
            </div>
            {booking.checkin_record.condition_notes && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Unit condition notes</div>
                  <div style={{ fontSize: 13, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px' }}>
                    {booking.checkin_record.condition_notes}
                  </div>
                </div>
              </>
            )}
          </div>
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

      {transferring && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Transfer Room — {booking.guest_name}</div>
              <button className="btn btn-icon" onClick={() => setTransferring(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
                Current room: <strong>{booking.unit_name}</strong> · {booking.check_in_date?.slice(0,10)} → {booking.check_out_date?.slice(0,10)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {transferUnits.map(u => {
                  const isAvailable = u.available;
                  const isSelected = transferTarget === u.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => isAvailable && setTransferTarget(u.id)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', borderRadius: 8, cursor: isAvailable ? 'pointer' : 'not-allowed',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                        background: isSelected ? 'var(--primary-light, #eff6ff)' : isAvailable ? 'var(--bg-card)' : 'var(--bg-muted, #f9fafb)',
                        opacity: isAvailable ? 1 : 0.6,
                        textAlign: 'left', width: '100%',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
                        {!isAvailable && u.conflict && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Booked by {u.conflict.guest_name} · {u.conflict.check_in_date?.slice(0,10)} → {u.conflict.check_out_date?.slice(0,10)}
                          </div>
                        )}
                      </div>
                      <span className={`badge badge-${isAvailable ? 'green' : 'red'}`}>
                        {isAvailable ? 'Available' : 'Unavailable'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setTransferring(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doTransfer} disabled={!transferTarget || transferLoading}>
                {transferLoading ? 'Transferring…' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {checkingOut && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Check Out: {booking.guest_name}</div>
              <button className="btn btn-icon" onClick={() => setCheckingOut(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                <strong>{booking.unit_name}</strong> · Check-out {booking.check_out_date?.slice(0,10)}
              </div>
              {balance && !balance.status === 'received' && parseFloat(balance.amount) > 0 && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  ⚠ Balance of <strong>{fmtIDR(balance.amount)}</strong> not received. Collect before completing check-out.
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Unit Condition Notes</label>
                <textarea
                  className="form-textarea"
                  placeholder="Any damage, issues, or items left behind…"
                  value={checkoutNotes}
                  onChange={e => setCheckoutNotes(e.target.value)}
                />
              </div>
              <div className="alert alert-success" style={{ marginTop: 0 }}>
                Completing check-out will free the unit and auto-generate a housekeeping task.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCheckingOut(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={doCheckout} disabled={checkoutLoading}>
                {checkoutLoading ? 'Processing…' : 'Complete Check-out ✓'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  {paymentMethods.filter(m => m.is_active).map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
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
