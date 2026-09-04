import { useState, useEffect } from 'react';
import api from '../api';
import AlarmTimePicker, { formatDisplay } from './AlarmTimePicker';

// Front Desk call + guest self-service housekeeping (Do Not Disturb / Clean
// Room, posted as real tasks on the Operations kanban) + a local wake-up
// alarm. Lives in the Stay panel's own empty space rather than the cramped
// sidebar rail.
export default function QuickActions({
  roomId, operationsEnabled,
  callingEnabled, onCallFrontDesk, callActive,
  alarmTime, alarmEnabled, onSetAlarm,
}) {
  const dndStorageKey = `dndTaskId:${roomId}`;
  const [dndTaskId, setDndTaskId] = useState(() => localStorage.getItem(dndStorageKey) || null);
  const [dndBusy, setDndBusy] = useState(false);
  const [cleanRequested, setCleanRequested] = useState(false);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Re-sync from storage if the device's room changes without this
  // component unmounting (e.g. reconfigured via the debug menu) — otherwise
  // a stale in-memory dndTaskId from the old room can never resolve here.
  useEffect(() => {
    setDndTaskId(localStorage.getItem(dndStorageKey) || null);
  }, [dndStorageKey]);

  const toggleDnd = async () => {
    if (dndBusy) return;
    setDndBusy(true);
    if (dndTaskId) {
      // Turning off is always effective locally first — a guest stuck
      // unable to turn off DND because a stale/mismatched task_id 404s
      // server-side is worse than a rare missed sync back to the kanban.
      const idToCancel = dndTaskId;
      localStorage.removeItem(dndStorageKey);
      setDndTaskId(null);
      try {
        await api.post(`/display/room/${roomId}/housekeeping`, { type: 'dnd', action: 'cancel', task_id: idToCancel });
      } catch { /* best-effort — task may already be resolved/stale, UI already reflects off */ }
    } else {
      try {
        const { data } = await api.post(`/display/room/${roomId}/housekeeping`, { type: 'dnd', action: 'request' });
        localStorage.setItem(dndStorageKey, data.task_id);
        setDndTaskId(data.task_id);
      } catch { /* leave off — guest can retry */ }
    }
    setDndBusy(false);
  };

  const requestClean = async () => {
    if (cleanBusy || cleanRequested) return;
    setCleanBusy(true);
    try {
      await api.post(`/display/room/${roomId}/housekeeping`, { type: 'clean' });
      setCleanRequested(true);
      setTimeout(() => setCleanRequested(false), 8000);
    } catch { /* no-op — button just stays tappable */ }
    setCleanBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {callingEnabled && (
        <button
          onClick={onCallFrontDesk}
          disabled={callActive}
          className="w-full flex items-center justify-center gap-2.5 rounded-2xl"
          style={{
            padding: '17px 0', border: 'none', cursor: callActive ? 'default' : 'pointer',
            background: 'var(--danger)', color: '#fff',
            boxShadow: callActive ? 'none' : '0 6px 18px rgba(179,38,30,0.35)',
            opacity: callActive ? 0.5 : 1, transition: 'opacity 0.2s',
          }}
        >
          <span className="material-symbols-outlined filled" style={{ fontSize: 22 }}>call</span>
          <span className="text-sm font-extrabold uppercase tracking-widest">{callActive ? 'Calling…' : 'Call Front Desk'}</span>
        </button>
      )}

      {operationsEnabled && (
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={toggleDnd}
            disabled={dndBusy}
            className="rounded-2xl px-3 py-4 flex flex-col items-center gap-2"
            style={{
              background: dndTaskId ? 'var(--accent)' : 'var(--surface)',
              border: '1px solid var(--border)',
              color: dndTaskId ? 'var(--accent-contrast)' : 'var(--text)',
              cursor: dndBusy ? 'default' : 'pointer',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 26 }}>do_not_disturb_on</span>
            <span className="text-[10px] font-bold uppercase tracking-wider">{dndTaskId ? 'DND On' : 'Do Not Disturb'}</span>
          </button>
          <button
            onClick={requestClean}
            disabled={cleanBusy || cleanRequested}
            className="glass-card rounded-2xl px-3 py-4 flex flex-col items-center gap-2 text-ink"
            style={{ cursor: cleanBusy || cleanRequested ? 'default' : 'pointer' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 26 }}>cleaning_services</span>
            <span className="text-[10px] font-bold uppercase tracking-wider">{cleanRequested ? 'Requested' : 'Clean Room'}</span>
          </button>
        </div>
      )}

      <div className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <span className="material-symbols-outlined text-accent" style={{ fontSize: 22 }}>alarm</span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-dim mb-1">Alarm</p>
            <button
              onClick={() => setPickerOpen(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 14, fontWeight: 700, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              {formatDisplay(alarmTime || '07:00')}
              <span className="material-symbols-outlined text-dim" style={{ fontSize: 16 }}>expand_more</span>
            </button>
          </div>
        </div>
        <button
          onClick={() => onSetAlarm(alarmTime || '07:00', !alarmEnabled)}
          role="switch"
          aria-checked={alarmEnabled}
          style={{
            width: 46, height: 27, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
            background: alarmEnabled ? 'var(--accent)' : 'var(--surface-2)', transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: alarmEnabled ? 22 : 3, width: 21, height: 21, borderRadius: '50%',
            background: '#fff', transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {pickerOpen && (
        <AlarmTimePicker
          time={alarmTime || '07:00'}
          onChange={(t) => onSetAlarm(t, alarmEnabled)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
