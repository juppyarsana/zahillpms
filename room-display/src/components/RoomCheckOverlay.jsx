import { useState } from 'react';
import api from '../api';

// Room check / minibar — housekeeping's screen on the room tablet. Opened
// from the small Housekeeping entry in the side rail (HousekeepingEntry
// below), behind the property's PIN since the guest may be using the tablet.
// PIN → tick what was taken from the minibar → two-step "Send to front desk".
// Front desk adds it to the guest's bill; nothing is charged from here.
// The PIN is checked by the server on every call (never stored on the tablet).
//
// Practice (training): after the PIN, "Practice" runs the same room check and
// the Mark Room Clean steps entirely on the tablet — nothing is sent to the
// server, so front desk, Telegram and the guest's bill never see it. Works in
// an empty room too.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

export function HousekeepingEntry({ roomCheck, onOpen }) {
  if (!roomCheck?.enabled) return null;
  return (
    <button onClick={onOpen} title="Housekeeping" className="relative"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: roomCheck.requested ? 'var(--accent)' : 'var(--text-ghost)' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 22 }}>cleaning_services</span>
      {/* front desk is waiting for this room's check */}
      {roomCheck.requested && (
        <span className="absolute animate-pulse" style={{ top: 4, right: 4, width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
      )}
    </button>
  );
}

const pill = (primary, disabled) => ({
  padding: '14px 28px', borderRadius: 999, border: primary ? 'none' : '1px solid var(--border)', cursor: disabled ? 'default' : 'pointer',
  background: primary ? 'var(--accent)' : 'transparent', color: primary ? 'var(--accent-contrast)' : 'var(--text)',
  fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: disabled ? 0.5 : 1,
});

