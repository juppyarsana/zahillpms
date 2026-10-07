import { useState, useEffect } from 'react';
import api from '../services/api';
import ReasonModal from './ReasonModal';

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const fmtDay = d => new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// Booking ⋮ → Move into a group: a reservation made on its own becomes a room
// of a group (PUT /api/bookings/:id/join-group).
export function JoinGroupModal({ booking, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState(null);
  const [picked, setPicked] = useState(null);
  const received = (booking.payments || [])
    .filter(p => p.status === 'received' && (p.type === 'deposit' || p.type === 'balance'))
    .reduce((s, p) => s + parseFloat(p.amount), 0);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/api/bookings/groups', { params: { when: 'current', ...(q.trim() ? { q: q.trim() } : {}) } });
        setGroups(data.filter(g => g.group_status !== 'cancelled'));
      } catch { setGroups([]); }
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);

  async function confirm(reason) {
    if (!picked) throw new Error('Choose the group first');
    await api.put(`/api/bookings/${booking.id}/join-group`, { group_id: picked.id, reason });
    onDone();
  }

  return (
    <ReasonModal title={`Move room ${booking.unit_name} into a group`} confirmLabel="Move into group"
      placeholder="e.g. booked separately, belongs to the same group" onClose={onClose} onConfirm={confirm}>
      <div style={{ marginBottom: 10 }}>
        The booking keeps its room, guest, dates, price and charges. Only its group changes.
      </div>
      {picked ? (
        <div style={{ border: '1.5px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div>
              <b>👥 {picked.booker_name}</b>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {fmtDay(picked.check_in_date)} – {fmtDay(picked.check_out_date)} · rooms {picked.room_names || '—'}
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setPicked(null)}>Change</button>
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            {picked.group_billing
              ? <>This group has one bill. The room and meal plan go onto it{received > 0
                  ? <>, and the <b>{fmtIDR(received)}</b> already received on this booking becomes a payment of the group</>
                  : null}. Extras the guest paid themselves stay on the room.</>
              : <>This group is paid room by room, so this booking keeps its own payment lines.</>}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 10 }}>
          <input className="form-input" placeholder="Search the group by booker or guest name" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
            {groups === null && <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 6 }}>Loading…</div>}
            {groups && groups.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 6 }}>No upcoming or in-house group found.</div>}
            {(groups || []).map(g => (
              <button key={g.id} type="button" onClick={() => setPicked(g)}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', padding: '8px 6px', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
                <b>{g.booker_name}</b>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {fmtDay(g.check_in_date)} – {fmtDay(g.check_out_date)} · {g.active_rooms} room{g.active_rooms === 1 ? '' : 's'} ({g.room_names || '—'})
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </ReasonModal>
  );
}

// Booking ⋮ → Take out of the group: a group's room becomes a booking on its
// own (PUT /api/bookings/:id/leave-group). Out of a group with one bill, FO
// says how much of the group's payments goes with the room.
export function LeaveGroupModal({ booking, onClose, onDone }) {
  const [quote, setQuote] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState('0');

  useEffect(() => {
    api.get(`/api/bookings/${booking.id}/leave-group/quote`)
      .then(({ data }) => setQuote(data))
      .catch(err => setLoadError(err.response?.data?.error || 'Could not load the group'));
  }, [booking.id]);

  async function confirm(reason) {
    if (!quote) throw new Error(loadError || 'Still loading — try again');
    const amt = quote.group_billing ? parseFloat(amount || 0) : 0;
    if (!(amt >= 0)) throw new Error('Enter the amount that goes with the room (0 for none)');
    await api.put(`/api/bookings/${booking.id}/leave-group`, { amount: amt, reason });
    onDone();
  }

  const amt = parseFloat(amount || 0) || 0;
  // what the group still owes for its other rooms once `amt` has left with this one
  const groupAfter = quote ? (quote.group_bill_after || 0) - ((quote.group_received || 0) - amt) : 0;
  return (
    <ReasonModal title={`Take room ${booking.unit_name} out of the group`} confirmLabel="Take out of group"
      placeholder="e.g. this guest pays for himself" onClose={onClose} onConfirm={confirm}>
      {loadError && <div className="alert alert-error"><div>{loadError}</div></div>}
      {!quote && !loadError && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
      {quote && (
        <>
          <div style={{ marginBottom: 10 }}>
            Room {booking.unit_name} becomes a booking on its own, no longer part of <b>{quote.booker}</b>'s group.
            It keeps its room, guest, dates, price and charges.
          </div>
          {quote.other_rooms === 0 && (
            <div className="alert alert-error"><div>This is the group's last room — it can't be taken out.</div></div>
          )}
          {quote.group_billing ? (
            <>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                The room gets its own payment lines again. Its price is <b>{fmtIDR(quote.price)}</b>.
                {quote.max > 0
                  ? <> The group has paid {fmtIDR(quote.group_received)} so far. Up to <b>{fmtIDR(quote.max)}</b> of that can go with this room — only move what was paid for this room.</>
                  : <> The group has not paid anything yet, so nothing goes with the room — the guest pays the room.</>}
              </div>
              {quote.max > 0 && (
                <div className="form-group">
                  <label className="form-label">Amount of the group's payments that goes with the room (IDR)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="form-input" type="number" min="0" max={quote.max} value={amount} onChange={e => setAmount(e.target.value)} />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAmount(String(quote.max))}>All {fmtIDR(quote.max)}</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAmount('0')}>None</button>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    Paid on the room {fmtIDR(amt)} · still to pay {fmtIDR(Math.max(0, quote.price - amt))}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    {groupAfter > 0.5 ? <>The group then still owes {fmtIDR(groupAfter)} for its other rooms.</>
                      : groupAfter < -0.5 ? <>The group then has a credit of {fmtIDR(-groupAfter)}.</>
                      : <>The group is then paid in full.</>}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, marginBottom: 8 }}>This group is paid room by room, so the room's payment lines stay as they are.</div>
          )}
        </>
      )}
    </ReasonModal>
  );
}
