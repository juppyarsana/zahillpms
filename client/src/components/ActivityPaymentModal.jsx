import { useState } from 'react';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { priceFactor } from '../lib/priceBasis';

function fmtIDR(n) { return 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID'); }
const HIDDEN_PAY_METHODS = ['ota_managed'];

// Take payment for an activity booked "Not paid yet" — charge it to the
// guest's room (when it's linked to a stay) or record it paid now.
// PATCH /api/activities/bookings/:id/payment.
export default function ActivityPaymentModal({ activityBooking: ab, onClose, onDone }) {
  const { paymentMethods, branding } = useSettings();
  const methods = paymentMethods.filter(m => m.is_active && !HIDDEN_PAY_METHODS.includes(m.id));
  const [choice, setChoice] = useState(ab.booking_id ? 'room_charge' : (methods[0]?.id || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = parseFloat(ab.total_amount) || 0;
  const mode = ab.tax_mode || 'added';
  // "++" activity paid now: service + tax on top now. Charged to the room,
  // the folio adds them at checkout. Tax-included / no-tax: the price as is.
  const payNow = mode === 'added' ? total * priceFactor(branding) : total;

  async function save() {
    if (!choice) return;
    setSaving(true); setError('');
    try {
      await api.patch(`/api/activities/bookings/${ab.id}/payment`, { payment_method: choice });
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save the payment');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div className="modal-title">Take payment — {ab.activity_name}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            {String(ab.scheduled_date).slice(0, 10)} · {ab.num_participants} pax · booked as not paid yet
          </div>
          {ab.booking_id && (
            <label className="flex gap-2 items-center" style={{ marginBottom: 10, cursor: 'pointer' }}>
              <input type="radio" checked={choice === 'room_charge'} onChange={() => setChoice('room_charge')} />
              <span>
                Charge to room — <b>{fmtIDR(total)}</b>
                {mode === 'added' && priceFactor(branding) > 1 && <span className="text-muted"> + service &amp; tax on the bill</span>}
              </span>
            </label>
          )}
          <label className="flex gap-2 items-center" style={{ marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" checked={choice !== 'room_charge'} onChange={() => setChoice(methods[0]?.id || '')} />
            <span>Paid now — <b>{fmtIDR(payNow)}</b>{mode === 'added' && priceFactor(branding) > 1 && <span className="text-muted"> incl. service &amp; tax</span>}</span>
          </label>
          {choice !== 'room_charge' && (
            <select className="form-select" style={{ marginLeft: 24, width: 'calc(100% - 24px)' }} value={choice} onChange={e => setChoice(e.target.value)}>
              {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || !choice} onClick={save}>{saving ? 'Saving…' : 'Save payment'}</button>
        </div>
      </div>
    </div>
  );
}
