import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';
import { propertyToday, fmtYmd, PROPERTY_TZ } from '../lib/propertyTime';

// Staff notes on a booking (booking_notes, migration 139): newest first, a
// multi-line box to add one with an optional "Remind on" day (the note is
// then listed on that day's Dashboard and Guest Lists), and ✏ / 🗑 for the
// person who wrote it or the owner (the old text goes to Edit History).

export function noteTime(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: PROPERTY_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function RemindChip({ day }) {
  if (!day) return null;
  const today = propertyToday();
  const cls = day < today ? 'past' : day === today ? 'today' : '';
  return <span className={`staff-note-remind ${cls}`}>⏰ {day === today ? 'Today' : fmtYmd(day, { weekday: 'short', day: 'numeric', month: 'short' })}</span>;
}

// Read-only list (Check-in / out rows, checkout window, Dashboard room window).
export function NotesPreview({ notes, max = 3 }) {
  if (!notes?.length) return null;
  const shown = notes.slice(0, max);
  return (
    <div className="staff-notes-preview">
      {shown.map(n => (
        <div key={n.id} className="staff-note-preview">
          <span className="staff-note-preview-label">📌</span>
          <span style={{ whiteSpace: 'pre-wrap' }}>{n.content}</span>
          {n.remind_on && <> <RemindChip day={n.remind_on} /></>}
          <span className="staff-note-preview-meta"> — {n.author_name || 'Staff'}</span>
        </div>
      ))}
      {notes.length > max && <div className="text-muted" style={{ fontSize: 12 }}>+ {notes.length - max} more staff note{notes.length - max > 1 ? 's' : ''} on the booking</div>}
    </div>
  );
}

function NoteForm({ initial = {}, saveLabel, onSave, onCancel }) {
  const [content, setContent] = useState(initial.content || '');
  const [remind, setRemind] = useState(initial.remind_on || '');
  const [showRemind, setShowRemind] = useState(!!initial.remind_on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!content.trim()) return;
    setBusy(true); setError('');
    try {
      await onSave({ content: content.trim(), remind_on: showRemind && remind ? remind : null });
      if (!initial.content) { setContent(''); setRemind(''); setShowRemind(false); }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the note');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="staff-note-form">
      <textarea className="form-input" rows={3} placeholder="Add a note for the team…" value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }} />
      <div className="staff-note-form-row">
        {showRemind ? (
          <label className="staff-note-remind-field">
            ⏰ Remind on
            <input type="date" className="form-input" value={remind} min={initial.remind_on ? undefined : propertyToday()}
              onChange={e => setRemind(e.target.value)} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setShowRemind(false); setRemind(''); }}>✕</button>
          </label>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowRemind(true)}>⏰ Remind on a day…</button>
        )}
        <div style={{ flex: 1 }} />
        {onCancel && <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !content.trim()}>
          {busy ? 'Saving…' : saveLabel}
        </button>
      </div>
      {showRemind && <div className="text-muted" style={{ fontSize: 12 }}>The note shows on that day's Dashboard and Guest Lists.</div>}
      {error && <div className="staff-note-error" style={{ fontSize: 13 }}>{error}</div>}
    </div>
  );
}

export default function StaffNotes({ bookingId, notes = [], onChanged }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(null);   // note id
  const [error, setError] = useState('');
  const mayChange = n => user?.role === 'owner' || n.author_id === user?.id;

  async function add(body) {
    await api.post(`/api/bookings/${bookingId}/note`, body);
    onChanged?.();
  }
  async function save(n, body) {
    await api.put(`/api/bookings/${bookingId}/notes/${n.id}`, body);
    setEditing(null);
    onChanged?.();
  }
  async function remove(n) {
    if (!window.confirm('Delete this note? Its text stays in Edit History.')) return;
    setError('');
    try {
      await api.delete(`/api/bookings/${bookingId}/notes/${n.id}`);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete the note');
    }
  }

  return (
    <div className="staff-notes">
      <NoteForm saveLabel="Add note" onSave={add} />
      {notes.length === 0 && <div className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>No notes yet.</div>}
      {notes.map(n => (
        <div key={n.id} className="staff-note">
          {editing === n.id ? (
            <NoteForm initial={n} saveLabel="Save" onSave={body => save(n, body)} onCancel={() => setEditing(null)} />
          ) : (
            <>
              <div className="staff-note-head">
                <span className="staff-note-author">{n.author_name || 'Staff'}</span>
                <span className="staff-note-meta">
                  {noteTime(n.created_at)}
                  {n.edited_at && <> · edited {noteTime(n.edited_at)}{n.edited_by_name && n.edited_by_name !== n.author_name ? ` by ${n.edited_by_name}` : ''}</>}
                </span>
                <RemindChip day={n.remind_on} />
                {mayChange(n) && (
                  <span className="staff-note-actions">
                    <button className="btn btn-sm btn-ghost" title="Edit" onClick={() => setEditing(n.id)}><Icon name="edit" size={15} /></button>
                    <button className="btn btn-sm btn-ghost" title="Delete" onClick={() => remove(n)}><Icon name="trash" size={15} /></button>
                  </span>
                )}
              </div>
              <div className="staff-note-body">{n.content}</div>
            </>
          )}
        </div>
      ))}
      {error && <div className="staff-note-error" style={{ fontSize: 13 }}>{error}</div>}
    </div>
  );
}

// "Reminders" card: staff notes whose reminder day is `date` (Dashboard =
// today, Guest Lists = the date shown). Nothing shown when there are none.
export function NoteReminders({ date, title = 'Reminders from staff notes' }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/api/bookings/note-reminders', { params: date ? { date } : {} })
      .then(r => { if (live) setList(r.data.reminders); })
      .catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [date]);
  if (!list?.length) return null;
  return (
    <div className="card card-note" style={{ marginBottom: 16 }}>
      <div className="card-title">⏰ {title} ({list.length})</div>
      {list.map(r => (
        <Link key={r.id} to={`/reservations/${r.booking_id}`} className="staff-reminder-row">
          <div className="staff-reminder-room">{r.unit_name}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="staff-reminder-guest">{r.guest_name}
              <span className="staff-note-preview-meta"> · {fmtYmd(r.check_in_date)} – {fmtYmd(r.check_out_date)} · note by {r.author_name || 'staff'}</span>
            </div>
            <div className="staff-note-body" style={{ fontSize: 14 }}>{r.content}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
