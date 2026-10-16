import { useState } from 'react';
import api from '../services/api';

// Set Prices: Edit Price for several rooms of a group at once — e.g. an agent
// series imported from the old system at Rp 0. A price per night per room
// (tax and meal plan included, before any group discount — the same figure
// Edit Price takes, per night); "Set ticked rooms to" fills a room type or
// every ticked room. PUT /api/bookings/group/:id/price — all rooms or none,
// each through the same rules as Edit Price (owner or the Edit Price
// permission). Complimentary rooms and rooms on an agent invoice can't be
// set here.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const ymd = v => String(v || '').slice(0, 10);
function nightsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}
const fmtDay = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export default function GroupPriceModal({ groupId, groupName, rooms, onClose, onDone }) {
  const [rows, setRows] = useState(() => rooms
    .filter(b => !['cancelled', 'no_show'].includes(b.status))
    .map(b => {
      const nights = nightsBetween(ymd(b.check_in_date), ymd(b.check_out_date));
      const blocked = b.complimentary_scope ? 'complimentary' : ['invoiced', 'paid'].includes(b.folio_status) ? 'on an agent invoice' : null;
      return {
        booking_id: b.id, unit_name: b.unit_name, type: b.room_type_name || '—', nights,
        ci: ymd(b.check_in_date), co: ymd(b.check_out_date),
        now: (parseFloat(b.total_amount) || 0) - (parseFloat(b.discount_amount) || 0),
        hasDiscount: (parseFloat(b.discount_amount) || 0) > 0, blocked,
        on: !blocked, perNight: '',
      };
    }));
  const types = [...new Set(rows.map(r => r.type))];
  const [all, setAll] = useState({ type: '', perNight: '' });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setRow = (id, patch) => setRows(rs => rs.map(r => (r.booking_id === id ? { ...r, ...patch } : r)));
  const priced = r => r.perNight !== '' && Number.isFinite(parseFloat(r.perNight)) && parseFloat(r.perNight) >= 0;
  const ticked = rows.filter(r => r.on && !r.blocked);
  const missing = ticked.filter(r => !priced(r));
  const newTotal = r => (priced(r) ? Math.round(parseFloat(r.perNight) * r.nights * 100) / 100 : null);
  const sumNow = ticked.reduce((s, r) => s + r.now, 0);
  const sumNew = ticked.reduce((s, r) => s + (newTotal(r) || 0), 0);
  const canSave = ticked.length > 0 && !missing.length && reason.trim() && !saving;
  const anyDiscount = ticked.some(r => r.hasDiscount);

  function applyAll() {
    if (all.perNight === '' || !(parseFloat(all.perNight) >= 0)) return;
    setRows(rs => rs.map(r => (r.on && !r.blocked && (!all.type || r.type === all.type) ? { ...r, perNight: all.perNight } : r)));
  }
  async function save() {
    setSaving(true); setError('');
    try {
      await api.put(`/api/bookings/group/${groupId}/price`, {
        rooms: ticked.map(r => ({ booking_id: r.booking_id, total_amount: newTotal(r) })),
        reason: reason.trim(),
      });
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save the prices');
      setSaving(false);
    }
  }

  const TH = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '6px 6px', borderBottom: '1px solid var(--border)' };
  const TD = { padding: '8px 6px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'middle' };
  const inp = { padding: '4px 6px', fontSize: 13 };
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 860, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Set Prices — {groupName}'s group</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Price <b>per night</b> for each ticked room, <b>incl. service &amp; tax and the meal plan</b> — the same figure as Edit Price, per night.
            Each room is saved like an Edit Price (payment lines and Edit History follow).
          </div>
          <div className="flex gap-2" style={{ alignItems: 'end', flexWrap: 'wrap', padding: '8px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, paddingBottom: 6 }}>Set ticked rooms</span>
            {types.length > 1 && (
              <select className="form-input" style={{ ...inp, width: 'auto' }} value={all.type} onChange={e => setAll(a => ({ ...a, type: e.target.value }))}>
                <option value="">of every type</option>
                {types.map(t => <option key={t} value={t}>{t} only</option>)}
              </select>
            )}
            <span style={{ fontSize: 13, paddingBottom: 6 }}>to Rp</span>
            <input className="form-input" type="number" min={0} style={{ ...inp, width: 140 }} value={all.perNight} placeholder="per night"
              onChange={e => setAll(a => ({ ...a, perNight: e.target.value }))} />
            <span style={{ fontSize: 13, paddingBottom: 6 }}>per night</span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={applyAll}>Apply</button>
          </div>

          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead><tr>
                <th style={{ ...TH, width: 26 }} /><th style={TH}>Room</th><th style={TH}>Stay</th>
                <th style={{ ...TH, textAlign: 'right' }}>Now</th><th style={{ ...TH, textAlign: 'right' }}>Per night</th><th style={{ ...TH, textAlign: 'right' }}>New price</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.booking_id} style={{ opacity: r.on && !r.blocked ? 1 : 0.55 }}>
                    <td style={TD}><input type="checkbox" checked={r.on && !r.blocked} disabled={!!r.blocked} onChange={() => setRow(r.booking_id, { on: !r.on })} /></td>
                    <td style={TD}>
                      <b>{r.unit_name}</b>
                      <div className="text-muted" style={{ fontSize: 11 }}>{r.type}{r.blocked ? ` · ${r.blocked} — not here` : ''}</div>
                    </td>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtDay(r.ci)} → {fmtDay(r.co)}<div className="text-muted" style={{ fontSize: 11 }}>{r.nights} night{r.nights === 1 ? '' : 's'}</div></td>
                    <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(r.now)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <input className="form-input" type="number" min={0} style={{ ...inp, width: 130, textAlign: 'right' }} value={r.perNight}
                        disabled={!r.on || !!r.blocked} onChange={e => setRow(r.booking_id, { perNight: e.target.value })} />
                    </td>
                    <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {r.on && !r.blocked && priced(r) ? fmtIDR(newTotal(r)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 13, margin: '12px 0' }}>
            {ticked.length} room{ticked.length === 1 ? '' : 's'} ticked · now <b>{fmtIDR(sumNow)}</b> → new <b>{fmtIDR(sumNew)}</b>
            {missing.length > 0 && <span style={{ color: 'var(--color-danger, #dc2626)' }}> · {missing.length} without a price yet</span>}
          </div>
          {anyDiscount && (
            <div className="alert alert-warn mb-3"><div>Some rooms have a group discount — it is taken off the price you type here, as in Edit Price.</div></div>
          )}
          <div className="form-group">
            <label className="form-label">Reason *</label>
            <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Khiri contract rate 2027" />
          </div>
          {error && <div className="alert alert-error mb-3"><div>{error}</div></div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!canSave} onClick={save}>
            {saving ? 'Saving…' : `Save ${ticked.length} price${ticked.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
