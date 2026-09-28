import { useState, useEffect } from 'react';
import api from '../services/api';

// Amend Dates for a group, room by room: every room that can still change
// (not cancelled / no-show / checked out) has its own Check-in · Nights ·
// Check-out, starting from its current dates. The ticked rooms are checked
// live (free? checked in?) and priced like a single room's Amend Dates —
// their new price can be typed. "Set all ticked rooms to" moves them together.
// POST /api/bookings/group/:id/dates/quote-rooms (check) →
// PUT /api/bookings/group/:id/dates/rooms (save, all or nothing).

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const ymd = v => String(v || '').slice(0, 10);
function addDaysYmd(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, dd + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function nightsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}
const signed = n => (Math.abs(n) < 0.5 ? '—' : `${n > 0 ? '+' : '−'}${fmtIDR(Math.abs(n))}`);

export default function GroupAmendDatesModal({ groupId, groupName, rooms, onClose, onDone }) {
  const [rows, setRows] = useState(() => rooms.map(b => ({
    booking_id: b.id, unit_name: b.unit_name, status: b.status,
    cur_in: ymd(b.check_in_date), cur_out: ymd(b.check_out_date),
    on: true, ci: ymd(b.check_in_date), co: ymd(b.check_out_date), price: '', touched: false,
  })));
  const [all, setAll] = useState(() => ({ ci: ymd(rooms[0]?.check_in_date), co: ymd(rooms[0]?.check_out_date) }));
  const [quote, setQuote] = useState({});     // booking_id → quote row
  const [quoteError, setQuoteError] = useState('');
  const [noCharge, setNoCharge] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const valid = r => r.ci && r.co && r.co > r.ci;
  const changed = r => r.on && valid(r) && (r.ci !== r.cur_in || r.co !== r.cur_out);
  const setRow = (id, patch) => setRows(rs => rs.map(r => (r.booking_id === id ? { ...r, ...patch } : r)));
  // Check-in moves keep the nights; nights move check-out.
  const rowCheckIn = (r, v) => setRow(r.booking_id, { ci: v, co: v && valid(r) ? addDaysYmd(v, nightsBetween(r.ci, r.co)) : r.co, touched: false });
  const rowNights = (r, v) => { const n = parseInt(v, 10); if (n >= 1 && r.ci) setRow(r.booking_id, { co: addDaysYmd(r.ci, n), touched: false }); };

  // Live check of the ticked rooms that change.
  const checkKey = rows.filter(changed).map(r => `${r.booking_id}:${r.ci}:${r.co}`).join(',');
  useEffect(() => {
    const list = rows.filter(changed);
    if (!list.length) return;
    let live = true;
    const t = setTimeout(() => {
      api.post(`/api/bookings/group/${groupId}/dates/quote-rooms`, { rooms: list.map(r => ({ booking_id: r.booking_id, check_in_date: r.ci, check_out_date: r.co })) })
        .then(res => {
          if (!live) return;
          setQuoteError('');
          setQuote(q => ({ ...q, ...Object.fromEntries(res.data.rooms.map(x => [x.booking_id, { ...x, key: `${x.new.check_in}:${x.new.check_out}` }])) }));
        })
        .catch(e => { if (live) setQuoteError(e.response?.data?.error || 'Could not check the new dates'); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [checkKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const qOf = r => { const q = quote[r.booking_id]; return q && q.key === `${r.ci}:${r.co}` ? q : null; };
  const moving = rows.filter(changed);
  const newPrice = r => (r.touched && r.price !== '' ? parseFloat(r.price) : qOf(r)?.new.total);
  const chargeOf = r => { const q = qOf(r); if (!q) return 0; return noCharge ? 0 : (newPrice(r) || 0) - q.old.total; };
  const pending = moving.some(r => !qOf(r));
  const problems = moving.filter(r => qOf(r)?.problem);
  const okMoving = moving.filter(r => qOf(r) && !qOf(r).problem);   // the rooms that can change
  const totalCharge = okMoving.reduce((s, r) => s + chargeOf(r), 0);
  const canSave = moving.length > 0 && !pending && !problems.length && reason.trim() && !saving
    && moving.every(r => !r.touched || (r.price !== '' && parseFloat(r.price) >= 0));

  function applyAll() {
    if (!(all.ci && all.co && all.co > all.ci)) return;
    setRows(rs => rs.map(r => (r.on ? { ...r, ci: r.status === 'checked_in' ? r.ci : all.ci, co: all.co, touched: false } : r)));
  }
  async function save() {
    setSaving(true); setError('');
    try {
      await api.put(`/api/bookings/group/${groupId}/dates/rooms`, {
        rooms: moving.map(r => ({ booking_id: r.booking_id, check_in_date: r.ci, check_out_date: r.co, ...(r.touched && !noCharge ? { new_total: parseFloat(r.price) } : {}) })),
        complimentary: noCharge, reason,
      });
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not change the dates');
      setSaving(false);
    }
  }

  const allNights = all.ci && all.co && all.co > all.ci ? nightsBetween(all.ci, all.co) : '';
  const TH = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '6px 6px', borderBottom: '1px solid var(--border)' };
  const TD = { padding: '8px 6px', borderBottom: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top' };
  const inp = { padding: '4px 6px', fontSize: 13 };
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 960, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Amend Dates — {groupName}'s group</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Change the rooms you tick — each keeps its own dates. A checked-in room can only change its check-out date.
          </div>
          <div className="flex gap-2" style={{ alignItems: 'end', flexWrap: 'wrap', padding: '8px 10px', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, paddingBottom: 6 }}>Set all ticked rooms to</span>
            <input className="form-input" type="date" style={{ ...inp, width: 150 }} value={all.ci}
              onChange={e => { const v = e.target.value; setAll(a => ({ ci: v, co: v && allNights ? addDaysYmd(v, allNights) : a.co })); }} />
            <input className="form-input" type="number" min={1} style={{ ...inp, width: 64 }} value={allNights} title="Nights"
              onChange={e => { const n = parseInt(e.target.value, 10); if (n >= 1 && all.ci) setAll(a => ({ ...a, co: addDaysYmd(a.ci, n) })); }} />
            <input className="form-input" type="date" style={{ ...inp, width: 150 }} value={all.co} min={all.ci ? addDaysYmd(all.ci, 1) : undefined}
              onChange={e => setAll(a => ({ ...a, co: e.target.value }))} />
            <button type="button" className="btn btn-sm btn-secondary" onClick={applyAll}>Apply</button>
          </div>

          <div className="table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...TH, width: 26 }} /><th style={TH}>Room</th>
                <th style={TH}>Check-in</th><th style={{ ...TH, width: 70 }}>Nights</th><th style={TH}>Check-out</th>
                <th style={{ ...TH, textAlign: 'right' }}>Now</th><th style={{ ...TH, textAlign: 'right' }}>New price</th><th style={{ ...TH, textAlign: 'right' }}>Difference</th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const q = qOf(r);
                  const isChanged = changed(r);
                  return (
                    <tr key={r.booking_id} style={{ opacity: r.on ? 1 : 0.55 }}>
                      <td style={TD}><input type="checkbox" checked={r.on} onChange={() => setRow(r.booking_id, { on: !r.on })} /></td>
                      <td style={TD}>
                        <b>{r.unit_name}</b>
                        <div className="text-muted" style={{ fontSize: 11 }}>now {r.cur_in} → {r.cur_out}{r.status === 'checked_in' ? ' · checked in' : ''}</div>
                        {r.on && isChanged && (q
                          ? (q.problem
                            ? <div style={{ color: 'var(--color-danger, #dc2626)', fontSize: 12 }}>✕ {q.problem}</div>
                            : <div style={{ color: 'var(--color-success, #16a34a)', fontSize: 12 }}>✓ Available</div>)
                          : <div className="text-muted" style={{ fontSize: 12 }}>Checking…</div>)}
                      </td>
                      <td style={TD}><input className="form-input" type="date" style={{ ...inp, width: 140 }} value={r.ci}
                        disabled={!r.on || r.status === 'checked_in'} onChange={e => rowCheckIn(r, e.target.value)} /></td>
                      <td style={TD}><input className="form-input" type="number" min={1} style={{ ...inp, width: 60 }} disabled={!r.on}
                        value={valid(r) ? nightsBetween(r.ci, r.co) : ''} onChange={e => rowNights(r, e.target.value)} /></td>
                      <td style={TD}><input className="form-input" type="date" style={{ ...inp, width: 140 }} value={r.co} disabled={!r.on}
                        min={r.ci ? addDaysYmd(r.ci, 1) : undefined} onChange={e => setRow(r.booking_id, { co: e.target.value, touched: false })} /></td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>{q ? fmtIDR(q.old.total) : ''}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        {isChanged && q && !q.problem && (
                          <>
                            <input className="form-input" type="number" min={0} disabled={noCharge} style={{ ...inp, width: 120, textAlign: 'right' }}
                              value={r.touched ? r.price : String(Math.round(q.new.total))}
                              onChange={e => setRow(r.booking_id, { price: e.target.value, touched: true })} />
                            {q.new.normal_total > 0 && <div className="text-muted" style={{ fontSize: 10 }}>normal {fmtIDR(q.new.normal_total)}</div>}
                          </>
                        )}
                        {r.on && !isChanged && <span className="text-muted" style={{ fontSize: 12 }}>no change</span>}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap', color: chargeOf(r) < 0 ? 'var(--color-success, #16a34a)' : undefined }}>
                        {isChanged && q && !q.problem ? signed(chargeOf(r)) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-muted" style={{ fontSize: 11, margin: '4px 0 12px' }}>
            New prices are suggested at each room's booked nightly price (meals included), incl. service &amp; tax — type another price if needed.
          </div>
          {quoteError && <div className="alert alert-error"><div>{quoteError}</div></div>}

          <div className="form-group">
            <label className="flex gap-2" style={{ alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={noCharge} onChange={e => setNoCharge(e.target.checked)} />
              No charge — keep the current prices
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">Reason</label>
            <input className="form-input" value={reason} placeholder="e.g. Room 203 leaves one day early" onChange={e => setReason(e.target.value)} />
          </div>
          <div className="flex-between" style={{ fontSize: 14, fontWeight: 700 }}>
            <span>
              {okMoving.length} room{okMoving.length === 1 ? '' : 's'} change{okMoving.length === 1 ? 's' : ''}
              {' · '}{Math.abs(totalCharge) < 0.5 ? 'no price change' : totalCharge < 0 ? 'credit' : 'added to the bill'}
            </span>
            <span>{fmtIDR(Math.abs(totalCharge))}</span>
          </div>
          {problems.length > 0 && <div className="alert alert-error" style={{ marginTop: 8 }}><div>Fix or untick the rooms marked ✕ first.</div></div>}
          {error && <div className="alert alert-error" style={{ marginTop: 8 }}><div>{error}</div></div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Change Dates'}</button>
        </div>
      </div>
    </div>
  );
}
