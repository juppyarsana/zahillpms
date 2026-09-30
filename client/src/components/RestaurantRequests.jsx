import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

// "Restaurant requests" on a reservation (migration 088): front desk takes a
// request for the restaurant — a breakfast box (included breakfast packed for
// an early start: which morning, ready by when, how many) or any other note —
// and the hotel POS shows it (Breakfast page / FO requests). Each new, changed
// or cancelled request also goes out on Telegram.

const fmtDay = s => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayParts = s => {
  const d = new Date(`${s}T00:00:00Z`);
  return {
    wd: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    dm: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
};
const plural = (n, w, pl = `${w}s`) => `${n} ${n === 1 ? w : pl}`;
const fmtStamp = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' }) : '');
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ACTIVE = ['pending', 'deposit_paid', 'confirmed', 'checked_in'];
const BOX_TIMES = ['04:30', '05:00', '05:30', '06:00'];
const NOTE_MAX = 500;
const OTHER_IDEAS = [
  'Extra breakfast box (paid) — charge to room',
  'Birthday cake at dinner',
  'Special diet: ',
];

const sLabel = { fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8, display: 'block' };
const sHint = { fontSize: 12, color: 'var(--text-muted)' };
const stepBtn = { width: 44, height: 44, fontSize: 20, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

export default function RestaurantRequestsCard({ booking }) {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);     // { kind, request? }
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/api/bookings/${booking.id}/restaurant-requests`).then(r => setData(r.data)).catch(() => setData(null));
  }, [booking.id]);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;
  const active = ACTIVE.includes(booking.status);
  const shown = data.requests.filter(r => r.status !== 'cancelled');
  const cancelled = data.requests.length - shown.length;
  if (!active && !shown.length) return null;

  async function cancel(r) {
    if (!window.confirm(`Cancel this ${r.kind === 'breakfast_box' ? 'breakfast box' : 'request'}? The restaurant is told on Telegram.`)) return;
    setError('');
    try { await api.delete(`/api/bookings/${booking.id}/restaurant-requests/${r.id}`); load(); }
    catch (err) { setError(err.response?.data?.error || 'Could not cancel'); }
  }

  return (
    <div className="card mt-3">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>🍽 Restaurant requests</div>
          <div style={sHint}>Shown in the restaurant's POS, with a Telegram message.</div>
        </div>
        {active && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setEdit({ kind: 'breakfast_box' })}>🥡 Breakfast box</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setEdit({ kind: 'other' })}>＋ Other request</button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error mb-2">{error}</div>}

      {shown.length === 0 ? (
        <div style={{ border: '1.5px dashed var(--border)', borderRadius: 10, padding: '14px 16px', ...sHint, lineHeight: 1.5 }}>
          Nothing yet. A guest leaving before the restaurant opens (trekking, early flight)? Add a <b>breakfast box</b>.
          Anything else for the restaurant — a cake, a special diet, extra paid boxes — is an <b>other request</b>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(r => (
            <RequestTile key={r.id} r={r} canEdit={active}
              onEdit={() => setEdit({ kind: r.kind, request: r })} onCancel={() => cancel(r)} />
          ))}
        </div>
      )}
      {cancelled > 0 && <div style={{ ...sHint, fontSize: 11, marginTop: 8 }}>{plural(cancelled, 'cancelled request')} not shown</div>}

      {edit && <RequestModal booking={booking} data={data} {...edit}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function RequestTile({ r, canEdit, onEdit, onCancel }) {
  const box = r.kind === 'breakfast_box';
  const done = r.status === 'done';
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10,
      border: '1px solid var(--border)', background: done ? 'var(--bg-subtle)' : 'var(--white)' }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, background: box ? 'var(--warning-bg)' : 'var(--green-light)' }}>{box ? '🥡' : '🍽'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {box ? plural(r.quantity, 'breakfast box', 'breakfast boxes') : 'Other request'}
            </div>
            <div style={{ ...sHint, marginTop: 1 }}>
              {fmtDay(r.service_date)}
              {r.ready_time && <> · {box ? 'ready by ' : ''}<b style={{ color: 'var(--text)' }}>{r.ready_time}</b></>}
            </div>
          </div>
          <span className={`badge ${done ? 'badge-green' : 'badge-amber'}`}>
            {done ? (box ? '✓ Sent to kitchen' : '✓ Done') : 'Waiting for restaurant'}
          </span>
        </div>
        {r.note && (
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-subtle)', borderLeft: '3px solid var(--border)',
            borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.note}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <div style={{ ...sHint, fontSize: 11 }}>
            {done && <>{box ? 'Sent' : 'Done'}{r.done_by ? ` by ${r.done_by}` : ''} {fmtStamp(r.done_at)} · </>}
            Added by {r.created_by_name || '—'} {fmtStamp(r.created_at)}
            {r.updated_at && ` · changed by ${r.updated_by_name || '—'}`}
          </div>
          {!done && canEdit && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-sm btn-secondary" onClick={onEdit}>Edit</button>
              <button className="btn btn-sm btn-secondary" style={{ color: 'var(--danger-text)' }} onClick={onCancel}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Date as a tap-able tile: weekday, day + month, and a small line under it.
function DayChip({ date, today, active, disabled, sub, onClick }) {
  const { wd, dm } = dayParts(date);
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        minWidth: 84, padding: '8px 10px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'center',
        border: `1.5px solid ${active ? 'var(--green-dark)' : 'var(--border)'}`,
        background: active ? 'var(--green-light)' : 'var(--white)', opacity: disabled ? 0.45 : 1,
      }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: active ? 'var(--green-dark)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {date === today ? 'Today' : wd}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{dm}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
    </button>
  );
}

function RequestModal({ booking, data, kind, request, onClose, onSaved }) {
  const box = kind === 'breakfast_box';
  const mornings = data.mornings.filter(m => m.date >= data.today);
  const stayDays = (() => {
    const out = [];
    const last = String(booking.check_out_date).slice(0, 10);
    for (let d = String(booking.check_in_date).slice(0, 10); d <= last; d = addDays(d, 1)) if (d >= data.today) out.push(d);
    return out;
  })();
  // A box is usually for an early start tomorrow (this morning has mostly gone).
  const firstMorning = mornings.find(m => m.date > data.today && m.breakfast_pax > 0)
    || mornings.find(m => m.breakfast_pax > 0) || mornings[0];
  const [date, setDate] = useState(request?.service_date || (box ? firstMorning?.date : stayDays[0]) || '');
  const [time, setTime] = useState(request?.ready_time || (box ? '05:00' : ''));
  const [qty, setQty] = useState(request?.quantity || (box ? (firstMorning?.breakfast_pax || 1) : 1));
  const [note, setNote] = useState(request?.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const morning = mornings.find(m => m.date === date);
  const maxBoxes = morning?.breakfast_pax || 0;
  const valid = box ? (date && maxBoxes > 0 && /^\d{2}:\d{2}$/.test(time) && qty >= 1 && qty <= maxBoxes) : (date && note.trim());

  function pickMorning(d) {
    setDate(d);
    const m = mornings.find(x => x.date === d);
    if (m) setQty(q => (request ? Math.min(q, Math.max(1, m.breakfast_pax)) : Math.max(1, m.breakfast_pax)));
  }
  function addIdea(text) {
    setNote(n => (n.trim() ? `${n.trim()}\n${text}` : text).slice(0, NOTE_MAX));
  }

  async function save() {
    setSaving(true); setError('');
    const body = { kind, service_date: date, ready_time: time || null, quantity: box ? qty : null, note };
    try {
      if (request) await api.put(`/api/bookings/${booking.id}/restaurant-requests/${request.id}`, body);
      else await api.post(`/api/bookings/${booking.id}/restaurant-requests`, body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  }

  const summary = box
    ? (date && maxBoxes ? `${plural(qty, 'box', 'boxes')} · ${fmtDay(date)} · ready ${time || '—'}` : '')
    : (date ? `${fmtDay(date)}${time ? ` · ${time}` : ''}` : '');

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-header" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="modal-title">{box ? '🥡 Breakfast box' : '🍽 Other request'}{request ? ' — change' : ''}</div>
            <div style={{ ...sHint, marginTop: 2 }}>Room {booking.unit_name} · {booking.guest_name}</div>
          </div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', ...sHint, lineHeight: 1.5 }}>
            {box
              ? 'The standard breakfast box instead of breakfast at the restaurant — for a guest leaving early. Some of the room can take a box while the others still eat at the restaurant.'
              : 'Anything for the restaurant. If it has to be paid, say how (charge to room or pay at the restaurant) — the restaurant rings it up at its own till.'}
          </div>

          {error && <div className="alert alert-error" style={{ margin: 0 }}>{error}</div>}

          {box ? (<>
            <div>
              <span style={sLabel}>Which morning</span>
              {mornings.length === 0
                ? <div className="alert alert-warn" style={{ margin: 0 }}>No breakfast mornings left in this stay.</div>
                : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {mornings.map(m => (
                      <DayChip key={m.date} date={m.date} today={data.today} active={date === m.date}
                        disabled={!m.breakfast_pax} onClick={() => pickMorning(m.date)}
                        sub={m.breakfast_pax ? plural(m.breakfast_pax, 'breakfast') : 'no breakfast'} />
                    ))}
                  </div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
              <div>
                <span style={sLabel}>Ready by</span>
                <input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} style={{ fontSize: 18, fontWeight: 700 }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {BOX_TIMES.map(t => (
                    <button key={t} type="button" onClick={() => setTime(t)}
                      className={`btn btn-sm ${time === t ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '4px 10px' }}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <span style={sLabel}>How many boxes</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" className="btn btn-secondary" style={stepBtn}
                    onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
                  <div style={{ fontSize: 28, fontWeight: 800, minWidth: 36, textAlign: 'center' }}>{qty}</div>
                  <button type="button" className="btn btn-secondary" style={stepBtn}
                    onClick={() => setQty(q => Math.min(maxBoxes || 1, q + 1))} disabled={qty >= maxBoxes}>+</button>
                </div>
                {maxBoxes > 0 && (
                  <div style={{ ...sHint, marginTop: 8 }}>
                    of {plural(maxBoxes, 'breakfast')} included
                    {qty < maxBoxes && <> · <b style={{ color: 'var(--text)' }}>{maxBoxes - qty}</b> at the restaurant</>}
                  </div>
                )}
              </div>
            </div>
            {morning && !morning.breakfast_pax && (
              <div className="alert alert-warn" style={{ margin: 0 }}>No breakfast included that morning — use “Other request” instead (the restaurant charges it).</div>
            )}
          </>) : (<>
            <div>
              <span style={sLabel}>Which day</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {stayDays.map(d => (
                  <DayChip key={d} date={d} today={data.today} active={date === d} onClick={() => setDate(d)} />
                ))}
              </div>
            </div>
            <div>
              <span style={sLabel}>Time <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} style={{ maxWidth: 160 }} />
                {time && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setTime('')}>Any time</button>}
              </div>
            </div>
          </>)}

          <div>
            <span style={sLabel}>
              {box ? <>Note <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></> : 'What does the guest ask for?'}
            </span>
            {!box && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {OTHER_IDEAS.map(t => (
                  <button key={t} type="button" className="btn btn-sm btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }}
                    onClick={() => addIdea(t)}>＋ {t.replace(/: $/, '')}</button>
                ))}
              </div>
            )}
            <textarea className="form-textarea" autoFocus={!box} maxLength={NOTE_MAX} value={note}
              onChange={e => setNote(e.target.value)} rows={box ? 4 : 6}
              style={{ width: '100%', minHeight: box ? 100 : 150, lineHeight: 1.5 }}
              placeholder={box ? 'e.g. one box without egg · pick up at the lobby' : 'e.g. 2 extra breakfast boxes, paid — charge to room\nBirthday cake at dinner, 19:00, "Happy birthday Anna"'} />
            <div style={{ ...sHint, fontSize: 11, textAlign: 'right', marginTop: 4 }}>{note.length}/{NOTE_MAX}</div>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ ...sHint, fontWeight: 600 }}>{summary}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-primary" disabled={!valid || saving} onClick={save}>
              {saving ? 'Saving…' : request ? 'Save changes' : 'Send to restaurant'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
