import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { chime } from './OtaInbox';

// Room checks housekeeping has sent (minibar, migration 091) that front desk
// has not added to the bill or set aside yet. One poll for the whole app
// (RoomCheckInboxProvider in Layout): a pop-up on every page (RoomCheckPopup,
// OK hides it on this computer only) and a line in Today → Needs you now
// (useRoomChecksWaiting — stays until the check is charged or set aside).

const POLL_MS = 15_000;
const SEEN_KEY = 'roomCheckSeen';
const Ctx = createContext({ enabled: false, waiting: [], unseen: [] });
export const useRoomChecksWaiting = () => useContext(Ctx);

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function writeSeen(set, keep) {
  // Only remember ids still waiting, so the list never grows.
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].filter(id => keep.has(id)))); } catch { /* private window */ }
}

export function RoomCheckInboxProvider({ children }) {
  const { user, can, hasModule } = useAuth();
  const enabled = !!user && !user.is_superadmin && hasModule('sales') && (can('checkin_full') || can('quick_checkin'));
  const [waiting, setWaiting] = useState([]);
  const [seen, setSeen] = useState(readSeen);
  const known = useRef(null);   // ids already shown in this tab (no chime twice)

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await api.get('/api/room-checks/waiting');
      const ids = data.map(r => r.id);
      const fresh = ids.filter(id => !(known.current || new Set()).has(id) && !readSeen().has(id));
      if (known.current && fresh.length) chime();
      known.current = new Set([...(known.current || []), ...ids]);
      setWaiting(data);
    } catch { /* keep the last list; tried again on the next poll */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setWaiting([]); return undefined; }
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, refresh]);

  const markSeen = useCallback((ids) => {
    setSeen(prev => {
      const next = new Set([...prev, ...ids]);
      writeSeen(next, new Set([...waiting.map(r => r.id), ...ids]));
      return next;
    });
  }, [waiting]);

  const unseen = waiting.filter(r => !seen.has(r.id));
  return <Ctx.Provider value={{ enabled, waiting, unseen, refresh, markSeen }}>{children}</Ctx.Provider>;
}

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

// "2 × Bintang, 1 × Coca-Cola · Rp 120.000", or "Nothing taken".
export function roomCheckSummary(r) {
  if (!r.items?.length) return 'Nothing taken from the minibar';
  const list = r.items.map(i => `${i.quantity} × ${i.name}`).join(', ');
  return `${list} · ${fmtIDR(r.total)}`;
}

export const roomCheckPath = r => (r.booking_id ? `/reservations/${r.booking_id}#room-check` : null);

export function RoomCheckPopup() {
  const { enabled, unseen, markSeen } = useRoomChecksWaiting();
  const navigate = useNavigate();
  if (!enabled || !unseen.length) return null;
  const shown = unseen.slice(-3).reverse();   // newest on top
  const more = unseen.length - shown.length;
  return (
    <div className="ota-popup rc-popup" role="status" aria-live="polite">
      {shown.map(r => {
        const path = roomCheckPath(r);
        return (
          <div key={r.id} className="ota-popup-card" style={{ borderLeftColor: '#0F766E' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span>🧺</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#0F766E', fontSize: 13 }}>Room {r.room} — room check from housekeeping</div>
                {r.guest_name && <div style={{ fontWeight: 600 }}>{r.guest_name}</div>}
                <div style={{ fontSize: 13, marginTop: 2 }}>{roomCheckSummary(r)}</div>
                {r.note && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted, #6B7280)' }}>📝 {r.note}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
              {path && <button className="btn btn-secondary btn-sm" onClick={() => { markSeen([r.id]); navigate(path); }}>Open</button>}
              <button className="btn btn-primary btn-sm" onClick={() => markSeen([r.id])}>OK</button>
            </div>
          </div>
        );
      })}
      {more > 0 && (
        <div className="ota-popup-more">
          <button className="btn-link" onClick={() => markSeen(unseen.map(r => r.id))}>+ {more} more · All seen</button>
        </div>
      )}
    </div>
  );
}
