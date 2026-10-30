import { useState } from 'react';
import api from '../services/api';

// Pricing rules (OTA dashboard): the occupancy targets that decide which dates
// are slow, and the minimum price per room type. Sales read them; the owner
// changes them. Also the log of who changed OTA prices.
const fmt = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
const digits = v => String(v ?? '').replace(/\D/g, '');
const when = d => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' });

const TARGETS = [['near', '0–7 days before the stay'], ['mid', '8–14 days before the stay'], ['far', '15–30 days before the stay']];

export default function OtaRulesModal({ rules, roomTypes, changes, canEdit, onClose, onSaved }) {
  const [targets, setTargets] = useState({ ...rules.targets });
  const [mins, setMins] = useState(Object.fromEntries(roomTypes.map(t => [t.id, rules.minimums[t.id] != null ? fmt(rules.minimums[t.id]) : ''])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError('');
    try {
      await api.put('/api/ota-dashboard/rules', {
        targets: { near: Number(targets.near), mid: Number(targets.mid), far: Number(targets.far) },
        minimums: Object.fromEntries(roomTypes.map(t => [t.id, digits(mins[t.id]) ? Number(digits(mins[t.id])) : null])),
      });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save');
      setBusy(false);
    }
  }

  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 };
  const sub = { margin: '0 0 2px', fontSize: 13, lineHeight: 1.4, color: 'var(--text-muted)' };

  return (
    <div className="modal-backdrop" style={{ alignItems: 'flex-start', overflowY: 'auto' }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ota-rules-title" style={{ maxWidth: 540, maxHeight: 'none' }}>
        <div className="modal-header">
          <div>
            <div id="ota-rules-title" className="modal-title">Pricing rules</div>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{canEdit ? 'Sales can read these. Only you can change them.' : 'Only the owner can change these.'}</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && <div className="alert alert-error">{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Occupancy targets</div>
            <p style={sub}>A date below its target shows as slow. Closer dates have a higher target, because there is less time left to fill rooms.</p>
            {TARGETS.map(([k, label]) => (
              <div key={k} style={row}>
                <label htmlFor={`target-${k}`} style={{ fontSize: 14 }}>{label}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input id={`target-${k}`} className="form-input" inputMode="numeric" disabled={!canEdit} value={targets[k]}
                    onChange={e => setTargets(t => ({ ...t, [k]: digits(e.target.value) }))} style={{ width: 70, textAlign: 'right' }} />
                  <span className="text-muted">%</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Minimum prices</div>
            <p style={sub}>Nobody can save a price or a ladder below these, and suggestions stop at them. Per room, per night, service and tax included. Empty = no minimum. Prices already set are not changed.</p>
            {roomTypes.map(t => (
              <div key={t.id} style={row}>
                <label htmlFor={`min-${t.id}`} style={{ fontSize: 14 }}>{t.name}</label>
                <input id={`min-${t.id}`} className="form-input" inputMode="numeric" disabled={!canEdit} value={mins[t.id]}
                  onChange={e => setMins(m => ({ ...m, [t.id]: e.target.value }))}
                  onBlur={e => setMins(m => ({ ...m, [t.id]: digits(e.target.value) ? fmt(digits(e.target.value)) : '' }))}
                  style={{ width: 130, textAlign: 'right' }} />
              </div>
            ))}
          </div>

          {canEdit && <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</button>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Recent price changes</div>
            {!changes.length && <p style={sub}>Nothing changed yet.</p>}
            {changes.map(c => (
              <div key={c.id} style={{ fontSize: 13, lineHeight: 1.4 }}>
                <div>{c.summary}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>{when(c.created_at)} · {c.user_name || 'Someone'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
