import { useState, useEffect } from 'react';
import api from '../services/api';
import ActionMenu from './ActionMenu';
import { useSettings } from '../context/SettingsContext';

// Corrections on payments (owner or the `corrections` permission — the
// caller decides whether to show these): a ⋮ on a received payment (correct
// a detail / undo it / move it to another booking) and the Refund window.
// Every one needs a reason; the server keeps the old record.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const today = () => new Date().toLocaleDateString('en-CA');
const KIND = { deposit: 'Room deposit', balance: 'Room balance', incidental: 'Extras payment', refund: 'Refund' };

function Reason({ value, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">Reason (goes into Edit History)</label>
      <input className="form-input" value={value} onChange={e => onChange(e.target.value)} placeholder="Why is this being corrected?" />
    </div>
  );
}

function Shell({ title, onClose, error, children, footer }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
          {children}
        </div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function MethodSelect({ value, onChange }) {
  const { paymentMethods = [] } = useSettings();
  return (
    <select className="form-select" value={value || ''} onChange={e => onChange(e.target.value)}>
      {paymentMethods.filter(m => (m.is_active && m.id !== 'ota_managed') || m.id === value).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  );
}

// ⋮ on one received payment.
export function PaymentFixMenu({ payment, onDone }) {
  const [mode, setMode] = useState(null);   // 'correct' | 'undo' | 'move'
  const tiedToSale = !!payment.sale_id;
  const movable = payment.type !== 'refund' && !payment.sale_id && !payment.activity_booking_id && payment.receipt_kind !== 'lines';
  const items = [
    { label: 'Correct method / date / reference', icon: '✏️', onClick: () => setMode('correct') },
    !tiedToSale && { label: payment.type === 'refund' ? 'Void this refund' : 'Undo this payment', icon: '↩️', onClick: () => setMode('undo'),
      hint: ['deposit', 'balance'].includes(payment.type) ? 'The line becomes unpaid again' : 'Recorded by mistake' },
    movable && { label: 'Move to another booking', icon: '🔀', onClick: () => setMode('move') },
  ];
  return (
    <>
      <ActionMenu items={items} bare ariaLabel="Correct this payment" />
      {mode && <FixModal mode={mode} payment={payment} onClose={() => setMode(null)} onDone={() => { setMode(null); onDone(); }} />}
    </>
  );
}

function FixModal({ mode, payment, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({
    method: payment.method, reference: payment.reference || '',
    received_at: payment.received_at ? new Date(payment.received_at).toLocaleDateString('en-CA') : today(),
  });
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const what = `${KIND[payment.type] || 'Payment'} ${fmtIDR(Math.abs(payment.amount))}`;

  useEffect(() => {
    if (mode !== 'move' || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/api/bookings', { params: { q: q.trim() } });
        setResults(data.filter(b => b.id !== payment.booking_id && !['cancelled', 'no_show'].includes(b.status)).slice(0, 8));
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, mode, payment.booking_id]);

  async function save() {
    setBusy(true); setError('');
    try {
      if (mode === 'correct') {
        const sameDay = payment.received_at && new Date(payment.received_at).toLocaleDateString('en-CA') === form.received_at;
        await api.put(`/api/payments/${payment.id}/correct`, {
          method: form.method, reference: form.reference, ...(sameDay ? {} : { received_at: form.received_at }), reason: reason.trim() });
      } else if (mode === 'undo') {
        await api.post(`/api/payments/${payment.id}/undo`, { reason: reason.trim() });
      } else {
        await api.post(`/api/payments/${payment.id}/move`, { to_booking_id: target.id, reason: reason.trim() });
      }
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the correction');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'correct' ? `Correct — ${what}` : mode === 'undo' ? `${payment.type === 'refund' ? 'Void' : 'Undo'} — ${what}` : `Move — ${what}`;
  const ready = reason.trim() && (mode !== 'move' || target);
  return (
    <Shell title={title} onClose={onClose} error={error} footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !ready}>
        {busy ? 'Saving…' : mode === 'correct' ? 'Save correction' : mode === 'undo' ? (payment.type === 'refund' ? 'Void refund' : 'Undo payment') : 'Move payment'}
      </button>
    </>}>
      {mode === 'correct' && (<>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          For a wrong detail. If the amount is wrong, undo the payment and record it again.
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Method</label>
            <MethodSelect value={form.method} onChange={v => setForm(f => ({ ...f, method: v }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Date received</label>
            <input className="form-input" type="date" value={form.received_at} onChange={e => setForm(f => ({ ...f, received_at: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Reference</label>
          <input className="form-input" maxLength={120} value={form.reference} placeholder="Card trace no. / transfer ref" onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
        </div>
      </>)}
      {mode === 'undo' && (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          <div>
            {['deposit', 'balance'].includes(payment.type)
              ? 'The money was not received (or was recorded on the wrong line). The line becomes unpaid again and can be recorded again correctly.'
              : payment.type === 'refund' ? 'This refund was entered by mistake. It is kept in the history, marked voided, and no longer counted.'
              : 'This payment was recorded by mistake. The items it paid become unpaid again; the payment is kept in the history, marked voided.'}
            {' '}If the guest really paid and is getting money back, use Refund instead.
          </div>
        </div>
      )}
      {mode === 'move' && (<>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          The payment is taken off this booking and recorded on the other one with the same method, date and reference — its unpaid room lines first, anything beyond them as a credit.
        </div>
        <div className="form-group">
          <label className="form-label">Move to (search by guest name)</label>
          {target ? (
            <div className="flex-between" style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
              <span><b>{target.unit_name}</b> · {target.guest_name} · {String(target.check_in_date).slice(0, 10)} → {String(target.check_out_date).slice(0, 10)}</span>
              <button className="btn btn-sm btn-secondary" onClick={() => setTarget(null)}>Change</button>
            </div>
          ) : (<>
            <input className="form-input" value={q} autoFocus onChange={e => setQ(e.target.value)} placeholder="Guest name…" />
            {results.map(b => (
              <button key={b.id} className="btn btn-secondary" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 6 }} onClick={() => setTarget(b)}>
                <b>{b.unit_name}</b> · {b.guest_name} · {String(b.check_in_date).slice(0, 10)} → {String(b.check_out_date).slice(0, 10)} · {String(b.status).replace('_', ' ')}
              </button>
            ))}
          </>)}
        </div>
      </>)}
      <Reason value={reason} onChange={setReason} />
    </Shell>
  );
}

// Refund: money given back to the guest. Never more than the booking's credit.
export function RefundModal({ bookingId, guestName, onClose, onDone }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'cash', refunded_at: today(), reference: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/payments/refundable', { params: { booking_id: bookingId } })
      .then(({ data }) => { setInfo(data); setForm(f => ({ ...f, amount: data.amount ? String(Math.round(data.amount)) : '' })); })
      .catch(err => setError(err.response?.data?.error || 'Could not load the booking\'s credit'));
  }, [bookingId]);

  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/api/payments/refund', {
        booking_id: bookingId, amount: parseFloat(form.amount), method: form.method,
        ...(form.refunded_at === today() ? {} : { refunded_at: form.refunded_at }), reference: form.reference, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the refund');
    } finally {
      setBusy(false);
    }
  }

  const max = info?.amount || 0;
  const amt = parseFloat(form.amount) || 0;
  return (
    <Shell title={`Refund${guestName ? ` — ${guestName}` : ''}`} onClose={onClose} error={error} footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !reason.trim() || !(amt > 0) || amt > max + 0.05}>
        {busy ? 'Saving…' : `Record refund ${amt > 0 ? fmtIDR(amt) : ''}`}
      </button>
    </>}>
      {info && max <= 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          <div>
            <b>Nothing can be refunded yet.</b>{' '}
            {info.received > 0
              ? <>The guest has paid {fmtIDR(info.received)} of a bill of {fmtIDR(info.bill)}, so the booking still owes {fmtIDR(info.bill - info.received)} — there is no money over to give back.</>
              : <>No payment has been received on this booking.</>}
            {info.received > 0 && (
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                <li><b>The guest is not coming / the stay is cancelled:</b> close this window, use ⋮ → Cancel Booking, then open Refund again — everything paid can then be given back.</li>
                <li><b>The stay is shorter or cheaper than booked:</b> change it first (Amend Dates or Edit Price) — what was paid beyond the new bill can then be refunded.</li>
                <li><b>The payment was never received / recorded by mistake:</b> that is not a refund — use ⋮ on the payment → Undo this payment.</li>
              </ul>
            )}
          </div>
        </div>
      )}
      {info && max > 0 && (
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          Can be refunded: <b>{fmtIDR(max)}</b>
          <span className="text-muted"> — {['cancelled', 'no_show'].includes(info.status) ? 'everything received on this cancelled booking' : 'the credit on this booking\'s bill'}</span>
        </div>
      )}
      {max > 0 && (<>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Amount given back (IDR)</label>
          <input className="form-input" type="number" min="1" max={max} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Given back by</label>
          <MethodSelect value={form.method} onChange={v => setForm(f => ({ ...f, method: v }))} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={form.refunded_at} onChange={e => setForm(f => ({ ...f, refunded_at: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Reference</label>
          <input className="form-input" maxLength={120} value={form.reference} placeholder="Transfer ref" onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
        </div>
      </div>
      <Reason value={reason} onChange={setReason} />
      <div className="text-muted" style={{ fontSize: 11 }}>
        The refund is its own line on the day it is given back (shown as a minus in Cashier Closing and Daily Close). The original payment is kept as it was.
      </div>
      </>)}
    </Shell>
  );
}
