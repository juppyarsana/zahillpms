import { useState } from 'react';
import api from '../services/api';
import { useSettings } from '../context/SettingsContext';

// Group page payment card for a group billed as a whole (migration 097): one
// bill and one payment record — payments are recorded on the group, never
// spread over its rooms. Shows what the group pays (room & meal plan, or
// everything), the bill, the payments (void with a reason) and Record Group
// Payment. `bill` = GET /api/bookings/group/:id → bill.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = v => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtTime = v => (v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

export const MODE_LABEL = {
  room_meals: 'Room & meal plan',
  everything: 'Everything',
};
export const MODE_HINT = {
  room_meals: 'The group pays the room nights and meal plan. Extras charged to a room are paid by that room’s guest at check-out.',
  everything: 'The group pays everything, extras too. Extras are still listed under the room they were charged to.',
};

// Record Group Payment — one amount from the group. Also opened from the
// Master Folio tab.
export function GroupPaymentModal({ groupId, balance, onClose, onSaved }) {
  const { paymentMethods } = useSettings();
  const methods = paymentMethods.filter(m => m.is_active !== false && m.id !== 'ota_managed');
  const [form, setForm] = useState({
    amount: balance > 0 ? String(Math.round(balance)) : '',
    method: methods.find(m => m.id === 'bank_transfer')?.id || methods[0]?.id || '',
    received_at: localYmd(), reference: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const amount = Math.round(parseFloat(form.amount) || 0);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true); setError('');
    try {
      await api.post(`/api/bookings/group/${groupId}/payments`, { ...form, amount });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 460, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Record Group Payment</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Amount received (IDR)</label>
            <input className="form-input" type="number" min={1} value={form.amount} autoFocus onChange={e => set('amount', e.target.value)} />
            <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Group balance {fmtIDR(balance)}. Recorded once, on the group — not split over the rooms.
              {balance > 0 && amount > 0 && amount < balance && ` ${fmtIDR(balance - amount)} stays open.`}
            </div>
            {balance > 0 && amount > balance + 0.5 && (
              <div className="alert alert-warn" style={{ marginTop: 6, fontSize: 12 }}>
                <div>More than the group owes — {fmtIDR(amount - balance)} will show as a credit.</div>
              </div>
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
              <label className="form-label">Date received</label>
              <input className="form-input" type="date" value={form.received_at} onChange={e => set('received_at', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Reference</label>
            <input className="form-input" value={form.reference} maxLength={120} placeholder="Card trace no. / transfer ref" onChange={e => set('reference', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input" value={form.notes} placeholder="Optional" onChange={e => set('notes', e.target.value)} />
          </div>
          {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !(amount > 0) || !form.method}>
            {saving ? 'Saving…' : `Record ${fmtIDR(amount)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GroupBillingCard({ groupId, bill, rollup, canPay, onChanged }) {
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(null);       // payment row
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  const live = bill.payments.filter(p => !p.is_voided);
  const voided = bill.payments.filter(p => p.is_voided);
  const ownOwed = bill.rooms.reduce((s, r) => s + Math.max(0, r.own_balance || 0), 0);
  const depositOk = !(bill.deposit_required > 0) || bill.received >= bill.deposit_required - 0.5;

  async function setMode(mode) {
    if (mode === bill.billing_mode) { setModeOpen(false); return; }
    setBusy(true);
    try {
      await api.put(`/api/bookings/group/${groupId}/billing`, { billing_mode: mode });
      setModeOpen(false);
      onChanged();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not change it');
    } finally {
      setBusy(false);
    }
  }

  async function doVoid() {
    setBusy(true); setVoidError('');
    try {
      await api.delete(`/api/bookings/group/${groupId}/payments/${voiding.id}`, { data: { reason: voidReason } });
      setVoiding(null);
      onChanged();
    } catch (err) {
      setVoidError(err.response?.data?.error || 'Could not void it');
    } finally {
      setBusy(false);
    }
  }

  const row = { fontSize: 13, marginBottom: 4 };
  return (
    <div className="card mb-3">
      <div className="flex-between" style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>Group Bill</div>
          <div className="text-muted" style={{ fontSize: 12 }}>One bill and one payment record for the whole group.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="text-muted" style={{ fontSize: 11 }}>Group pays</div>
          <button className="btn btn-sm btn-secondary" onClick={() => setModeOpen(o => !o)} disabled={busy}>
            {MODE_LABEL[bill.billing_mode]} ▾
          </button>
        </div>
      </div>

      {modeOpen && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
          {['room_meals', 'everything'].map(m => (
            <label key={m} className="flex gap-2" style={{ alignItems: 'flex-start', cursor: 'pointer', marginBottom: 6, fontSize: 13 }}>
              <input type="radio" name="group-pays" checked={bill.billing_mode === m} onChange={() => setMode(m)} disabled={busy} />
              <span><b>{MODE_LABEL[m]}</b><div className="text-muted" style={{ fontSize: 12 }}>{MODE_HINT[m]}</div></span>
            </label>
          ))}
        </div>
      )}

      <div className="flex-between" style={row}>
        <span className="text-muted">Rooms ({rollup.room_count}){rollup.discount_amount > 0 ? ' after group discount' : ''}{bill.billing_mode === 'everything' ? ' + extras' : ''}</span>
        <span>{fmtIDR(bill.total)}</span>
      </div>
      {rollup.discount_amount > 0 && (
        <div className="text-muted" style={{ fontSize: 11, marginTop: -2, marginBottom: 4, textAlign: 'right' }}>group discount {fmtIDR(rollup.discount_amount)} included</div>
      )}
      <div className="flex-between" style={row}>
        <span className="text-muted">Paid</span><span>− {fmtIDR(bill.received)}</span>
      </div>
      <div className="flex-between" style={{ fontWeight: 700, fontSize: 16, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
        <span>{bill.balance_due < 0 ? 'Credit' : 'Balance due'}</span>
        <span style={{ color: bill.balance_due > 0.5 ? 'var(--color-danger, #dc2626)' : 'var(--color-success, #16a34a)' }}>
          {fmtIDR(Math.abs(bill.balance_due))}
        </span>
      </div>
      {bill.deposit_required > 0 && (
        <div style={{ fontSize: 12, marginTop: 4 }} className={depositOk ? 'text-muted' : ''}>
          Deposit {fmtIDR(bill.deposit_required)} — {depositOk ? '✓ received' : <b style={{ color: 'var(--color-danger, #dc2626)' }}>not yet received</b>}
        </div>
      )}
      {bill.billing_mode === 'room_meals' && ownOwed > 0.5 && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          Plus {fmtIDR(ownOwed)} in extras the rooms pay themselves (see each room).
        </div>
      )}

      {canPay && (
        <div className="flex gap-2" style={{ marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => setPaying(true)}>💳 Record Group Payment</button>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Payments received</div>
        {!live.length && !voided.length && <div className="text-muted" style={{ fontSize: 13 }}>No payments yet.</div>}
        {[...live, ...voided].map(p => (
          <div key={p.id} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13, gap: 8, opacity: p.is_voided ? 0.6 : 1 }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ textDecoration: p.is_voided ? 'line-through' : 'none' }}>
                {fmtDay(p.received_at)} · <b>{p.method_label}</b>{p.reference ? ` · Ref ${p.reference}` : ''}
              </span>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {p.received_by_name ? `by ${p.received_by_name}` : ''}{p.recorded_at ? ` · recorded ${fmtDay(p.recorded_at)} ${fmtTime(p.recorded_at)}` : ''}
                {p.notes ? ` · ${p.notes}` : ''}
                {p.is_voided && <> · <span style={{ color: 'var(--color-danger, #dc2626)' }}>voided{p.voided_by_name ? ` by ${p.voided_by_name}` : ''}: {p.void_reason}</span></>}
              </div>
            </div>
            <div className="flex gap-2" style={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
              <b style={{ textDecoration: p.is_voided ? 'line-through' : 'none' }}>{fmtIDR(p.amount)}</b>
              {!p.is_voided && canPay && (
                <button className="btn btn-sm btn-secondary" title="Void this payment (kept on record)" onClick={() => { setVoiding(p); setVoidReason(''); setVoidError(''); }}>Void</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {paying && (
        <GroupPaymentModal groupId={groupId} balance={bill.balance_due}
          onClose={() => setPaying(false)} onSaved={() => { setPaying(false); onChanged(); }} />
      )}

      {voiding && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 420, width: '100%' }}>
            <div className="modal-header">
              <div className="modal-title">Void payment</div>
              <button className="btn btn-icon" onClick={() => setVoiding(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginTop: 0 }}>
                {fmtIDR(voiding.amount)} by {voiding.method_label} on {fmtDay(voiding.received_at)}. It stays on record, struck through, and no longer counts as paid.
              </p>
              <div className="form-group">
                <label className="form-label">Reason *</label>
                <input className="form-input" value={voidReason} autoFocus placeholder="e.g. transfer recorded twice" onChange={e => setVoidReason(e.target.value)} />
              </div>
              {voidError && <div className="alert alert-error">{voidError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setVoiding(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={doVoid} disabled={busy || !voidReason.trim()}>{busy ? 'Voiding…' : 'Void payment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
