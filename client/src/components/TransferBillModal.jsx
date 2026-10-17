import { useState, useEffect } from 'react';
import api from '../services/api';
import { lineShown, shownTotal } from '../lib/priceBasis';

// Transfer bill (migration 113): unpaid extras on this folio — Sales items,
// restaurant / POS bills, activities — move to another room's folio, e.g. two
// friends booked separately and room 101 pays room 102's bill. Room / meal
// nights and per-night extras stay (the night audit posts them to their own
// booking). POST /api/folio/:id/transfer.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const shortDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

export const transferableLines = (folio, booking) => (folio && !booking.folio_status && booking.complimentary_scope !== 'all'
  ? folio.charges.filter(c => !['room', 'fnb', 'addon'].includes(c.type) && !c.addon_id && !c.paid_method && !c.complimentary)
  : []);

export default function TransferBillModal({ booking, folio, onClose, onDone }) {
  const lines = transferableLines(folio, booking);
  const [picked, setPicked] = useState(lines.map(c => c.id));
  const [targets, setTargets] = useState(null);
  const [filter, setFilter] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get(`/api/folio/${booking.id}/transfer-targets`)
      .then(r => setTargets(r.data))
      .catch(() => setError('Could not load the other rooms'));
  }, [booking.id]);

  // What the chosen lines come to with service & tax, as the folio adds it.
  const total = (() => {
    let taxable = 0, untaxed = 0;
    for (const c of lines) if (picked.includes(c.id)) {
      if (c.tax_mode && c.tax_mode !== 'added') untaxed += parseFloat(c.amount); else taxable += parseFloat(c.amount);
    }
    const sc = r2(taxable * (parseFloat(folio.service_charge_rate) || 0) / 100);
    const tax = r2((taxable + sc) * (parseFloat(folio.tax_rate) || 0) / 100);
    return r2(taxable + sc + tax + untaxed);
  })();
  const q = filter.trim().toLowerCase();
  const shown = (targets || []).filter(t => !q || `${t.unit_name} ${t.guest_name}`.toLowerCase().includes(q));
  const target = (targets || []).find(t => t.id === to);
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  async function save() {
    setSaving(true); setError('');
    try {
      const r = await api.post(`/api/folio/${booking.id}/transfer`, { charge_ids: picked, to_booking_id: to, reason });
      setDone(r.data);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not transfer the bill');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 680, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Transfer bill — room {booking.unit_name}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {done ? (
            <div style={{ fontSize: 14 }}>
              ✓ {done.moved} line{done.moved === 1 ? '' : 's'} ({fmtIDR(shownTotal(done.amount, folio))}) moved to room <b>{done.to_unit_name}</b> · {done.to_guest_name}.
              <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>They are paid on that room's folio now. To move a line back, open that room's folio and transfer it here.</div>
            </div>
          ) : !lines.length ? (
            <div className="alert"><div>Nothing here can be transferred — only unpaid extras (Sales items, restaurant bills, activities) move; room and meal nights stay on their own room.</div></div>
          ) : (
            <>
              <div className="form-label">What moves</div>
              <div className="table-wrap" style={{ marginBottom: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {lines.map(c => (
                      <tr key={c.id} onClick={() => toggle(c.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)', width: 28 }}><input type="checkbox" checked={picked.includes(c.id)} readOnly /></td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 13 }}>{c.description.replace(/ — \d{4}-\d{2}-\d{2}$/, '')}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 13, whiteSpace: 'nowrap' }}>{shortDate(c.service_date || c.posted_at)}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(lineShown(c.amount, c, folio))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="form-label">Room that pays</div>
              {targets === null ? <div className="text-muted">Loading…</div> : !targets.length ? (
                <div className="alert"><div>No other room is booked for these dates.</div></div>
              ) : (
                <>
                  {targets.length > 6 && (
                    <input className="form-input" style={{ marginBottom: 8 }} placeholder="Search room or guest" value={filter} onChange={e => setFilter(e.target.value)} />
                  )}
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14 }}>
                    {shown.map(t => (
                      <label key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: to === t.id ? 'var(--cream)' : undefined }}>
                        <input type="radio" name="transfer-to" checked={to === t.id} onChange={() => setTo(t.id)} />
                        <b style={{ minWidth: 48 }}>{t.unit_name}</b>
                        <span style={{ flex: 1 }}>{t.guest_name}</span>
                        <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {t.same_group && '👥 '}{shortDate(t.check_in_date)} – {shortDate(t.check_out_date)} · {t.status === 'checked_in' ? 'in house' : 'not arrived'}
                        </span>
                      </label>
                    ))}
                    {!shown.length && <div className="text-muted" style={{ padding: 10 }}>No room matches.</div>}
                  </div>
                </>
              )}

              <div className="form-group">
                <label className="form-label">Reason</label>
                <input className="form-input" value={reason} maxLength={300} placeholder="e.g. Room 101 pays for their friends in 102" onChange={e => setReason(e.target.value)} />
              </div>
              {error && <div className="alert alert-error"><div>{error}</div></div>}
            </>
          )}
        </div>
        <div className="modal-footer">
          {done || !lines.length ? (
            <button className="btn btn-primary" onClick={onClose}>{done ? 'Done' : 'Close'}</button>
          ) : (<>
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !picked.length || !to || !reason.trim()}>
              {saving ? 'Moving…' : `Transfer ${fmtIDR(shownTotal(total, folio))}${target ? ` to room ${target.unit_name}` : ''}`}
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}
