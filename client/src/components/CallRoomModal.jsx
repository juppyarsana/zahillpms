import { useState, useEffect } from 'react';
import api from '../services/api';
import { useCall } from '../context/CallContext';

const TYPE_ORDER = ['Villa', 'Suite', 'Glamping', 'Deluxe'];
function typeRank(t) {
  const i = TYPE_ORDER.findIndex(x => (t || '').includes(x));
  return i === -1 ? 99 : i;
}
function groupUnitsByType(units) {
  const m = new Map();
  for (const u of units) {
    const k = u.type || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(u);
  }
  return [...m.entries()]
    .map(([type, list]) => ({
      type,
      list: list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.type.localeCompare(b.type));
}

// Room picker for staff placing an outgoing call. Deliberately doesn't show
// an online/offline badge — `GET /api/iot/units`'s `connected` field is the
// ESP32 Room Controller's MQTT status, not the Room Display tablet's (there
// is no tracked presence signal for the tablet app itself), so showing it
// here would be misleading. A call that goes unanswered just rings out and
// is marked missed after 45s, same as the reverse direction already does.
//
// Uses `/api/units` (always-on), not `/api/iot/units` — the latter is gated
// behind the `room_controller` module, which is off by default and has zero
// relation to calling (that's exactly why `calling` was split into its own
// module). Fetching the room list from an iot-gated endpoint silently
// emptied this modal on every hardware-less property — real bug, fixed here.
//
// A single scrolling list-with-a-Call-button-per-row didn't scale past a
// handful of rooms (35 rows to hunt through on Zahill) — grouped tile grid
// (same visual language as the Dashboard's Live Unit Status board) plus a
// search box fits everything on screen and tapping a tile calls directly.
export default function CallRoomModal({ onClose }) {
  const { callRoom } = useCall();
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [callingId, setCallingId] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/api/units')
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

  const filtered = units.filter(u => u.name.toLowerCase().includes(search.trim().toLowerCase()));
  const groups = groupUnitsByType(filtered);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Call a Room</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading rooms…</p>}

          {!loading && units.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No rooms have a controller assigned yet.</p>
          )}

          {!loading && units.length > 0 && (
            <>
              <input
                autoFocus
                className="form-input"
                placeholder="Search room…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ marginBottom: 14 }}
              />

              {filtered.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No rooms match "{search}".</p>
              )}

              {groups.map(g => (
                <div key={g.type} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                    {g.type} · {g.list.length}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 56px)', gap: 8 }}>
                    {g.list.map(unit => (
                      <button
                        key={unit.id}
                        disabled={callingId === unit.id}
                        onClick={() => handleCall(unit)}
                        title={`Call ${unit.name}`}
                        style={{
                          height: 48, borderRadius: 8, border: 'none', cursor: callingId === unit.id ? 'default' : 'pointer',
                          background: callingId === unit.id ? 'var(--text-muted)' : '#5C1A2E',
                          color: '#fff', fontWeight: 700, fontSize: 12,
                        }}
                      >
                        {callingId === unit.id ? '…' : unit.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {error && <div className="alert alert-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
