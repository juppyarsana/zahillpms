import { useState, useEffect } from 'react';
import api from '../services/api';
import AgentPicker from './AgentPicker';
import PriceBasisHint from './PriceBasisHint';
import { fmtIDR, fmtDay, ymd } from '../lib/events';

// New event / change an event's details (migration 106).
// event: the event being changed, or null for a new one. date: a day to start on.
// onSaved(event) after saving.
export default function EventFormModal({ event, date, venues, onClose, onSaved }) {
  const editing = !!event;
  const live = venues.filter(v => v.is_active || v.id === event?.venue_id);
  const [form, setForm] = useState(() => ({
    name: event?.name || '',
    company_name: event?.company_name || '',
    contact_name: event?.contact_name || '',
    contact_phone: event?.contact_phone || '',
    contact_email: event?.contact_email || '',
    venue_id: event?.venue_id || live[0]?.id || '',
    event_date: event?.event_date || date || ymd(new Date()),
    end_date: event?.end_date || date || ymd(new Date()),
    start_time: event?.start_time || '09:00',
    end_time: event?.end_time || '17:00',
    pax: String(event?.pax || ''),
    hire_price: '',
    status: event?.status || 'tentative',
    hold_until: event?.hold_until || '',
    notes: event?.notes || '',
    internal_notes: event?.internal_notes || '',
  }));
  const [agent, setAgent] = useState(event?.agent_id ? { id: event.agent_id, name: event.agent_name } : null);
  const [multiDay, setMultiDay] = useState(!!event && event.end_date !== event.event_date);
  const [group, setGroup] = useState(null);          // the linked group booking
  const [groupQuery, setGroupQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // The group the event is already linked to.
  useEffect(() => {
    if (!event?.reservation_group_id) return;
    api.get('/api/bookings/groups', { params: { when: 'all' } })
      .then(r => setGroup(r.data.find(g => g.id === event.reservation_group_id) || { id: event.reservation_group_id, booker_name: 'Group booking' }))
      .catch(() => setGroup({ id: event.reservation_group_id, booker_name: 'Group booking' }));
  }, [event?.reservation_group_id]);

  useEffect(() => {
    const q = groupQuery.trim();
    if (q.length < 2) { setGroups([]); return; }
    const t = setTimeout(() => {
      api.get('/api/bookings/groups', { params: { when: 'current', q } }).then(r => setGroups(r.data.slice(0, 6))).catch(() => setGroups([]));
    }, 300);
    return () => clearTimeout(t);
  }, [groupQuery]);

  const venue = live.find(v => v.id === form.venue_id);
  const pax = parseInt(form.pax, 10) || 0;
  const tooMany = venue?.capacity && pax > venue.capacity;

  function slot(start, end) { setForm(f => ({ ...f, start_time: start, end_time: end })); }

  // What is still missing — said next to the button, where the person is looking.
  const missing = !form.name.trim() ? 'Give the event a name'
    : !agent && !form.company_name.trim() && !form.contact_name.trim() ? 'Say who it is for: pick a company, or type a company name or contact person'
    : !(pax >= 1) ? 'Enter how many people'
    : !form.event_date ? 'Choose the date'
    : !form.start_time || !form.end_time ? 'Choose the start and end time'
    : form.end_time <= form.start_time ? 'The end time must be after the start time'
    : multiDay && form.end_date < form.event_date ? 'The last day is before the first day'
    : '';

  async function save() {
    if (missing) { setError(missing); return; }
    setSaving(true); setError('');
    const body = {
      ...form,
      pax: pax || undefined,
      end_date: multiDay ? form.end_date : form.event_date,
      agent_id: agent?.id || null,
      reservation_group_id: group?.id || null,
      hold_until: form.status === 'tentative' ? form.hold_until || null : null,
    };
    if (editing) { delete body.status; delete body.hire_price; }
    try {
      const r = editing ? await api.put(`/api/events/${event.id}`, body) : await api.post('/api/events', body);
      onSaved(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the event');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 620, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">{editing ? `Edit event #${event.event_no}` : 'New event'}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Event name *</label>
            <input className="form-input" autoFocus value={form.name} maxLength={200} placeholder="e.g. Annual meeting, Wedding reception"
              onChange={e => set('name', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Company / agent (from the Agents list — optional)</label>
            <AgentPicker value={agent} onChange={setAgent} placeholder="Search company or agent…" preferType="company" noun="company" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{agent ? 'Company name on the invoice (if different)' : 'Company name'}</label>
              <input className="form-input" value={form.company_name} maxLength={200} onChange={e => set('company_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Contact person{agent || form.company_name.trim() ? '' : ' *'}</label>
              <input className="form-input" value={form.contact_name} maxLength={200} onChange={e => set('contact_name', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Phone / WhatsApp</label>
              <input className="form-input" value={form.contact_phone} maxLength={50} onChange={e => set('contact_phone', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.contact_email} maxLength={200} onChange={e => set('contact_email', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Venue</label>
              <select className="form-select" value={form.venue_id} onChange={e => set('venue_id', e.target.value)}>
                {live.map(v => <option key={v.id} value={v.id}>{v.name}{v.capacity ? ` (up to ${v.capacity})` : ''}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">People *</label>
              <input className="form-input" type="number" min={1} value={form.pax} onChange={e => set('pax', e.target.value)} />
              {tooMany && <div style={{ fontSize: 11, color: '#B45309', marginTop: 4 }}>More than the venue holds ({venue.capacity})</div>}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{multiDay ? 'First day' : 'Date'}</label>
              <input className="form-input" type="date" value={form.event_date}
                onChange={e => setForm(f => ({ ...f, event_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date }))} />
            </div>
            {multiDay && (
              <div className="form-group">
                <label className="form-label">Last day</label>
                <input className="form-input" type="date" value={form.end_date} min={form.event_date} onChange={e => set('end_date', e.target.value)} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">From</label>
              <input className="form-input" type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">To</label>
              <input className="form-input" type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap', marginTop: -6, marginBottom: 14, alignItems: 'center' }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => slot('08:00', '12:00')}>Morning</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => slot('13:00', '17:00')}>Afternoon</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => slot('08:00', '17:00')}>Full day</button>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', marginLeft: 6 }}>
              <input type="checkbox" checked={multiDay} onChange={e => setMultiDay(e.target.checked)} /> More than one day (same hours each day)
            </label>
          </div>

          {!editing && (
            <>
              <div className="form-group">
                <label className="form-label">Venue hire for the whole event (IDR) — optional, lines can be added later</label>
                <input className="form-input" type="number" min={0} value={form.hire_price} onChange={e => set('hire_price', e.target.value)} />
                <PriceBasisHint />
                {parseFloat(form.hire_price) > 0 && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{fmtIDR(form.hire_price)}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  {[['enquiry', 'Enquiry', 'nothing held'], ['tentative', 'On hold', 'held, not confirmed'], ['confirmed', 'Confirmed', 'venue reserved']].map(([k, l, h]) => (
                    <button key={k} type="button" className={`btn btn-sm ${form.status === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set('status', k)} title={h}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {form.status === 'tentative' && (
            <div className="form-group">
              <label className="form-label">Hold until (optional — it is only flagged when the day passes, not released)</label>
              <input className="form-input" type="date" value={form.hold_until} onChange={e => set('hold_until', e.target.value)} style={{ maxWidth: 200 }} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Rooms for this event — link a group booking (optional)</label>
            {group ? (
              <div className="flex-between" style={{ gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span style={{ fontSize: 13 }}>
                  👥 <b>{group.booker_name}</b>
                  {group.check_in_date && <span className="text-muted"> · {fmtDay(group.check_in_date, { day: 'numeric', month: 'short' })} – {fmtDay(group.check_out_date, { day: 'numeric', month: 'short' })} · {group.active_rooms ?? group.room_count} rooms</span>}
                </span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setGroup(null)}>Remove</button>
              </div>
            ) : (
              <>
                <input className="form-input" value={groupQuery} placeholder="Search a group by the booker's or a guest's name…" onChange={e => setGroupQuery(e.target.value)} />
                {groups.map(g => (
                  <button key={g.id} type="button" className="btn btn-sm btn-secondary" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}
                    onClick={() => { setGroup(g); setGroupQuery(''); setGroups([]); }}>
                    👥 {g.booker_name} · {fmtDay(g.check_in_date, { day: 'numeric', month: 'short' })} – {fmtDay(g.check_out_date, { day: 'numeric', month: 'short' })} · {g.active_rooms ?? g.room_count} rooms
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Notes / set-up (printed on the function sheet, sent to the kitchen and housekeeping)</label>
            <textarea className="form-input" rows={2} value={form.notes} placeholder="e.g. U-shape, projector, 2 microphones" onChange={e => set('notes', e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Internal notes (staff only)</label>
            <textarea className="form-input" rows={2} value={form.internal_notes} onChange={e => set('internal_notes', e.target.value)} />
          </div>
        </div>
        <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
          {error && <div style={{ flex: '1 1 100%', color: 'var(--danger-text, #B91C1C)', fontSize: 13, fontWeight: 600 }}>⚠ {error}</div>}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !live.length}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  );
}
