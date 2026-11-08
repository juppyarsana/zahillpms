import { useState, useEffect } from 'react';
import api from '../services/api';
import { useCall } from '../context/CallContext';
import { groupUnitsByType } from '../lib/roomTypeOrder';


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
  const { callRoom, missed, refreshMissed } = useCall();
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

  async function markDone(call) {
    try { await api.post(`/api/calls/${call.callId}/missed-done`); refreshMissed(); }
    catch (err) { setError(err.response?.data?.error || 'Could not save'); }
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
          <MissedCalls missed={missed} units={units} callingId={callingId} onCall={handleCall} onDone={markDone} />
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
                          background: callingId === unit.id ? 'var(--text-muted)' : 'var(--green-dark)',
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

const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const hm = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' });
const HOW = { called_back: 'Called back', rang_again: 'Room called again', done: 'Marked done' };

// Missed calls of the last 24 h (migration 161): open ones first with Call back
// / Done; handled ones greyed underneath ("Called back 14:40 · Ayu").
function MissedCalls({ missed, units, callingId, onCall, onDone }) {
  const [showHandled, setShowHandled] = useState(false);
  if (!missed?.calls?.length) return null;
  const open = missed.calls.filter(c => !c.handled);
  const handled = missed.calls.filter(c => c.handled);
  return (
    <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: open.length ? '#DC2626' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Missed calls{open.length ? ` · ${open.length} to call back` : ' · all called back'}
      </div>
      {open.map(c => {
        const unit = units.find(u => u.id === c.unitId);
        return (
          <div key={c.callId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.06)', marginBottom: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Room {c.unitName}{c.guestName ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {c.guestName}</span> : null}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hm(c.at)} · {ago(c.at)}</div>
            </div>
            <button className="btn btn-primary btn-sm" disabled={!unit || callingId === c.unitId} onClick={() => unit && onCall(unit)}>
              {callingId === c.unitId ? 'Calling…' : '📞 Call back'}
            </button>
            <button className="btn btn-secondary btn-sm" title="Handled another way (the guest came to the desk…)" onClick={() => onDone(c)}>Done</button>
          </div>
        );
      })}
      {handled.length > 0 && (
        <button className="btn btn-link btn-sm" style={{ padding: 0, fontSize: 12 }} onClick={() => setShowHandled(v => !v)}>
          {showHandled ? 'Hide' : 'Show'} handled ({handled.length})
        </button>
      )}
      {showHandled && handled.map(c => (
        <div key={c.callId} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 2px' }}>
          Room {c.unitName} · missed {hm(c.at)} — {HOW[c.handled.how]} {hm(c.handled.at)}{c.handled.by ? ` · ${c.handled.by}` : ''}
        </div>
      ))}
    </div>
  );
}