export default function RoomCheckOverlay({ roomId, onClose, onSent }) {
  const [pin, setPin] = useState('');
  const [data, setData] = useState(null);       // { room, items, requested, has_stay }
  const [qty, setQty] = useState({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(null);
  const [practice, setPractice] = useState(null);   // null | 'menu' | 'check' | 'clean'
  const [cleanPhase, setCleanPhase] = useState('idle'); // idle | confirm | done

  const reset = () => { setQty({}); setNote(''); setError(''); setConfirming(false); setSent(null); setCleanPhase('idle'); };
  const goPractice = mode => { reset(); setPractice(mode); };

  async function unlock(value) {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/display/room/${roomId}/room-check/open`, { pin: value });
      setData(r.data);
    } catch (err) {
      setError(err.response?.data?.code === 'WRONG_PIN' ? 'Wrong PIN' : (err.response?.data?.error || 'No connection — try again'));
      setPin('');
    } finally { setBusy(false); }
  }
  const press = d => { if (busy || pin.length >= 6) return; setError(''); setPin(p => p + d); };

  const step = (id, d) => setQty(q => ({ ...q, [id]: Math.max(0, Math.min(99, (q[id] || 0) + d)) }));
  const picked = (data?.items || []).filter(i => qty[i.id] > 0);
  const total = picked.reduce((s, i) => s + i.price * qty[i.id], 0);
  const count = picked.reduce((s, i) => s + qty[i.id], 0);

  async function send() {
    // practice: same steps, nothing leaves the tablet
    if (practice) { setSent({ items: picked.length, total }); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post(`/display/room/${roomId}/room-check`, {
        pin, items: picked.map(i => ({ product_id: i.id, quantity: qty[i.id] })), note,
      });
      setSent(r.data);
      onSent?.();
    } catch (err) {
      setError(err.response?.data?.error || 'No connection — nothing was sent. Try again.');
      setConfirming(false);
    } finally { setBusy(false); }
  }

  const shell = children => (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay)', backdropFilter: 'blur(6px)' }}>
      <div className="bg-surface text-ink flex flex-col" style={{ width: 'min(640px, 94vw)', maxHeight: '92dvh', borderRadius: 24, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div className="flex items-center" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-soft)', gap: 10 }}>
          <span className="material-symbols-outlined text-accent">cleaning_services</span>
          <div style={{ flex: 1 }}>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-accent">Housekeeping</div>
            <div className="text-sm text-muted">{!data ? 'Staff only' : practice ? `Room ${data.room} — practice` : `Room ${data.room} — room check`}</div>
          </div>
          {data && !practice && !sent && (
            <button onClick={() => goPractice('menu')} className="text-muted flex items-center"
              style={{ gap: 6, background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>school</span>Practice
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {practice && (
          <div style={{ background: '#CA8A04', color: '#fff', padding: '8px 20px', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>
            Practice — nothing is sent to front desk
          </div>
        )}
        {children}
      </div>
    </div>
  );

  const practiceEnd = (
    <div className="flex" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
      <button onClick={() => goPractice('menu')} style={pill(false)}>Practise again</button>
      <button onClick={() => goPractice(null)} style={pill(true)}>Finish practice</button>
    </div>
  );

  if (practice === 'menu') {
    const choice = (icon, title, text, mode) => (
      <button onClick={() => goPractice(mode)} className="bg-surface-2 text-ink flex items-center text-left"
        style={{ gap: 14, padding: 16, borderRadius: 16, border: '1px solid var(--border-soft)', cursor: 'pointer', width: '100%' }}>
        <span className="material-symbols-outlined text-accent" style={{ fontSize: 32 }}>{icon}</span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>{title}</span>
          <span className="text-muted text-sm">{text}</span>
        </span>
        <span className="material-symbols-outlined text-muted">chevron_right</span>
      </button>
    );
    return shell(
      <div className="flex flex-col gap-3" style={{ padding: 20 }}>
        <div className="text-muted text-sm">Choose what to practise. Nothing you do here reaches front desk or the guest's bill.</div>
        {choice('kitchen', 'Room check (minibar)', 'Count what was taken and send it to front desk.', 'check')}
        {choice('cleaning_services', 'Mark room clean', 'Confirm a room is cleaned and ready for the next guest.', 'clean')}
        <button onClick={() => goPractice(null)} style={{ ...pill(false), alignSelf: 'center', marginTop: 6 }}>Back to the real room check</button>
      </div>
    );
  }

  // Same card and wording as the vacant screen's "Mark Room Clean".
  if (practice === 'clean') {
    return shell(
      <div className="flex flex-col items-center text-center gap-4" style={{ padding: 28 }}>
        {cleanPhase === 'done' ? (
          <>
            <span className="material-symbols-outlined filled" style={{ fontSize: 56, color: 'var(--ok)' }}>check_circle</span>
            <div className="text-xl">Room marked clean</div>
            <div className="text-muted text-sm">Practice finished — the room's status was not changed.<br />For real, this button is on the screen of an empty room after check-out.</div>
            {practiceEnd}
          </>
        ) : (
          <div className="rounded-2xl flex flex-col items-center gap-4" style={{ padding: '24px 32px', maxWidth: 420, background: 'rgb(202 138 4 / 0.12)', border: '1px solid rgb(202 138 4 / 0.45)' }}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#CA8A04' }}>cleaning_services</span>
              <span className="text-sm font-extrabold uppercase tracking-widest" style={{ color: '#A16207' }}>Housekeeping</span>
            </div>
            {cleanPhase === 'confirm' ? (
              <>
                <p className="text-sm text-muted leading-relaxed">Confirm this room has been fully cleaned and is ready for the next guest?</p>
                <div className="flex gap-3 w-full">
                  <button onClick={() => setCleanPhase('idle')} className="flex-1 rounded-xl py-3 text-xs font-bold uppercase tracking-widest"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>Cancel</button>
                  <button onClick={() => setCleanPhase('done')} className="flex-1 rounded-xl py-3 text-xs font-extrabold uppercase tracking-widest"
                    style={{ background: 'var(--ok)', color: '#fff', border: 'none' }}>Yes, mark clean</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted leading-relaxed">This room needs cleaning before the next guest.</p>
                <button onClick={() => setCleanPhase('confirm')} className="rounded-xl px-8 py-3 text-xs font-extrabold uppercase tracking-widest"
                  style={{ background: '#CA8A04', color: '#fff', border: 'none' }}>Mark Room Clean</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  if (sent) {
    return shell(
      <div className="flex flex-col items-center text-center gap-4" style={{ padding: 32 }}>
        <span className="material-symbols-outlined text-accent" style={{ fontSize: 56 }}>task_alt</span>
        <div className="text-xl">{practice ? 'Practice finished' : 'Sent to front desk'}</div>
        <div className="text-muted">{sent.items ? `${count} item${count === 1 ? '' : 's'} · ${fmtIDR(sent.total)}` : 'Nothing taken from the minibar'}</div>
        {practice && <div className="text-muted text-sm">Nothing was sent to front desk and nothing was added to a bill.</div>}
        {practice ? practiceEnd : <button onClick={onClose} style={pill(true)}>Done</button>}
      </div>
    );
  }

  if (!data) {
    return shell(
      <div className="flex flex-col items-center gap-4" style={{ padding: '24px 20px 28px' }}>
        <div className="text-muted text-sm">Enter the housekeeping PIN</div>
        <div className="flex gap-3" style={{ height: 18 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <span key={i} style={{ width: 14, height: 14, borderRadius: 7, background: i < pin.length ? 'var(--accent)' : 'var(--border)' }} />
          ))}
        </div>
        <div style={{ color: '#ef4444', fontSize: 13, minHeight: 18 }}>{error}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 12 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button key={d} onClick={() => press(d)} className="bg-surface-2 text-ink" style={{ height: 64, borderRadius: 16, border: '1px solid var(--border-soft)', fontSize: 24, fontWeight: 600, cursor: 'pointer' }}>{d}</button>
          ))}
          <button onClick={() => { setPin(p => p.slice(0, -1)); setError(''); }} className="text-muted" style={{ height: 64, borderRadius: 16, border: 'none', background: 'none', cursor: 'pointer' }}>
            <span className="material-symbols-outlined">backspace</span>
          </button>
          <button onClick={() => press('0')} className="bg-surface-2 text-ink" style={{ height: 64, borderRadius: 16, border: '1px solid var(--border-soft)', fontSize: 24, fontWeight: 600, cursor: 'pointer' }}>0</button>
          <button onClick={() => pin.length >= 4 && unlock(pin)} disabled={pin.length < 4 || busy}
            style={{ height: 64, borderRadius: 16, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-contrast)', opacity: pin.length < 4 || busy ? 0.4 : 1 }}>
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </div>
    );
  }

  return shell(
    <>
      <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
        {!practice && data.requested && (
          <div className="accent-tint text-accent text-sm" style={{ borderRadius: 12, padding: '10px 12px', marginBottom: 10, fontWeight: 600 }}>
            Front desk is waiting for this room's check.
          </div>
        )}
        {!practice && !data.has_stay && (
          <div className="text-sm" style={{ borderRadius: 12, padding: '10px 12px', marginBottom: 10, border: '1px solid var(--border)' }}>
            No guest is staying in this room — a check can't be charged to anyone.
          </div>
        )}
        <div className="text-muted text-sm" style={{ marginBottom: 6 }}>Tap + for everything taken from the minibar.</div>
        {data.items.length === 0 && <div className="text-muted" style={{ padding: '14px 0' }}>No minibar items are set up yet — write what you found in the note.</div>}
        {data.items.map(i => (
          <div key={i.id} className="flex items-center" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{i.name}</div>
              <div className="text-muted text-sm">{fmtIDR(i.price)}</div>
            </div>
            <button onClick={() => step(i.id, -1)} disabled={!qty[i.id]} className="bg-surface-2 text-ink"
              style={{ width: 48, height: 48, borderRadius: 24, border: '1px solid var(--border-soft)', fontSize: 24, cursor: 'pointer', opacity: qty[i.id] ? 1 : 0.35 }}>−</button>
            <div style={{ width: 32, textAlign: 'center', fontSize: 20, fontWeight: 700, color: qty[i.id] ? 'var(--accent)' : 'var(--text-dim)' }}>{qty[i.id] || 0}</div>
            <button onClick={() => step(i.id, 1)} className="bg-surface-2 text-ink"
              style={{ width: 48, height: 48, borderRadius: 24, border: '1px solid var(--border-soft)', fontSize: 24, cursor: 'pointer' }}>+</button>
          </div>
        ))}
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note for front desk (damage, missing item…)"
          className="bg-surface-2 text-ink" style={{ width: '100%', marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid var(--border-soft)', fontSize: 15, resize: 'none' }} />
      </div>
      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-soft)' }}>
        {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{error}</div>}
        <div className="flex items-center" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            {count ? <><b>{count}</b> item{count === 1 ? '' : 's'} · <b>{fmtIDR(total)}</b></> : <span className="text-muted">Nothing taken</span>}
          </div>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} disabled={!practice && !data.has_stay} style={pill(true, !practice && !data.has_stay)}>
              {count ? 'Send to front desk' : 'Nothing taken — send'}
            </button>
          ) : (
            <>
              <button onClick={() => setConfirming(false)} disabled={busy} style={pill(false, busy)}>Back</button>
              <button onClick={send} disabled={busy} style={pill(true, busy)}>{busy ? 'Sending…' : 'Yes, send'}</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
