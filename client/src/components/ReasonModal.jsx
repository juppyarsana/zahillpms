import { useState } from 'react';

// A correction that only needs a reason: says what will happen, asks why,
// and stays open with the server's message if it is refused.
// onConfirm(reason) does the work (may throw — an axios error's message is shown).
export default function ReasonModal({ title, children, confirmLabel = 'Confirm', danger = false, placeholder = 'Why is this being done?', onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    if (!reason.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not do that');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
          {children && <div style={{ fontSize: 14, marginBottom: 14, lineHeight: 1.5 }}>{children}</div>}
          <div className="form-group">
            <label className="form-label">Reason (required — kept in the history)</label>
            <input className="form-input" autoFocus value={reason} placeholder={placeholder}
              onChange={e => setReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={go} disabled={busy || !reason.trim()}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
