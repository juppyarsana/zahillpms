import { useState, useEffect } from 'react';
import api from '../services/api';

// Shared by three entry points: CheckIn.jsx's post-check-in success panel,
// BookingDetail.jsx's Download menu (reprint anytime), and Dashboard.jsx's
// per-room popup (front desk prepares it ahead of arrival — the booking may
// still be 'confirmed', not yet 'checked_in'). Home Address and Purpose of
// Stay aren't captured anywhere else, so this doubles as the one place
// staff fills them in — optional, saved back to the guest/booking record
// on print rather than required at booking time.
export default function RegistrationCardModal({ bookingId, onClose }) {
  const [booking, setBooking] = useState(null);
  const [address, setAddress] = useState('');
  const [purpose, setPurpose] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/bookings/${bookingId}`).then(r => {
      if (cancelled) return;
      setBooking(r.data);
      setAddress(r.data.guest_address || '');
      setPurpose(r.data.purpose_of_stay || '');
      setLoading(false);
    }).catch(() => { if (!cancelled) { setError('Failed to load booking'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [bookingId]);

  async function saveAndDownload() {
    setSaving(true);
    setError('');
    try {
      if (address !== (booking.guest_address || '')) {
        await api.put(`/api/guests/${booking.guest_id}`, { address });
      }
      if (purpose !== (booking.purpose_of_stay || '')) {
        await api.put(`/api/bookings/${bookingId}`, { purpose_of_stay: purpose });
      }
      const r = await api.get(`/api/checkin/${bookingId}/registration-card`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `registration-card-${bookingId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate registration card');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.stopPropagation()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Registration Card</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="text-muted">Loading…</div>
          ) : !booking ? (
            <div className="alert alert-error">Booking not found</div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                {booking.guest_name} · {booking.unit_name} · {booking.check_in_date?.slice(0, 10)} – {booking.check_out_date?.slice(0, 10)}
              </div>
              <div className="form-group">
                <label className="form-label">Home Address</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Not on file — optional, fill in if the guest provides it"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Purpose of Stay</label>
                <input
                  className="form-input"
                  placeholder="e.g. Leisure"
                  value={purpose}
                  onChange={e => setPurpose(e.target.value)}
                />
              </div>
              {error && <div className="alert alert-error">{error}</div>}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={saveAndDownload} disabled={loading || saving || !booking}>
            {saving ? 'Generating…' : '🖨 Save & Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
