import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import GuestPicker from './GuestPicker';
import GuestIdDocument from './GuestIdDocument';

// Other guests in the room (migration 112) — optional. The booking stays
// under its main guest; anyone else sleeping in the room can be added here
// (an existing guest, or a new one with name / nationality / passport) with
// their own ID photo / scan. Used on the booking page's Guest card and in the
// Check-in steps. `guests` = the list already loaded (booking page); without
// it the component loads the list itself.
export default function OtherGuests({ bookingId, guests: given, onChanged, readOnly = false, compact = false }) {
  const [guests, setGuests] = useState(given || []);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (given) setGuests(given); }, [given]);
  useEffect(() => {
    if (given || !bookingId) return;
    api.get(`/api/bookings/${bookingId}/guests`).then(r => setGuests(r.data)).catch(() => {});
  }, [bookingId, given]);

  async function reload() {
    const r = await api.get(`/api/bookings/${bookingId}/guests`);
    setGuests(r.data);
    onChanged?.();
  }

  async function add() {
    if (!pick) return;
    setSaving(true);
    setError('');
    try {
      const body = pick.guest_id ? { guest_id: pick.guest_id } : { new_guest: pick.new_guest };
      const r = await api.post(`/api/bookings/${bookingId}/guests`, body);
      setGuests(r.data.guests);
      setAdding(false);
      setPick(null);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add the guest');
    } finally {
      setSaving(false);
    }
  }

  async function remove(g) {
    if (!window.confirm(`Take ${g.name} off this room? Their guest profile is kept.`)) return;
    try {
      const r = await api.delete(`/api/bookings/${bookingId}/guests/${g.id}`);
      setGuests(r.data.guests);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove the guest');
    }
  }

  return (
    <div style={{ marginTop: compact ? 12 : 0, borderTop: compact ? '1px solid var(--border)' : 'none', paddingTop: compact ? 10 : 0 }}>
      <div className="flex-between" style={{ marginBottom: 6 }}>
        <span className="text-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Other guests in the room{guests.length ? ` (${guests.length})` : ''}
        </span>
        {!readOnly && !adding && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setAdding(true); setError(''); }}>+ Add guest</button>
        )}
      </div>
      {guests.length === 0 && !adding && (
        <div className="text-muted" style={{ fontSize: 12 }}>None added — optional.</div>
      )}
      {guests.map(g => (
        <div key={g.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
          <div className="flex-between" style={{ gap: 8 }}>
            <div>
              <Link to={`/guests/${g.id}`} style={{ fontWeight: 600 }}>{g.name}</Link>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {[g.nationality, g.id_number && `ID ${g.id_number}`, g.whatsapp].filter(Boolean).join(' · ') || 'No details yet'}
              </div>
            </div>
            {!readOnly && (
              <button type="button" className="btn btn-sm btn-secondary" title="Take off this room" onClick={() => remove(g)}>✕</button>
            )}
          </div>
          <GuestIdDocument guestId={g.id} hasDocument={!!g.has_id_document} onChanged={reload} compact />
        </div>
      ))}
      {adding && (
        <div style={{ border: '1px dashed var(--border)', borderRadius: 6, padding: 10 }}>
          <GuestPicker value={pick} onChange={setPick} />
          <div className="flex gap-2" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setAdding(false); setPick(null); setError(''); }}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!pick || saving} onClick={add}>
              {saving ? 'Adding…' : 'Add to this room'}
            </button>
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: 'var(--danger-text)', marginTop: 4 }}>{error}</div>}
    </div>
  );
}
