import { useState, useEffect, useCallback } from 'react';
import api from '../api';

const CONFIRMATION_MS = 5000;
const TODAY = () => new Date().toISOString().slice(0, 10);

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// A focused, single-activity booking panel — reached only via "Book Now" on
// a Guest Board card (ExploreTab), never as its own catalog-browsing nav
// entry. Activities not promoted on a Guest Board card aren't reachable
// here; that's intentional, see CLAUDE.md's Guest Board <-> Activities note.
export default function BookActivityTab({ roomId, activityId, onBack, onBooked }) {
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(TODAY());
  const [scheduledTime, setScheduledTime] = useState('');
  const [participants, setParticipants] = useState(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);

  const loadActivity = useCallback(async () => {
    try {
      const { data } = await api.get(`/display/room/${roomId}/activities`);
      const match = data.find(a => a.id === activityId);
      if (match) { setActivity(match); setNotFound(false); }
      else setNotFound(true);
    } catch {
      setError('Could not load this activity. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [roomId, activityId]);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  async function submitRequest() {
    if (!activity || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/display/room/${roomId}/activities/book`, {
        activity_id: activity.id,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime || null,
        num_participants: participants,
        notes: notes || null,
      });
      setConfirmed(true);
      onBooked?.();
      setTimeout(() => { setConfirmed(false); onBack?.(); }, CONFIRMATION_MS);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'CAPACITY_FULL') {
        setError('Sorry, that date is fully booked. Please choose another date.');
      } else {
        setError(data?.error || 'Could not send your request. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-bg-dark gap-6">
        <span className="material-symbols-outlined" style={{ fontSize: 96, color: '#c9a227' }}>check_circle</span>
        <h2 className="text-4xl font-extralight text-white">Request sent!</h2>
        <p className="text-slate-400 text-sm">The front desk will confirm your booking shortly.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-bg-dark overflow-y-auto">
      <div className="w-full flex flex-col gap-5" style={{ maxWidth: 440, padding: '40px 24px' }}>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-slate-500 text-xs font-bold uppercase tracking-widest"
          style={{ background: 'none', border: 'none', cursor: 'pointer', width: 'fit-content' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span> Back
        </button>

        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && notFound && <p className="text-slate-500 text-sm">This activity is no longer available.</p>}

        {activity && (
          <>
            <div>
              <h2 className="text-2xl font-extralight text-white mb-1">{activity.name}</h2>
              {activity.description && <p className="text-slate-500 text-sm">{activity.description}</p>}
              <p className="mt-2" style={{ color: '#c9a227', fontSize: 16, fontWeight: 600 }}>
                {fmtIDR(activity.price)} / person{activity.duration_minutes ? ` · ${activity.duration_minutes} min` : ''}
              </p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-slate-400 text-xs uppercase tracking-widest">Date</span>
              <input
                type="date" min={TODAY()} value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm text-white"
                style={{ background: 'rgba(255,255,255,0.06)', border: 'none' }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-slate-400 text-xs uppercase tracking-widest">Preferred Time (optional)</span>
              <input
                type="time" value={scheduledTime}
                onChange={e => setScheduledTime(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm text-white"
                style={{ background: 'rgba(255,255,255,0.06)', border: 'none' }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-slate-400 text-xs uppercase tracking-widest">Participants</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setParticipants(p => Math.max(1, p - 1))} className="w-7 h-7 rounded-full flex items-center justify-center text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>−</button>
                <span className="text-white text-sm w-4 text-center">{participants}</span>
                <button onClick={() => setParticipants(p => p + 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>+</button>
              </div>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-slate-400 text-xs uppercase tracking-widest">Notes (optional)</span>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                className="rounded-lg px-3 py-2 text-sm text-white resize-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: 'none' }}
              />
            </label>

            {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

            <div className="pt-3 border-t border-white/5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 text-sm">Estimated Total</span>
                <span className="text-white text-xl font-light">{fmtIDR(activity.price * participants)}</span>
              </div>
              <button
                onClick={submitRequest}
                disabled={submitting}
                className="w-full py-3.5 rounded-xl text-sm font-bold uppercase tracking-widest"
                style={{
                  background: submitting ? 'rgba(255,255,255,0.06)' : '#c9a227',
                  color: submitting ? '#475569' : '#0a0d12',
                  cursor: submitting ? 'default' : 'pointer',
                }}
              >
                {submitting ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
