import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import ActionMenu from '../components/ActionMenu';
import ReasonModal from '../components/ReasonModal';
import EventFormModal from '../components/EventFormModal';
import { StatusBadge } from './Events';
import { MEAL_KINDS, mealLabel, fmtIDR, fmtDay, whenText, ymd, downloadPdf, STATUS } from '../lib/events';

// One event (migration 106): its details, the meals the restaurant prepares,
// its bill (venue hire, other lines, restaurant bills the POS charges to it),
// payments and history. Server: /api/events/:id (services/eventService.js).

function Modal({ title, onClose, children, footer, width = 460 }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: width, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

// How a price typed on this event is read (its own rates, kept from when it was made).
function basisText(bill) {
  const sc = bill.service_charge_rate, tax = bill.tax_rate;
  if (!sc && !tax) return '';
  return bill.prices_include_tax ? `Including service ${sc}% & tax ${tax}% — what the client pays` : `Before service ${sc}% & tax ${tax}% — they are added on top`;
}

function LineModal({ event, bill, onClose, onSaved }) {
  const [form, setForm] = useState({ type: 'other', description: '', service_date: event.event_date, quantity: '1', price: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const lineTotal = (parseFloat(form.price) || 0) * (parseFloat(form.quantity) || 0);
  async function save() {
    setSaving(true); setError('');
    try { await api.post(`/api/events/${event.id}/charges`, form); onSaved(); }
    catch (err) { setError(err.response?.data?.error || 'Could not add the line'); setSaving(false); }
  }
  return (
    <Modal title="Add a line to the bill" onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving || !form.description.trim() || !(parseFloat(form.price) > 0)} onClick={save}>Add line</button></>}>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
      <div className="form-group">
        <label className="form-label">What is it</label>
        <div className="flex gap-2" style={{ marginBottom: 8 }}>
          {[['venue', 'Venue hire'], ['other', 'Something else']].map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${form.type === k ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setForm(f => ({ ...f, type: k, description: k === 'venue' && !f.description ? `${event.venue_name} hire` : f.description }))}>{l}</button>
          ))}
        </div>
        <input className="form-input" autoFocus value={form.description} maxLength={300} placeholder="e.g. Projector & sound system, Extra hour"
          onChange={e => set('description', e.target.value)} />
        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Meals are not typed here: the restaurant rings them up and charges them to the event.</div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Price each (IDR)</label>
          <input className="form-input" type="number" min={0} value={form.price} onChange={e => set('price', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Quantity</label>
          <input className="form-input" type="number" min={1} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={form.service_date} onChange={e => set('service_date', e.target.value)} />
        </div>
      </div>
      <div className="text-muted" style={{ fontSize: 11 }}>{basisText(bill)}{lineTotal > 0 ? ` · line ${fmtIDR(lineTotal)}` : ''}</div>
    </Modal>
  );
}

function MealModal({ event, bill, meal, onClose, onSaved }) {
  const [form, setForm] = useState({
    kind: meal?.kind || 'coffee_break', service_date: meal?.service_date || event.event_date,
    service_time: meal?.service_time || '', pax: String(meal?.pax || event.pax), note: meal?.note || '',
    price: meal?.price != null ? String(Math.round(meal.price)) : '',
  });
  const mealTotal = (parseFloat(form.price) || 0) * (parseInt(form.pax, 10) || 0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function save() {
    setSaving(true); setError('');
    try {
      if (meal) await api.put(`/api/events/${event.id}/meals/${meal.id}`, form);
      else await api.post(`/api/events/${event.id}/meals`, form);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'Could not save the meal'); setSaving(false); }
  }
  return (
    <Modal title={meal ? 'Change the meal' : 'Add a meal for the restaurant'} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{meal ? 'Save' : 'Add meal'}</button></>}>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
      <div className="form-group">
        <label className="form-label">What</label>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {MEAL_KINDS.map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${form.kind === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set('kind', k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="form-row">
        {event.end_date !== event.event_date && (
          <div className="form-group">
            <label className="form-label">Day</label>
            <input className="form-input" type="date" min={event.event_date} max={event.end_date} value={form.service_date} onChange={e => set('service_date', e.target.value)} />
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Time</label>
          <input className="form-input" type="time" value={form.service_time} onChange={e => set('service_time', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">People</label>
          <input className="form-input" type="number" min={1} value={form.pax} onChange={e => set('pax', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Notes for the kitchen{form.kind === 'other' ? ' (required)' : ''}</label>
        <input className="form-input" value={form.note} maxLength={1000} placeholder="e.g. buffet, 2 vegetarian, snack box" onChange={e => set('note', e.target.value)} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Price per person agreed with the client (IDR) — optional</label>
        <input className="form-input" type="number" min={0} value={form.price} onChange={e => set('price', e.target.value)} style={{ maxWidth: 220 }} />
        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
          {basisText(bill)}{mealTotal > 0 ? ` · ${form.pax} × ${fmtIDR(form.price)} = ${fmtIDR(mealTotal)}` : ''}
          {' '}It shows on the pro forma and counts in the balance. The restaurant still rings the meal up in the POS — its bill then replaces this line.
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ event, balance, refund, refundable, onClose, onSaved }) {
  const { paymentMethods } = useSettings();
  const methods = paymentMethods.filter(m => m.is_active !== false && m.id !== 'ota_managed');
  const start = refund ? refundable : balance;
  const [form, setForm] = useState({
    amount: start > 0 ? String(Math.round(start)) : '', method: methods.find(m => m.id === 'bank_transfer')?.id || methods[0]?.id || '',
    date: ymd(new Date()), reference: '', notes: '', reason: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const amount = Math.round(parseFloat(form.amount) || 0);
  async function save() {
    setSaving(true); setError('');
    try {
      if (refund) await api.post(`/api/events/${event.id}/refund`, { amount, method: form.method, refunded_at: form.date, reference: form.reference, reason: form.reason });
      else await api.post(`/api/events/${event.id}/payments`, { amount, method: form.method, received_at: form.date, reference: form.reference, notes: form.notes });
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'Could not save'); setSaving(false); }
  }
  const blocked = refund && !(refundable > 0);
  return (
    <Modal title={refund ? 'Refund' : 'Record payment'} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving || blocked || !(amount > 0) || (refund && !form.reason.trim())} onClick={save}>
          {refund ? `Refund ${fmtIDR(amount)}` : `Receive ${fmtIDR(amount)}`}</button></>}>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
      {blocked && <div className="alert alert-warn" style={{ marginBottom: 12 }}><div>Nothing can be refunded: this event has received no more than its bill. If the bill is wrong, void the line first, or cancel the event.</div></div>}
      <div className="form-group">
        <label className="form-label">{refund ? 'Amount given back (IDR)' : 'Amount received (IDR)'}</label>
        <input className="form-input" type="number" min={1} autoFocus value={form.amount} onChange={e => set('amount', e.target.value)} />
        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
          {refund ? `Can be refunded: ${fmtIDR(refundable)}.` : `Balance ${fmtIDR(balance)}.${balance > 0 && amount > 0 && amount < balance ? ` ${fmtIDR(balance - amount)} stays open.` : ''}`}
        </div>
        {!refund && balance > 0 && amount > balance + 0.5 && (
          <div className="alert alert-warn" style={{ marginTop: 6, fontSize: 12 }}><div>More than the event owes — {fmtIDR(amount - balance)} will show as a credit.</div></div>
        )}
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Method</label>
          <select className="form-select" value={form.method} onChange={e => set('method', e.target.value)}>
            {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Reference</label>
        <input className="form-input" value={form.reference} maxLength={120} placeholder="Card trace no. / transfer ref" onChange={e => set('reference', e.target.value)} />
      </div>
      {refund ? (
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Reason (required — kept in the history)</label>
          <input className="form-input" value={form.reason} onChange={e => set('reason', e.target.value)} />
        </div>
      ) : (
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Notes</label>
          <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

const fmtStamp = d => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function EventDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [venues, setVenues] = useState([]);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);     // { kind, … }
  const [showVoided, setShowVoided] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [refundable, setRefundable] = useState(0);

  const load = useCallback(() => api.get(`/api/events/${id}`)
    .then(r => { setData(r.data); setError(''); })
    .catch(e => setError(e.response?.data?.error || 'Could not load the event')), [id]);
  useEffect(() => { load(); api.get('/api/events/venues').then(r => setVenues(r.data)).catch(() => {}); }, [load]);

  const done = () => { setModal(null); load(); };

  if (error && !data) return <div className="alert alert-error"><div>{error}</div></div>;
  if (!data) return <div className="text-muted" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>;

  const { event: e, bill, meals, history, group, clashes } = data;
  const cancelled = e.status === 'cancelled';
  const liveMeals = meals.filter(m => m.status !== 'cancelled');
  const blocking = clashes.filter(c => c.status === 'confirmed');
  const holds = clashes.filter(c => c.status === 'tentative');

  async function setStatus(status, extra = {}) {
    try { await api.put(`/api/events/${e.id}/status`, { status, ...extra }); load(); }
    catch (err) { setError(err.response?.data?.error || 'Could not change the status'); window.scrollTo(0, 0); }
  }
  async function pdf(kind) {
    try { await downloadPdf(api, `/api/events/${e.id}/${kind}`, `event-${e.event_no}-${kind}`); }
    catch { setError('Could not make the PDF'); }
  }
  async function openRefund() {
    const r = await api.get(`/api/events/${e.id}/refundable`).catch(() => null);
    setRefundable(r?.data?.refundable || 0);
    setModal({ kind: 'refund' });
  }

  const primary = cancelled ? null
    : e.status === 'confirmed' ? null
    : <button className="btn btn-primary" onClick={() => setStatus('confirmed')}>✓ Confirm</button>;

  const menu = [
    !cancelled && { label: 'Edit details', icon: '✏️', onClick: () => setModal({ kind: 'edit' }) },
    e.status === 'enquiry' && { label: 'Put on hold', icon: '⏸', onClick: () => setStatus('tentative') },
    e.status === 'confirmed' && { label: 'Back to on hold', icon: '⏸', onClick: () => setStatus('tentative') },
    e.status === 'tentative' && { label: 'Back to enquiry (release the hold)', icon: '↩', onClick: () => setStatus('enquiry') },
    cancelled && { label: 'Reopen as enquiry', icon: '↩', onClick: () => setStatus('enquiry') },
    { divider: true },
    { label: 'Refund', icon: '💸', onClick: openRefund },
    !cancelled && { label: 'Cancel event', icon: '✕', danger: true, onClick: () => setModal({ kind: 'cancel' }) },
  ];

  return (
    <div>
      <PageHeader
        back={{ to: '/events', label: 'Events' }} kind={`Event #${e.event_no}`} title={e.name}
        tone={STATUS[e.status]?.badge || 'gray'}
        facts={[
          { label: 'For', value: e.customer || '—', sub: e.contact_name || undefined },
          { label: 'When', value: whenText(e) },
          { label: 'Venue', value: e.venue_name, sub: `${e.pax} people` },
          !cancelled && bill && { label: 'Balance due', value: bill.balance_due >= 1 ? fmtIDR(bill.balance_due) : bill.balance_due <= -1 ? `Credit ${fmtIDR(-bill.balance_due)}` : 'Paid' },
        ]}
        badge={<StatusBadge event={e} />}
        actions={<>
            <ActionMenu icon={<Icon name="file" />} label="Documents" ariaLabel="Download" items={[
              { label: 'Pro Forma', onClick: () => pdf('proforma'), hint: 'An estimate to send the client' },
              { label: 'Invoice', onClick: () => pdf('invoice') },
              { label: 'Function sheet', onClick: () => pdf('function-sheet'), hint: 'For kitchen, housekeeping and front desk — no prices' },
            ]} />
          <ActionMenu items={menu} icon={<Icon name="more" />} label="More" />
          {primary}
        </>}
      />

      {error && <div className="alert alert-error"><div>{error}</div></div>}
      {cancelled && <div className="alert alert-error"><div>Cancelled{e.cancel_reason ? ` — ${e.cancel_reason}` : ''}</div></div>}
      {e.hold_expired && <div className="alert alert-warn"><div>The hold ran out on {fmtDay(e.hold_until)}. Confirm the event, extend the hold (Edit details) or release it.</div></div>}
      {!cancelled && blocking.length > 0 && e.status !== 'confirmed' && (
        <div className="alert alert-error"><div>
          The {e.venue_name} is already booked at this time, so this event cannot be confirmed as it is:{' '}
          {blocking.map((c, i) => <span key={c.id}>{i > 0 && '; '}<Link to={`/events/${c.id}`}>#{c.event_no} {c.name}</Link> ({c.when})</span>)}
        </div></div>
      )}
      {!cancelled && holds.length > 0 && (
        <div className="alert alert-warn"><div>
          Also on hold for this time:{' '}
          {holds.map((c, i) => <span key={c.id}>{i > 0 && '; '}<Link to={`/events/${c.id}`}>#{c.event_no} {c.name}</Link> ({c.when})</span>)}
        </div></div>
      )}

      <div className="card mb-3">
        <div className="card-title">Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px 24px', fontSize: 14 }}>
          <div><div className="text-muted" style={{ fontSize: 11 }}>For</div>{e.customer || '—'}{e.agent_name && e.company_name && e.agent_name !== e.company_name ? <span className="text-muted"> · via {e.agent_name}</span> : ''}</div>
          <div><div className="text-muted" style={{ fontSize: 11 }}>Contact</div>{[e.contact_name, e.contact_phone, e.contact_email].filter(Boolean).join(' · ') || '—'}</div>
          <div><div className="text-muted" style={{ fontSize: 11 }}>Venue</div>{e.venue_name}{e.venue_capacity ? <span className="text-muted"> · up to {e.venue_capacity}</span> : ''}</div>
          <div><div className="text-muted" style={{ fontSize: 11 }}>When</div>{whenText(e)}</div>
          <div><div className="text-muted" style={{ fontSize: 11 }}>People</div>{e.pax}{e.venue_capacity && e.pax > e.venue_capacity ? <span style={{ color: '#B45309' }}> · more than the venue holds</span> : ''}</div>
          <div><div className="text-muted" style={{ fontSize: 11 }}>Made by</div>{e.created_by_name || '—'} · {fmtDate(e.created_at)}</div>
        </div>
        {e.notes && <div style={{ marginTop: 12, fontSize: 14 }}><div className="text-muted" style={{ fontSize: 11 }}>Notes / set-up</div><div style={{ whiteSpace: 'pre-wrap' }}>{e.notes}</div></div>}
        {e.internal_notes && <div style={{ marginTop: 12, fontSize: 14 }}><div className="text-muted" style={{ fontSize: 11 }}>Internal notes</div><div style={{ whiteSpace: 'pre-wrap' }}>{e.internal_notes}</div></div>}
        {group && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 14 }}>
            <div className="text-muted" style={{ fontSize: 11 }}>Rooms for this event</div>
            👥 <Link to={`/reservations/group/${group.id}`} style={{ fontWeight: 600 }}>{group.booker || 'Group booking'}</Link>
            <span className="text-muted"> · {group.rooms} room{group.rooms === 1 ? '' : 's'} · {fmtDay(group.check_in_date, { day: 'numeric', month: 'short' })} – {fmtDay(group.check_out_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            {group.balance_due != null && <span> · rooms balance <b>{fmtIDR(group.balance_due)}</b></span>}
          </div>
        )}
      </div>

      <div className="card mb-3">
        <div className="flex-between" style={{ gap: 8, marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Meals for the restaurant</div>
          {!cancelled && <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'meal' })}>+ Add meal</button>}
        </div>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          The restaurant sees these in the POS once the event is confirmed, rings each one up and charges it to this event — it then appears on the bill below.
        </div>
        {liveMeals.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No meals asked for.</div> : liveMeals.map(m => (
          <div key={m.id} className="flex-between" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <b>{mealLabel(m.kind)}</b>
              <span className="text-muted"> · {e.end_date !== e.event_date ? fmtDay(m.service_date, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' : ''}{m.service_time || 'time not set'} · {m.pax} people</span>
              {m.note && <div style={{ fontSize: 13 }}>{m.note}</div>}
              {(m.agreed_total != null || m.charged_total != null) && (
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {m.agreed_total != null && <>Agreed {fmtIDR(m.price)} per person = <b>{fmtIDR(m.agreed_total)}</b></>}
                  {m.charged_total != null && <>{m.agreed_total != null ? ' · ' : ''}restaurant bill <b>{fmtIDR(m.charged_total)}</b>{m.agreed_total != null && Math.abs(m.charged_total - m.agreed_total) > 1 ? <span style={{ color: '#B45309' }}> (differs from the agreed price)</span> : ''}</>}
                </div>
              )}
            </div>
            <div className="flex gap-2" style={{ alignItems: 'center' }}>
              {m.status === 'done'
                ? <span className="badge badge-green" title={m.done_at ? fmtStamp(m.done_at) : ''}>Handled{m.done_by ? ` by ${m.done_by}` : ''}</span>
                : <>
                    <span className="badge badge-gray">Not rung up yet</span>
                    {!cancelled && <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'meal', meal: m })}>Edit</button>}
                    {!cancelled && <button className="btn btn-sm btn-secondary" onClick={() => api.delete(`/api/events/${e.id}/meals/${m.id}`).then(load).catch(err => setError(err.response?.data?.error || 'Could not cancel the meal'))}>Cancel</button>}
                  </>}
            </div>
          </div>
        ))}
      </div>

      <div className="card mb-3">
        <div className="flex-between" style={{ gap: 8, marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Bill</div>
          {!cancelled && <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'line' })}>+ Add line</button>}
        </div>
        {bill.charges.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>Nothing on the bill yet.</div> : (
          <div className="table-wrap">
            <table style={{ width: '100%', minWidth: 520 }}>
              <thead><tr><th>What</th><th>Date</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
              <tbody>
                {bill.charges.map(c => (
                  <tr key={c.id}>
                    <td>{c.description}{c.type === 'pos' && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Restaurant</span>}{c.type === 'venue' && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Venue</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(c.service_date, { day: 'numeric', month: 'short' })}</td>
                    <td style={{ textAlign: 'right' }}>{c.quantity}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(bill.prices_include_tax ? c.total : c.amount)}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-secondary" title="Void this line" onClick={() => setModal({ kind: 'voidLine', line: c })}>🗑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bill.quoted.length > 0 && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#FFFBEB', border: '1px dashed #F59E0B', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>Agreed meals — not rung up by the restaurant yet</div>
            {bill.quoted.map(q => (
              <div key={q.meal_id} className="flex-between" style={{ gap: 10, fontSize: 13, padding: '3px 0' }}>
                <span>{q.description} <span className="text-muted">· {fmtDay(q.service_date, { day: 'numeric', month: 'short' })}{q.service_time ? ` ${q.service_time}` : ''} · {q.pax} × {fmtIDR(q.price)}</span></span>
                <span style={{ whiteSpace: 'nowrap' }}>{fmtIDR(q.total)}</span>
              </div>
            ))}
            <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>On the pro forma and in the balance. Each goes onto the bill when the restaurant charges it to this event in the POS.</div>
          </div>
        )}
        <div style={{ marginTop: 12, marginLeft: 'auto', maxWidth: 320, fontSize: 14 }}>
          {!bill.prices_include_tax && (bill.service_charge_amount > 0 || bill.tax_amount > 0) && <>
            <div className="flex-between"><span className="text-muted">Subtotal</span><span>{fmtIDR(bill.subtotal)}</span></div>
            {bill.service_charge_amount > 0 && <div className="flex-between"><span className="text-muted">Service charge ({bill.service_charge_rate}%)</span><span>{fmtIDR(bill.service_charge_amount)}</span></div>}
            {bill.tax_amount > 0 && <div className="flex-between"><span className="text-muted">Tax ({bill.tax_rate}%)</span><span>{fmtIDR(bill.tax_amount)}</span></div>}
          </>}
          <div className="flex-between" style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}><span>{bill.quoted.length ? 'On the bill now' : 'Total'}</span><span>{fmtIDR(bill.total)}</span></div>
          {bill.quoted.length > 0 && <>
            <div className="flex-between"><span className="text-muted">Agreed meals to come</span><span>{fmtIDR(bill.quoted_total)}</span></div>
            <div className="flex-between" style={{ fontWeight: 700, fontSize: 16 }}><span>Expected total</span><span>{fmtIDR(bill.expected_total)}</span></div>
          </>}
          {bill.prices_include_tax && (bill.service_charge_amount > 0 || bill.tax_amount > 0) && <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>incl. service &amp; tax</div>}
        </div>
        {bill.voided_charges.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowVoided(v => !v)}>{showVoided ? 'Hide' : 'Show'} voided lines ({bill.voided_charges.length})</button>
            {showVoided && bill.voided_charges.map(c => (
              <div key={c.id} className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                <s>{c.description} — {fmtIDR(c.total)}</s> · voided by {c.voided_by_name || '—'}{c.voided_at ? ` on ${fmtStamp(c.voided_at)}` : ''} · {c.void_reason}
                {c.type === 'pos' && c.external_ref && (c.pos_void_sent_at
                  ? <span style={{ color: '#166534' }}> · reopened in the POS</span>
                  : <>
                      <span style={{ color: '#B91C1C', fontWeight: 600 }}> · POS not told{c.pos_void_error ? ` (${c.pos_void_error})` : ''}</span>{' '}
                      <button className="btn btn-sm btn-secondary" onClick={() => api.post(`/api/events/${e.id}/charges/${c.id}/tell-pos`).then(r => { if (!r.data.told) setError(`The POS still could not be told (${r.data.error}).`); load(); }).catch(err => setError(err.response?.data?.error || 'Could not tell the POS'))}>Tell the POS</button>
                    </>)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-3">
        <div className="flex-between" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Payments</div>
          {!cancelled && <button className="btn btn-sm btn-primary" onClick={() => setModal({ kind: 'payment' })}>💳 Record payment</button>}
        </div>
        <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">{bill.quoted.length ? 'Expected total' : 'Total'}</div><div className="stat-value">{fmtIDR(bill.expected_total)}</div></div>
          <div className="stat-card"><div className="stat-label">Paid</div><div className="stat-value">{fmtIDR(bill.received)}</div></div>
          <div className="stat-card"><div className="stat-label">{bill.balance_due < 0 ? 'Credit' : 'Balance due'}</div>
            <div className="stat-value" style={{ color: bill.balance_due > 0 ? '#B91C1C' : undefined }}>{fmtIDR(Math.abs(bill.balance_due))}</div></div>
        </div>
        {bill.payments.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>No payments yet.</div> : bill.payments.map(p => (
          <div key={p.id} className="flex-between" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap', opacity: p.is_voided ? 0.6 : 1 }}>
            <div style={{ minWidth: 0, fontSize: 14 }}>
              <span style={{ textDecoration: p.is_voided ? 'line-through' : 'none', color: p.is_refund && !p.is_voided ? '#B91C1C' : undefined }}>
                <b>{p.is_refund ? 'Refund' : 'Payment'}</b> · {p.method_label} · {fmtDate(p.received_at)}{p.reference ? ` · ref ${p.reference}` : ''}
              </span>
              <div className="text-muted" style={{ fontSize: 11 }}>
                by {p.received_by_name || '—'}{p.notes ? ` · ${p.notes}` : ''}
                {p.is_voided && ` · voided by ${p.voided_by_name || '—'}: ${p.void_reason}`}
              </div>
            </div>
            <div className="flex gap-2" style={{ alignItems: 'center' }}>
              <b style={{ whiteSpace: 'nowrap', textDecoration: p.is_voided ? 'line-through' : 'none', color: p.amount < 0 && !p.is_voided ? '#B91C1C' : undefined }}>{fmtIDR(p.amount)}</b>
              {!p.is_voided && <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'voidPayment', payment: p })}>Void</button>}
            </div>
          </div>
        ))}
        {group?.balance_due != null && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 14 }}>
            <div className="flex-between"><span className="text-muted">Event balance</span><span>{fmtIDR(bill.balance_due)}</span></div>
            <div className="flex-between"><span className="text-muted">Rooms balance (<Link to={`/reservations/group/${group.id}`}>group booking</Link>)</span><span>{fmtIDR(group.balance_due)}</span></div>
            <div className="flex-between" style={{ fontWeight: 700 }}><span>Total due from the client</span><span>{fmtIDR(bill.balance_due + group.balance_due)}</span></div>
            <div className="text-muted" style={{ fontSize: 11 }}>Payments are recorded on each: here for the event, on the group for the rooms.</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">History</div>
        {(showAllHistory ? history : history.slice(0, 12)).map(h => (
          <div key={h.id} style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
            <div className="text-muted" style={{ fontSize: 11 }}>{h.created_by_name || 'System'} · {fmtStamp(h.created_at)}</div>
            <div style={{ fontSize: 13 }}>{h.note}</div>
          </div>
        ))}
        {history.length > 12 && !showAllHistory && <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => setShowAllHistory(true)}>Show all ({history.length})</button>}
      </div>

      {modal?.kind === 'edit' && <EventFormModal event={e} venues={venues} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'line' && <LineModal event={e} bill={bill} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'meal' && <MealModal event={e} bill={bill} meal={modal.meal} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'payment' && <PaymentModal event={e} balance={bill.balance_due} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'refund' && <PaymentModal event={e} refund refundable={refundable} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'cancel' && (
        <ReasonModal title="Cancel this event" danger confirmLabel="Cancel the event" onClose={() => setModal(null)}
          onConfirm={async reason => { await api.put(`/api/events/${e.id}/status`, { status: 'cancelled', reason }); done(); }}>
          <b>{e.name}</b> — {whenText(e)}. The venue is released and the kitchen and housekeeping are told.
          {bill.received > 0 && <> {fmtIDR(bill.received)} has been received: give it back afterwards with ⋮ → Refund.</>}
        </ReasonModal>
      )}
      {modal?.kind === 'voidLine' && (
        <ReasonModal title="Void this line" danger confirmLabel="Void the line" onClose={() => setModal(null)}
          onConfirm={async reason => {
            const r = await api.delete(`/api/events/${e.id}/charges/${modal.line.id}`, { data: { reason } });
            if (r.data?.pos && !r.data.pos.told) setError(`The line is voided, but the POS could not be told (${r.data.pos.error}). Tell the restaurant, or press "Tell the POS" under Voided lines.`);
            if (r.data?.pos) setShowVoided(true);
            done();
          }}>
          <b>{modal.line.description}</b> — {fmtIDR(modal.line.total)}. The line is kept, struck through.
          {modal.line.type === 'pos' && <> This is a restaurant bill: the POS is told and <b>reopens it</b>, so the restaurant can correct it and charge it to this event again — it then comes back as a new line. Until then the meal counts at its agreed price again.</>}
        </ReasonModal>
      )}
      {modal?.kind === 'voidPayment' && (
        <ReasonModal title={modal.payment.is_refund ? 'Void this refund' : 'Void this payment'} danger confirmLabel="Void" onClose={() => setModal(null)}
          onConfirm={async reason => { await api.delete(`/api/events/${e.id}/payments/${modal.payment.id}`, { data: { reason } }); done(); }}>
          {fmtIDR(Math.abs(modal.payment.amount))} by {modal.payment.method_label} on {fmtDate(modal.payment.received_at)}. It is kept, struck through, and no longer counts.
        </ReasonModal>
      )}
    </div>
  );
}
