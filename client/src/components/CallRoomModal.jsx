import { useState, useEffect } from 'react';
import api from '../services/api';
import { useCall } from '../context/CallContext';

// Room picker for staff placing an outgoing call. Deliberately doesn't show
// an online/offline badge — `GET /api/iot/units`'s `connected` field is the
// ESP32 Room Controller's MQTT status, not the Room Display tablet's (there
// is no tracked presence signal for the tablet app itself), so showing it
// here would be misleading. A call that goes unanswered just rings out and
// is marked missed after 45s, same as the reverse direction already does.
export default function CallRoomModal({ onClose }) {
  const { callRoom } = useCall();
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [callingId, setCallingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/iot/units')
      .then(({ data }) => setUnits(data.filter(u => u.controller_id)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCall(unit) {
    setError('');
    setCallingId(unit.id);
    try {
      await callRoom(unit);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not place call');
      setCallingId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Call a Room</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {loading && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading rooms…</p>}
          {!loading && units.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No rooms have a controller assigned yet.</p>
          )}
          {units.map(unit => (
            <div
              key={unit.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 4px', borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ fontWeight: 600 }}>{unit.name}</span>
              <button
                className="btn btn-sm btn-primary"
                disabled={callingId === unit.id}
                onClick={() => handleCall(unit)}
              >
                {callingId === unit.id ? 'Calling…' : 'Call'}
              </button>
            </div>
          ))}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
