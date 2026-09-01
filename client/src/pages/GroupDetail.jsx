import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';

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

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Group Booking · {group.guest_name}</div>
          <div className="page-subtitle"><Link to="/reservations">← Reservations</Link></div>
        </div>
        <div className="flex gap-2">
          {anyEligibleForCheckin && (
            <button className="btn btn-primary" onClick={checkInGroup} disabled={checkingIn}>
              {checkingIn ? 'Checking in…' : 'Check In Whole Group'}
            </button>
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

      <div className="flex gap-2 mb-3">
        <button className={`btn btn-sm ${tab === 'details' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('details')}>Details</button>
        <button className={`btn btn-sm ${tab === 'folio' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('folio')}>Master Folio</button>
      </div>

      {tab === 'details' && (
        <>
          <div className="card mb-3">
            <div className="card-title">Guest</div>
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
            {bookings.map(b => (
              <div key={b.id} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <Link to={`/reservations/${b.id}`} style={{ fontWeight: 600 }}>{b.unit_name}</Link>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.num_guests} guest{b.num_guests !== 1 ? 's' : ''} · {fmtIDR(b.total_amount)}</div>
                </div>
                <span className={`badge badge-${STATUS_BADGE[b.status] || 'gray'}`}>{STATUS_LABEL[b.status] || b.status}</span>
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
          </div>
        </>
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
