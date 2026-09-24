import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import ActionMenu from '../components/ActionMenu';
import GuestPicker from '../components/GuestPicker';
import { useSettings } from '../context/SettingsContext';

const STATUS_BADGE = { confirmed: 'green', deposit_paid: 'amber', pending: 'amber', checked_in: 'blue', checked_out: 'gray', cancelled: 'red', no_show: 'red' };
const STATUS_LABEL = { confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', pending: 'Pending', checked_in: 'Checked In', checked_out: 'Checked Out', cancelled: 'Cancelled', no_show: 'No Show' };

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

export default function GroupDetail() {
  const { groupId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('details');
  const [folio, setFolio] = useState(null);
  const [folioLoading, setFolioLoading] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkinResults, setCheckinResults] = useState(null);

  async function load() {
    try {
      const r = await api.get(`/api/bookings/group/${groupId}`);
      setData(r.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [groupId]);

  async function loadFolio() {
    setFolioLoading(true);
    try {
      const r = await api.get(`/api/folio/group/${groupId}`);
      setFolio(r.data);
    } catch {}
    setFolioLoading(false);
  }

  useEffect(() => { if (tab === 'folio' && !folio) loadFolio(); }, [tab]);

  async function downloadGroupProforma() {
    try {
      const r = await api.get(`/api/folio/group/${groupId}/proforma`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `proforma-group-${groupId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download pro forma');
    }
  }

  async function checkInGroup() {
    setCheckingIn(true);
    setCheckinResults(null);
    try {
      const r = await api.post(`/api/checkin/group/${groupId}/start`);
      setCheckinResults(r.data);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to check in group');
    } finally {
      setCheckingIn(false);
    }
  }

  // Assign the guest actually staying in each room (the group is usually
  // booked under one name; the guest list arrives later). Room / TV Display,
  // Registration Card and the police Guest Report all follow the room's guest.
  // Group payment: one payment from the group (e.g. the booker's single
  // transfer) marks several rooms' deposit/balance lines received at once;
  // each room's status updates like "Mark Received" on the room itself.
  const { paymentMethods } = useSettings();
  const payMethods = paymentMethods.filter(m => m.is_active !== false && m.id !== 'ota_managed');
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const [paying, setPaying] = useState(false);
  const [paySel, setPaySel] = useState(new Set());
  const [payForm, setPayForm] = useState({ method: '', received_at: todayStr, notes: '' });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState('');

  // Every unpaid room payment line in the group, room by room.
  function pendingLines() {
    if (!data) return [];
    return data.bookings
      .filter(b => !['cancelled', 'no_show'].includes(b.status))
      .flatMap(b => (b.payments || [])
        .filter(p => (p.type === 'deposit' || p.type === 'balance') && p.status !== 'received' && parseFloat(p.amount) > 0)
        .map(p => ({ ...p, unit_name: b.unit_name, guest_name: b.guest_name })));
  }

  function openGroupPayment() {
    const lines = pendingLines();
    // Start with the deposits ticked when any are open (the usual first
    // transfer), otherwise everything that's left.
    const deposits = lines.filter(l => l.type === 'deposit');
    setPaySel(new Set((deposits.length ? deposits : lines).map(l => l.id)));
    setPayForm({ method: payMethods.find(m => m.id === 'bank_transfer')?.id || payMethods[0]?.id || '', received_at: todayStr, notes: '' });
    setPayError('');
    setPaying(true);
  }

  async function saveGroupPayment() {
    setPaySaving(true);
    setPayError('');
    try {
      await api.post(`/api/bookings/group/${groupId}/payments`, {
        payment_ids: [...paySel], method: payForm.method, received_at: payForm.received_at, notes: payForm.notes,
      });
      setPaying(false);
      load();
    } catch (err) {
      setPayError(err.response?.data?.error || 'Could not record the payment');
    } finally {
      setPaySaving(false);
    }
  }

  const [assigning, setAssigning] = useState(false);
  const [assignments, setAssignments] = useState({}); // booking_id -> GuestPicker value
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState('');

  function openAssign() {
    setAssignments({});
    setAssignError('');
    setAssigning(true);
  }

  async function saveAssignments() {
    const list = Object.entries(assignments)
      .filter(([, v]) => v)
      .map(([booking_id, v]) => v.guest_id ? { booking_id, guest_id: v.guest_id } : { booking_id, new_guest: v.new_guest });
    if (!list.length) { setAssigning(false); return; }
    setAssignSaving(true);
    setAssignError('');
    try {
      await api.put(`/api/bookings/group/${groupId}/guests`, { assignments: list });
      setAssigning(false);
      load();
    } catch (err) {
      setAssignError(err.response?.data?.error || 'Could not save the guests');
    } finally {
      setAssignSaving(false);
    }
  }

  async function cancelGroup() {
    if (!confirm('Cancel this entire group booking? All rooms not already checked out will be cancelled.')) return;
    try {
      await api.delete(`/api/bookings/group/${groupId}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel group');
    }
  }

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!data) return <div className="alert alert-error">Group not found</div>;

  const { group, bookings, rollup } = data;
  const anyEligibleForCheckin = bookings.some(b => !['cancelled', 'no_show', 'checked_in', 'checked_out'].includes(b.status));
  const assignableRooms = bookings.filter(b => !['cancelled', 'no_show', 'checked_out'].includes(b.status));
  const roomsWithBooker = assignableRooms.filter(b => b.guest_id === group.primary_guest_id).length;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Group Booking · {group.guest_name}</div>
          <div className="page-subtitle"><Link to="/reservations">← Reservations</Link></div>
        </div>
        <div className="flex gap-2 items-center">
          {anyEligibleForCheckin && (
            <button className="btn btn-primary" onClick={checkInGroup} disabled={checkingIn}>
              {checkingIn ? 'Checking in…' : 'Check In Whole Group'}
            </button>
          )}
          <ActionMenu
            icon="⬇"
            label="Download"
            ariaLabel="Download documents"
            items={[{ label: 'Pro Forma', icon: '📋', hint: 'Estimate — projected total across every room in the group', onClick: downloadGroupProforma }]}
          />
          {assignableRooms.length > 0 && (
            <button className="btn btn-secondary" onClick={openAssign}>👥 Assign Guests</button>
          )}
          {group.status === 'active' && (
            <button className="btn btn-danger" onClick={cancelGroup}>Cancel Group</button>
          )}
        </div>
      </div>

      {checkinResults && (
        <div className="card mb-3">
          <div className="card-title">Check-in Results</div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {checkinResults.succeeded} of {checkinResults.attempted} rooms checked in
            {checkinResults.failed > 0 && ` — ${checkinResults.failed} failed`}
          </div>
          {checkinResults.results.map(r => {
            const b = bookings.find(x => x.id === r.booking_id);
            return (
              <div key={r.booking_id} className="flex-between" style={{ fontSize: 13, padding: '4px 0' }}>
                <span>{b?.unit_name || r.booking_id.slice(0, 8)}</span>
                {r.ok ? (
                  <span style={{ color: 'var(--color-success, #16a34a)' }}>✓ Checked in</span>
                ) : (
                  <span style={{ color: 'var(--color-danger, #dc2626)' }}>✕ {r.error}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="tab-bar">
        <button className={`tab-bar-item${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
        <button className={`tab-bar-item${tab === 'folio' ? ' active' : ''}`} onClick={() => setTab('folio')}>Master Folio</button>
      </div>

      {tab === 'details' && (
        <>
          <div className="card mb-3">
            <div className="card-title">Booked by</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{group.guest_name}</div>
            {group.guest_whatsapp && <div style={{ fontSize: 13 }}>📱 {group.guest_whatsapp}</div>}
            {group.guest_email && <div style={{ fontSize: 13 }}>✉️ {group.guest_email}</div>}
            <div className="flex-between mt-2" style={{ fontSize: 13 }}>
              <span className="text-muted">Check-in</span><span>{group.check_in_date?.slice(0, 10)}</span>
            </div>
            <div className="flex-between" style={{ fontSize: 13 }}>
              <span className="text-muted">Check-out</span><span>{group.check_out_date?.slice(0, 10)}</span>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-title">Rooms ({rollup.room_count})</div>
            {roomsWithBooker > 0 && (
              <div className="alert alert-success" style={{ fontSize: 13, marginBottom: 8 }}>
                {roomsWithBooker} room{roomsWithBooker === 1 ? ' is' : 's are'} still under the booker's name. Use <b>Assign Guests</b> once the guest list arrives — Room Display, TV and the police guest report show each room's guest.
              </div>
            )}
            {bookings.map(b => (
              <div key={b.id} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <Link to={`/reservations/${b.id}`} style={{ fontWeight: 600 }}>{b.unit_name}</Link>
                  <span style={{ marginLeft: 8, fontSize: 13 }}>
                    {b.guest_name}
                    {b.guest_id === group.primary_guest_id && <span className="text-muted" style={{ fontSize: 11 }}> (booker)</span>}
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.num_guests} guest{b.num_guests !== 1 ? 's' : ''} · {fmtIDR(b.total_amount)}</div>
                </div>
                <div className="flex gap-2" style={{ alignItems: 'center' }}>
                  {(() => {
                    // Unpaid room payment lines → shortcut to that room's
                    // Payment Tracking to mark them received.
                    const unpaid = (b.payments || [])
                      .filter(p => (p.type === 'deposit' || p.type === 'balance') && p.status !== 'received' && parseFloat(p.amount) > 0)
                      .reduce((s, p) => s + parseFloat(p.amount), 0);
                    if (unpaid <= 0 || ['cancelled', 'no_show'].includes(b.status)) return null;
                    return (
                      <>
                        <span style={{ fontSize: 12, color: 'var(--color-danger, #dc2626)', fontWeight: 600 }}>{fmtIDR(unpaid)} unpaid</span>
                        <Link to={`/reservations/${b.id}#payment`} className="btn btn-sm btn-secondary">Pay →</Link>
                      </>
                    );
                  })()}
                  <span className={`badge badge-${STATUS_BADGE[b.status] || 'gray'}`}>{STATUS_LABEL[b.status] || b.status}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="card mb-3">
            <div className="card-title">Group Payment Summary</div>
            <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
              <span className="text-muted">Total ({rollup.room_count} rooms)</span><span>{fmtIDR(rollup.total_amount)}</span>
            </div>
            {rollup.discount_amount > 0 && (
              <div className="flex-between" style={{ fontSize: 13, marginBottom: 4, color: 'var(--color-success, #16a34a)' }}>
                <span>Group Discount</span><span>− {fmtIDR(rollup.discount_amount)}</span>
              </div>
            )}
            <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 6 }}>
              <span>Net Total</span><span>{fmtIDR(rollup.net_amount)}</span>
            </div>
            <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
              <span className="text-muted">Paid</span><span>{fmtIDR(rollup.paid_amount)}</span>
            </div>
            <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
              <span>Balance Due</span>
              <span style={{ color: rollup.balance_due > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                {fmtIDR(rollup.balance_due)}
              </span>
            </div>
            {pendingLines().length > 0 && (
              <div className="flex gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={openGroupPayment}>💳 Record Group Payment</button>
                <span className="text-muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                  One payment for several rooms — each room's status updates.
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {paying && (() => {
        const lines = pendingLines();
        const total = lines.filter(l => paySel.has(l.id)).reduce((sum, l) => sum + parseFloat(l.amount), 0);
        const toggle = lineId => setPaySel(sel => { const n = new Set(sel); if (n.has(lineId)) n.delete(lineId); else n.add(lineId); return n; });
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 560, width: '100%' }}>
              <div className="modal-header">
                <div className="modal-title">Record Group Payment</div>
                <button className="btn btn-icon" onClick={() => setPaying(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="flex gap-2" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
                  <span className="text-muted" style={{ fontSize: 13, alignSelf: 'center' }}>This payment covers:</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPaySel(new Set(lines.filter(l => l.type === 'deposit').map(l => l.id)))}>All deposits</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPaySel(new Set(lines.map(l => l.id)))}>Everything unpaid</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPaySel(new Set())}>Clear</button>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
                  {lines.map(l => (
                    <label key={l.id} className="flex-between" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                      <span className="flex gap-2" style={{ alignItems: 'center' }}>
                        <input type="checkbox" checked={paySel.has(l.id)} onChange={() => toggle(l.id)} />
                        <b>{l.unit_name}</b>
                        <span style={{ textTransform: 'capitalize' }}>{l.type}</span>
                        <span className="text-muted" style={{ fontSize: 11 }}>{l.guest_name}</span>
                      </span>
                      <span style={{ fontWeight: 600 }}>{fmtIDR(l.amount)}</span>
                    </label>
                  ))}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Method</label>
                    <select className="form-select" value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}>
                      {payMethods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date received</label>
                    <input className="form-input" type="date" value={payForm.received_at} onChange={e => setPayForm(f => ({ ...f, received_at: e.target.value }))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input className="form-input" value={payForm.notes} placeholder="e.g. BCA transfer ref 1234" onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                  <span>Total received</span><span>{fmtIDR(total)}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Should match what the group actually paid. For a different amount, adjust that room's line on its booking first.
                </div>
                {payError && <div className="alert alert-error" style={{ marginTop: 10 }}>{payError}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setPaying(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveGroupPayment} disabled={paySaving || paySel.size === 0 || !payForm.method}>
                  {paySaving ? 'Saving…' : `Record ${fmtIDR(total)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {assigning && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 640, width: '100%' }}>
            <div className="modal-header">
              <div className="modal-title">Assign Guests — {group.guest_name}'s group</div>
              <button className="btn btn-icon" onClick={() => setAssigning(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Pick the guest staying in each room, or add them as a new guest. Rooms you leave alone keep their current guest. {group.guest_name} stays the group's contact and billing is unchanged.
              </div>
              {assignableRooms.map(b => (
                <div key={b.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="flex-between" style={{ marginBottom: 6 }}>
                    <span style={{ fontWeight: 700 }}>{b.unit_name}</span>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      Now: {b.guest_name}{b.guest_id === group.primary_guest_id ? ' (booker)' : ''} · {b.num_guests} pax
                    </span>
                  </div>
                  <GuestPicker value={assignments[b.id] || null} onChange={v => setAssignments(a => ({ ...a, [b.id]: v }))} />
                </div>
              ))}
              {assignError && <div className="alert alert-error" style={{ marginTop: 10 }}>{assignError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAssigning(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAssignments}
                disabled={assignSaving || !Object.values(assignments).some(Boolean)}>
                {assignSaving ? 'Saving…' : `Save ${Object.values(assignments).filter(Boolean).length || ''} room${Object.values(assignments).filter(Boolean).length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'folio' && (
        <div className="card mt-3">
          <div className="card-title">Master Folio</div>
          {folioLoading && !folio ? <div className="text-muted">Loading…</div> : folio && (
            <>
              {folio.rooms.map(room => (
                <div key={room.booking_id} style={{ marginBottom: 14 }}>
                  <div className="flex-between" style={{ fontWeight: 600, marginBottom: 4 }}>
                    <Link to={`/reservations/${room.booking_id}`}>{room.unit_name}</Link>
                    <span>{fmtIDR(room.total)}</span>
                  </div>
                  {room.charges.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 12 }}>No charges posted</div>
                  ) : room.charges.map(c => (
                    <div key={c.id} className="flex-between" style={{ fontSize: 12, padding: '3px 0', color: 'var(--text-muted)' }}>
                      <span>{c.description}</span><span>{fmtIDR(c.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="divider" />
              {folio.by_type && (folio.by_type.room + folio.by_type.fnb) > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Net revenue — Room {fmtIDR(folio.by_type.room)} · F&amp;B {fmtIDR(folio.by_type.fnb)}
                </div>
              )}
              <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                <span className="text-muted">Subtotal</span><span>{fmtIDR(folio.subtotal)}</span>
              </div>
              <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                <span className="text-muted">Service Charge</span><span>{fmtIDR(folio.service_charge_amount)}</span>
              </div>
              <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                <span className="text-muted">Tax</span><span>{fmtIDR(folio.tax_amount)}</span>
              </div>
              <div className="flex-between" style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6, marginBottom: 10 }}>
                <span>Total</span><span>{fmtIDR(folio.total)}</span>
              </div>
              <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}>
                <span>Balance Due</span>
                <span style={{ color: parseFloat(folio.balance_due) > 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
                  {fmtIDR(folio.balance_due)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                To post a new charge, open the individual room's Folio tab.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
