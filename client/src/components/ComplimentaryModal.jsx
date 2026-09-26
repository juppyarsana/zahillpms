import { useEffect, useState } from 'react';
import api from '../services/api';

// Make a stay complimentary (migration 072, server/services/complimentaryService.js).
// The owner / a role with `grant_complimentary` applies it straight away;
// anyone else sends a request and types the one-time code an approver gets
// on Telegram. mode='remove' takes the complimentary off again.
// Also opened by NewBooking right after creating the booking (initial = the
// scope + reason ticked there; a user without the permission sends the
// request straight away and lands on the code step).

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const REASONS = ['Travel agent site inspection', 'Influencer / media', 'Service recovery', "Owner's guest", 'Staff / family'];
const SCOPE_HELP = {
  room: 'Meals on the rate plan and extras are still paid',
  room_meals: 'Extras charged to the room are still paid',
  all: 'Room, meals and extras charged to the room — all free',
};
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// booking: { id, guest_name, status }. onCancelled: the reservation was
// cancelled from the Declined screen (the page should leave the booking).
export default function ComplimentaryModal({ booking, mode = 'grant', initial = null, onClose, onDone, onCancelled }) {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [scope, setScope] = useState(initial?.scope || '');
  const [reason, setReason] = useState(initial?.reason || '');
  const [request, setRequest] = useState(null);   // pending approval request
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // Name of the approver who declined on Telegram — its own screen, so it
  // doesn't read as "fill the form in again".
  const [declined, setDeclined] = useState(null);
  // From New Booking the choice was already made there: show "Sending…"
  // instead of flashing the form while the request goes out.
  const [autoStarting, setAutoStarting] = useState(!!initial && mode === 'grant');
  // Declined → "keep it at the normal price, or cancel the reservation?"
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const canCancel = ['pending', 'deposit_paid', 'confirmed'].includes(booking.status);

  async function load() {
    try {
      const r = await api.get(`/api/bookings/${booking.id}/complimentary`);
      setInfo(r.data);
      if (r.data.pending_request) setRequest(r.data.pending_request);
      return r.data;
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Could not load');
    }
  }

  useEffect(() => {
    (async () => {
      const data = await load();
      // From New Booking: go straight on with what was ticked there.
      if (data && initial && mode === 'grant' && !data.pending_request && !data.blocked) {
        if (data.can_grant) await grant(initial.scope, initial.reason);
        else await sendRequest(initial.scope, initial.reason);
      }
      setAutoStarting(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While waiting: an approver may tap Approve / Decline on Telegram — pick it
  // up without anyone typing the code.
  useEffect(() => {
    if (!request || result) return undefined;
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/api/bookings/${booking.id}/complimentary`);
        const latest = r.data.latest_request;
        if (!latest || latest.id !== request.id) return;
        if (latest.status === 'approved') {
          setResult({ approved_by: latest.approved_by_name, new_total: r.data.current_total, via_telegram: latest.approved_via === 'button' });
        } else if (latest.status === 'declined') {
          setRequest(null);
          setDeclined(latest.declined_by_name || 'the manager');
        }
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [request?.id, result]); // eslint-disable-line react-hooks/exhaustive-deps

  async function grant(s = scope, why = reason) {
    setSaving(true); setError('');
    try {
      const r = await api.post(`/api/bookings/${booking.id}/complimentary`, { scope: s, reason: why });
      setResult(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not make it complimentary');
    } finally { setSaving(false); }
  }

  async function sendRequest(s = scope, why = reason) {
    setSaving(true); setError('');
    try {
      const r = await api.post(`/api/bookings/${booking.id}/complimentary/request`, { scope: s, reason: why });
      setRequest(r.data); setCode('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the request');
      if (initial) { setScope(s); setReason(why); }
    } finally { setSaving(false); }
  }

  async function approve() {
    setSaving(true); setError('');
    try {
      const r = await api.post(`/api/bookings/${booking.id}/complimentary/approve`, { request_id: request.id, code });
      setResult(r.data);
    } catch (err) {
      const d = err.response?.data || {};
      setError(d.error || 'Could not check the code');
      if (d.code === 'DECLINED') { setRequest(null); setError(''); setDeclined(d.error.replace(/^Declined by /, '')); }
      else if (['EXPIRED', 'LOCKED', 'CHANGED'].includes(d.code) || d.attempts_left === 0) setRequest(null);
      else if (d.attempts_left != null) setRequest(q => ({ ...q, attempts_left: d.attempts_left }));
    } finally { setSaving(false); }
  }

  async function cancelRequest() {
    setSaving(true);
    try { await api.delete(`/api/bookings/${booking.id}/complimentary/request`); } catch {}
    setSaving(false);
    setRequest(null); setError('');
  }

  async function cancelReservation() {
    setSaving(true); setError('');
    try {
      await api.delete(`/api/bookings/${booking.id}`, { data: { reason: cancelReason.trim() } });
      onCancelled?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not cancel the reservation');
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true); setError('');
    try {
      const r = await api.delete(`/api/bookings/${booking.id}/complimentary`, { data: { reason } });
      setResult(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove it');
    } finally { setSaving(false); }
  }

  function close() {
    if (result) onDone?.(); else onClose?.();
  }

  const title = mode === 'remove' ? 'Remove Complimentary' : 'Make Complimentary';
  const scopes = info ? Object.entries(info.scopes).filter(([k]) => k !== 'room_meals' || info.has_meals) : [];
  const chosen = info && scope ? info.scopes[scope] : null;

  let body, footer;
  if (loadError) {
    body = <div className="alert alert-error">{loadError}</div>;
    footer = <button className="btn btn-secondary" onClick={close}>Close</button>;
  } else if (!info || (autoStarting && !result && !request && !error)) {
    body = (
      <div className="text-muted" style={{ padding: '12px 0' }}>
        {!info ? 'Loading…' : info.can_grant ? '🎁 Making the stay complimentary…' : '📨 Sending the approval request to the manager on Telegram…'}
      </div>
    );
    footer = null;
  } else if (declined) {
    body = (
      <>
        <div className="alert alert-error" style={{ marginBottom: 12 }}><div>
          ❌ <strong>Declined by {declined}</strong> on Telegram.
        </div></div>
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          Nothing was changed — the booking is still at its normal price of <strong>{fmtIDR(info.current_total)}</strong>.
        </div>
        {!cancelling ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {canCancel ? 'Is the guest still coming at the normal price, or should this reservation be cancelled?' : 'The guest is already checked in, so the stay stays at the normal price.'}
            </div>
            <button type="button" className="btn btn-link" style={{ padding: 0, marginTop: 8, fontSize: 13, background: 'none', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer' }}
              onClick={() => { setDeclined(null); setError(''); }}>
              Talked to them? Ask for approval again
            </button>
          </>
        ) : (
          <div className="form-group">
            <label className="form-label">Reason for cancelling</label>
            <textarea className="form-textarea" value={cancelReason} autoFocus onChange={e => setCancelReason(e.target.value)} />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              The room is freed and its folio charges voided. Money already received isn't refunded automatically — check Payment Tracking.
            </div>
          </div>
        )}
        {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
      </>
    );
    footer = cancelling ? (
      <>
        <button className="btn btn-secondary" disabled={saving} onClick={() => setCancelling(false)}>Back</button>
        <button className="btn btn-danger" disabled={saving || !cancelReason.trim()} onClick={cancelReservation}>
          {saving ? 'Cancelling…' : 'Cancel reservation'}
        </button>
      </>
    ) : (
      <>
        {canCancel && (
          <button className="btn btn-danger" onClick={() => { setCancelReason(`Complimentary declined by ${declined}`); setCancelling(true); }}>
            Cancel reservation…
          </button>
        )}
        <button className="btn btn-primary" onClick={close}>{canCancel ? 'Keep — normal price' : 'Close'}</button>
      </>
    );
  } else if (mode === 'remove') {
    body = (
      <>
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          The price goes back to what it was before it was made complimentary (per night, if the dates changed). Payment lines, the folio and reports follow.
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Made complimentary by mistake" />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </>
    );
    footer = (
      <>
        <button className="btn btn-secondary" onClick={close}>Cancel</button>
        <button className="btn btn-primary" disabled={saving || !reason.trim()} onClick={remove}>{saving ? 'Saving…' : 'Remove Complimentary'}</button>
      </>
    );
  } else if (info.blocked) {
    body = <div className="alert alert-error">{info.blocked}</div>;
    footer = <button className="btn btn-secondary" onClick={close}>Close</button>;
  } else if (request) {
    const s = info.scopes[request.scope];
    body = (
      <>
        <div className="alert alert-success" style={{ marginBottom: 12 }}><div>
          Sent on Telegram to <strong>{(request.approver_names || []).join(', ') || 'the approvers'}</strong>.
          When they tap Approve, this screen updates by itself. Or ask them for the code in the same message — it works until {fmtTime(request.expires_at)}.
        </div></div>
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <div className="flex-between"><span className="text-muted">Free</span><strong>{s?.label}</strong></div>
          <div className="flex-between"><span className="text-muted">New price</span><strong>{fmtIDR(s?.new_total)}</strong></div>
          <div className="flex-between"><span className="text-muted">Reason</span><span style={{ textAlign: 'right', maxWidth: '70%' }}>{request.reason}</span></div>
        </div>
        <div className="form-group">
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>⏳ Waiting for approval…</div>
          <label className="form-label">Approval code</label>
          <input className="form-input" inputMode="numeric" autoFocus maxLength={7} placeholder="123 456"
            style={{ fontSize: 22, letterSpacing: 4, textAlign: 'center', maxWidth: 220 }}
            value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter' && code.replace(/\D/g, '').length === 6) approve(); }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{request.attempts_left} {request.attempts_left === 1 ? 'try' : 'tries'} left</div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </>
    );
    footer = (
      <>
        <button className="btn btn-secondary" disabled={saving} onClick={cancelRequest}>Cancel request</button>
        <button className="btn btn-primary" disabled={saving || code.replace(/\D/g, '').length !== 6} onClick={approve}>
          {saving ? 'Checking…' : 'Approve'}
        </button>
      </>
    );
  } else {
    const noApprovers = !info.can_grant && info.approvers.length === 0;
    body = (
      <>
        <div className="flex-between" style={{ fontSize: 13, marginBottom: 12 }}>
          <span className="text-muted">Current price</span><strong>{fmtIDR(info.current_total)}</strong>
        </div>
        <div className="form-label">What is free?</div>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {scopes.map(([key, s]) => (
            <label key={key} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '10px 12px', borderRadius: 8,
              border: `1.5px solid ${scope === key ? 'var(--accent, #7c2d12)' : 'var(--border)'}`,
            }}>
              <input type="radio" name="comp-scope" checked={scope === key} onChange={() => setScope(key)} style={{ marginTop: 3 }} />
              <span style={{ flex: 1 }}>
                <span className="flex-between"><strong>{key === 'room' && !info.has_meals ? 'Room' : s.label}</strong><span>Guest pays {fmtIDR(s.new_total)}</span></span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                  {key === 'room' && !info.has_meals ? 'Extras charged to the room are still paid' : SCOPE_HELP[key]}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {REASONS.map(r => (
              <button key={r} type="button" className="btn btn-secondary btn-sm" onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <textarea className="form-textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this stay free?" />
        </div>
        {chosen && chosen.value_gross > 0 && (
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            Value given away: <strong>{fmtIDR(chosen.value_gross)}</strong>. Money already received stays as a credit (refund by hand). Reports count these nights for occupancy but not ADR.
          </div>
        )}
        {!info.can_grant && !noApprovers && (
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Needs a manager's approval — sent on Telegram to {info.approvers.join(', ')}.
          </div>
        )}
        {noApprovers && (
          <div className="alert alert-error" style={{ marginBottom: 8 }}>
            Needs a manager's approval, but nobody is set up to approve yet. The owner can tick "Approve complimentary stays" for a manager in Settings → Reports &amp; Alerts.
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </>
    );
    const valid = scope && reason.trim();
    footer = (
      <>
        <button className="btn btn-secondary" onClick={close}>Cancel</button>
        {info.can_grant ? (
          <button className="btn btn-primary" disabled={saving || !valid} onClick={() => grant()}>{saving ? 'Saving…' : '🎁 Make Complimentary'}</button>
        ) : (
          <button className="btn btn-primary" disabled={saving || !valid || noApprovers} onClick={() => sendRequest()}>{saving ? 'Sending…' : 'Request approval'}</button>
        )}
      </>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{title} — {booking.guest_name}</div>
          <button className="btn btn-icon" onClick={close}>✕</button>
        </div>
        <div className="modal-body">{body}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
