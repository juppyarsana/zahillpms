import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Shell, Reason, MethodSelect } from './PaymentCorrections';

// Agent credit: money an agent already paid for a room that was then cancelled and
// that the hotel still holds. The money stays recorded on the cancelled booking (the
// books are unchanged) — this shows it per agent and lets front desk use it on
// another stay of the same agent or refund it. Server: services/agentCredit.js.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtDay = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' }) : '';   // hotel time
const today = () => new Date().toLocaleDateString('en-CA');

export function useAgentCredit(agentId) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    if (!agentId) { setData(null); return Promise.resolve(); }
    return api.get(`/api/agent-credit/agent/${agentId}`).then(r => setData(r.data)).catch(() => setData(null));
  }, [agentId]);
  useEffect(() => { load(); }, [load]);
  return { data, reload: load };
}

// Use part or all of one cancelled room's credit on a stay of the same agent.
// `target` (a booking id + what it owes) skips the choice when opened from that booking.
export function UseCreditModal({ agentId, item, target, onClose, onDone }) {
  const [targets, setTargets] = useState(null);
  const [pick, setPick] = useState(target?.booking_id || '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/agent-credit/agent/${agentId}/targets`).then(r => setTargets(r.data)).catch(() => setTargets([]));
  }, [agentId]);
  const chosen = (targets || []).find(t => t.booking_id === pick) || (target?.booking_id === pick ? target : null);
  const owed = chosen?.owed || 0;
  const max = Math.min(item.usable, owed || item.usable);
  useEffect(() => { if (chosen) setAmount(String(Math.round(Math.min(item.usable, chosen.owed)))); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  const amt = parseFloat(amount) || 0;

  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/api/agent-credit/use', { from_booking_id: item.booking_id, to_booking_id: pick, amount: amt, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not use the credit');
    } finally { setBusy(false); }
  }

  return (
    <Shell title="Use agent credit" onClose={onClose} error={error} footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !pick || !reason.trim() || !(amt > 0) || amt > max + 0.05}>
        {busy ? 'Saving…' : `Use ${amt > 0 ? fmtIDR(amt) : 'credit'}`}
      </button>
    </>}>
      <div style={{ fontSize: 13, marginBottom: 12 }}>
        From cancelled room <b>{item.room}</b> ({item.guest}{item.group_name && item.group_name !== item.guest ? ` · ${item.group_name}` : ''}) —{' '}
        <b>{fmtIDR(item.usable)}</b> can be used
        {item.usable < item.available && <span className="text-muted"> ({fmtIDR(item.available - item.usable)} more was paid in a way that can only be refunded)</span>}.
      </div>
      {!target && (
        <div className="form-group">
          <label className="form-label">Use it on which stay of this agent?</label>
          {targets === null ? <div className="text-muted">Loading…</div> : targets.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13 }}>This agent has no open stay that still owes money. Make or find the booking first.</div>
          ) : (
            <select className="form-select" value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">Choose a stay…</option>
              {targets.map(t => (
                <option key={t.booking_id} value={t.booking_id}>
                  {t.room} · {t.guest}{t.group_name ? ` (${t.group_name})` : ''} · {fmtDay(t.check_in)} – {fmtDay(t.check_out)} · owes {fmtIDR(t.owed)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {target && <div style={{ fontSize: 13, marginBottom: 12 }}>On <b>{target.room}</b> · {target.guest} — owes <b>{fmtIDR(target.owed)}</b></div>}
      {pick && (<>
        <div className="form-group">
          <label className="form-label">Amount to use (IDR)</label>
          <input className="form-input" type="number" min="1" max={max} value={amount} onChange={e => setAmount(e.target.value)} />
          <div className="text-muted" style={{ fontSize: 11 }}>At most {fmtIDR(max)} — the smaller of the credit and what the stay owes. It pays the room's unpaid deposit / balance first, then extras.</div>
        </div>
        <Reason value={reason} onChange={setReason} />
        <div className="text-muted" style={{ fontSize: 11 }}>
          The money keeps its original method, date and reference, so no day's totals change. It is written to both bookings' Edit History.
        </div>
      </>)}
    </Shell>
  );
}

// Give the credit of a cancelled room back to the agent (a refund line on that booking).
export function RefundCreditModal({ item, onClose, onDone }) {
  const [form, setForm] = useState({ amount: String(Math.round(item.available)), method: item.payments[0]?.method || 'bank_transfer', refunded_at: today(), reference: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amt = parseFloat(form.amount) || 0;

  async function save() {
    setBusy(true); setError('');
    try {
      await api.post('/api/agent-credit/refund', {
        booking_id: item.booking_id, amount: amt, method: form.method,
        ...(form.refunded_at === today() ? {} : { refunded_at: form.refunded_at }), reference: form.reference, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the refund');
    } finally { setBusy(false); }
  }

  return (
    <Shell title="Refund agent credit" onClose={onClose} error={error} footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !reason.trim() || !(amt > 0) || amt > item.available + 0.05}>
        {busy ? 'Saving…' : `Record refund ${amt > 0 ? fmtIDR(amt) : ''}`}
      </button>
    </>}>
      <div style={{ fontSize: 13, marginBottom: 12 }}>
        Cancelled room <b>{item.room}</b> ({item.guest}) — <b>{fmtIDR(item.available)}</b> can be given back.
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Amount given back (IDR)</label>
          <input className="form-input" type="number" min="1" max={item.available} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
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
        The refund is its own line on the day it is given back (a minus in Cashier Closing and Daily Close). The original payment is kept as it was.
      </div>
    </Shell>
  );
}

// The credit held for one agent: what is held and where it came from, with Use / Refund.
// `target` = a stay to use it on (when shown on that stay's page).
export function AgentCreditCard({ agentId, target, onChanged, compact }) {
  const { data, reload } = useAgentCredit(agentId);
  const [using, setUsing] = useState(null);
  const [refunding, setRefunding] = useState(null);
  const [done, setDone] = useState('');
  if (!data || !data.items.length) return null;
  const finished = msg => { setUsing(null); setRefunding(null); setDone(msg); reload(); onChanged?.(); setTimeout(() => setDone(''), 6000); };
  const canUse = !target || target.owed >= 1;

  return (
    <div className="card" style={{ marginBottom: compact ? 0 : 16, borderLeft: '4px solid var(--green-dark)' }}>
      <div className="card-header">
        <div className="card-title">Credit held for {data.agent_name} · {fmtIDR(data.total)}</div>
      </div>
      <div className="card-body">
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Money this agent paid for rooms that were then cancelled. The hotel still holds it: use it on another stay of this agent, or give it back.
        </div>
        {done && <div className="alert alert-success" style={{ marginBottom: 8 }}><div>{done}</div></div>}
        {data.items.map(it => (
          <div key={it.booking_id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                <Link to={`/reservations/${it.booking_id}`}>Room {it.room} · {it.guest}</Link>
                {it.group_name && it.group_name !== it.guest && <span className="text-muted" style={{ fontWeight: 400 }}> · {it.group_name}</span>}
              </div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Cancelled {fmtDay(it.cancelled_on)} · paid {it.payments.map(p => `${fmtDay(p.received_on)} ${p.method_label}${p.reference ? ` (${p.reference})` : ''}`).join(', ') || '—'}
                {it.fee > 0 && <> · hotel keeps a fee of {fmtIDR(it.fee)}</>}
              </div>
            </div>
            <div style={{ fontWeight: 700 }}>{fmtIDR(it.available)}</div>
            <div className="flex gap-2">
              {it.usable >= 1 && canUse && <button className="btn btn-primary btn-sm" onClick={() => setUsing(it)}>Use{target ? ' here' : ' on a stay'}</button>}
              <button className="btn btn-secondary btn-sm" onClick={() => setRefunding(it)}>Refund</button>
            </div>
          </div>
        ))}
      </div>
      {using && <UseCreditModal agentId={agentId} item={using} target={target} onClose={() => setUsing(null)} onDone={() => finished('Credit used — the stay\'s payment is recorded.')} />}
      {refunding && <RefundCreditModal item={refunding} onClose={() => setRefunding(null)} onDone={() => finished('Refund recorded.')} />}
    </div>
  );
}
