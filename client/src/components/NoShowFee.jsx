import { useState, useEffect } from 'react';
import api from '../services/api';

// No-show / late-cancellation fee (migration 166).
// FeePicker: what to charge — nothing, the first night, the whole stay or an
// amount — with the all-in figures from the server. It is used by Mark No-Show,
// Cancel Booking and "Add fee" on a booking already marked no-show / cancelled.
// value = { mode: 'none' | 'first_night' | 'whole_stay' | 'custom', amount }

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');

export function feePayload(fee) {
  if (!fee || fee.mode === 'none') return undefined;
  return fee.mode === 'custom' ? { mode: 'custom', amount: parseFloat(fee.amount) } : { mode: fee.mode };
}

export function feeValid(fee) {
  return !fee || fee.mode !== 'custom' || parseFloat(fee.amount) > 0;
}

export function FeePicker({ bookingId, value, onChange, allowNone = true, onQuote }) {
  const [q, setQ] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/api/bookings/${bookingId}/noshow-fee/quote`).then(r => {
      if (!live) return;
      setQ(r.data);
      onQuote?.(r.data);
      // Start from what usually applies: an OTA that collected the money pays
      // the first night; otherwise no fee unless front desk chooses one.
      if (!r.data.can_charge) onChange({ mode: 'none', amount: '' });
      else if (!allowNone || r.data.ota_collects) onChange({ mode: 'first_night', amount: '' });
    }).catch(e => live && setError(e?.response?.data?.error || 'Could not load the fee'));
    return () => { live = false; };
  }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="alert alert-error"><div>{error}</div></div>;
  if (!q) return <div className="text-muted" style={{ fontSize: 13 }}>Loading the fee…</div>;

  const oneNight = Math.abs(q.first_night.all_in - q.whole_stay.all_in) < 1;
  const opt = (mode, label, sub) => (
    <label key={mode} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', cursor: q.can_charge || mode === 'none' ? 'pointer' : 'not-allowed' }}>
      <input type="radio" name="noshow-fee" style={{ marginTop: 3 }} checked={value.mode === mode}
        disabled={!q.can_charge && mode !== 'none'} onChange={() => onChange({ mode, amount: value.amount || '' })} />
      <span><b>{label}</b>{sub && <span className="text-muted" style={{ fontSize: 12 }}> — {sub}</span>}</span>
    </label>
  );

  return (
    <div>
      {!q.can_charge && <div className="alert alert-warning" style={{ marginBottom: 8 }}><div>{q.blocked_reason}</div></div>}
      {q.ota_collects ? (
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>
          {q.source_label || 'The OTA'} collected the money, so it is the one that pays this fee under its policy — usually the first night, if the no-show was reported to it in time. Record its payout under Record Payment when it arrives.
        </div>
      ) : (
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>
          Charge a fee only if the hotel can really collect it (a card on file, a deposit already paid). With nothing to collect, choose No fee.
        </div>
      )}
      {allowNone && opt('none', 'No fee')}
      {opt('first_night', 'First night', `${fmtIDR(q.first_night.all_in)} incl. service & tax`)}
      {!oneNight && opt('whole_stay', 'Whole stay', `${fmtIDR(q.whole_stay.all_in)} incl. service & tax`)}
      {opt('custom', 'Another amount', null)}
      {value.mode === 'custom' && (
        <div style={{ marginLeft: 24, marginBottom: 6 }}>
          <input className="form-input" type="number" min="1" style={{ maxWidth: 200 }} autoFocus
            value={value.amount} placeholder="Amount in Rp"
            onChange={e => onChange({ mode: 'custom', amount: e.target.value })} />
          <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
            {q.typed_as === 'all_in' ? 'Typed all-in: service charge and tax are inside this amount.' : 'Typed before service charge and tax — they are added on top.'}
          </div>
        </div>
      )}
      <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
        The fee counts as revenue on its own line (not a room night, so occupancy and ADR do not change).
      </div>
    </div>
  );
}

// Mark No-Show (kind 'noshow': PUT /no-show with the fee) or a fee afterwards
// on a booking already no-show / cancelled (kind 'add': needs a reason).
export default function NoShowFeeModal({ booking, kind, onClose, onDone }) {
  const [fee, setFee] = useState({ mode: 'none', amount: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const adding = kind === 'add';
  const cancelled = booking.status === 'cancelled';
  const ok = feeValid(fee) && (!adding || (fee.mode !== 'none' && reason.trim()));

  async function go() {
    if (!ok || busy) return;
    setBusy(true); setError('');
    try {
      if (adding) await api.post(`/api/bookings/${booking.id}/noshow-fee`, { ...feePayload(fee), reason: reason.trim() });
      else await api.put(`/api/bookings/${booking.id}/no-show`, { fee: feePayload(fee) });
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not do that');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 520, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">{adding ? (cancelled ? 'Add a late-cancellation fee' : 'Add a no-show fee') : 'Mark as no-show'}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>{booking.guest_name} · {booking.unit_name}</div>
            <div className="text-muted" style={{ fontSize: 13 }}>
              {booking.check_in_date?.slice(0, 10)} → {booking.check_out_date?.slice(0, 10)} · {booking.nights} night{booking.nights === 1 ? '' : 's'} · {booking.source_label || booking.source}
            </div>
          </div>
          {!adding && (
            <div style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.5 }}>
              The guest never checked in. The room nights are taken off the bill; money already received stays recorded.
            </div>
          )}
          <div className="form-label" style={{ marginBottom: 4 }}>{cancelled ? 'Late-cancellation fee' : 'No-show fee'}</div>
          <FeePicker bookingId={booking.id} value={fee} onChange={setFee} allowNone={!adding} />
          {adding && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Reason (required — goes into Edit History)</label>
              <input className="form-input" value={reason} placeholder="e.g. Agoda confirmed it pays the first night"
                onChange={e => setReason(e.target.value)} />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className={`btn ${adding ? 'btn-primary' : 'btn-danger'}`} onClick={go} disabled={busy || !ok}>
            {busy ? 'Saving…' : adding ? 'Add fee' : fee.mode === 'none' ? 'Mark no-show' : 'Mark no-show and charge the fee'}
          </button>
        </div>
      </div>
    </div>
  );
}
