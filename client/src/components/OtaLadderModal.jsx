import { useEffect, useState } from 'react';
import api from '../services/api';

// OTA price ladders (migration 137): for one meal plan linked to the channel
// manager, a price per room type for each tier of rooms sold in the whole
// hotel. Each night the channel manager sends the price of the tier the next
// room falls in; a booking or cancellation moves it within ~20 s. Prices are
// per room per night, service & tax included, sent as typed. A fixed OTA
// price still wins on its nights; PMS prices don't change.

// "1,511,250" / "1.511.250" / "1511250.5" → a number; '' → null; bad → NaN.
export function parsePrice(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const n = Number(t.replace(/[.,\s](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
const fmt = n => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const emptyRow = cols => ({ key: Math.random().toString(36).slice(2), up_to: '', prices: Array(cols).fill('') });

function rowsFrom(plan) {
  const cols = plan.room_types.length;
  if (!plan.ladder) return [emptyRow(cols)];
  return plan.ladder.tiers.map(t => ({
    key: Math.random().toString(36).slice(2), up_to: String(t),
    prices: plan.room_types.map(rt => (plan.ladder.prices[rt.id]?.[t] != null ? fmt(plan.ladder.prices[rt.id][t]) : '')),
  }));
}

export default function OtaLadderModal({ onClose }) {
  const [data, setData] = useState(null);
  const [fixed, setFixed] = useState([]);
  const [planId, setPlanId] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(keep) {
    try {
      const [l, p] = await Promise.all([api.get('/api/channel-manager/ladders'), api.get('/api/channel-manager/prices')]);
      setData(l.data);
      setFixed(p.data.prices || []);
      const id = keep || planId || l.data.plans.find(x => x.ladder)?.rate_plan_id || l.data.plans[0]?.rate_plan_id || '';
      setPlanId(id);
      const plan = l.data.plans.find(x => x.rate_plan_id === id);
      if (plan) setRows(rowsFrom(plan));
    } catch (e) { setError(e.response?.data?.error || 'Could not load the price ladders'); }
  }
  useEffect(() => { load(); }, []);

  const plan = data?.plans.find(p => p.rate_plan_id === planId);
  const cols = plan?.room_types.length || 0;

  function pickPlan(id) {
    setPlanId(id); setError(''); setSaved('');
    const p = data.plans.find(x => x.rate_plan_id === id);
    setRows(rowsFrom(p));
  }

  function setCell(ri, ci, value) {
    setRows(rs => rs.map((r, i) => {
      if (i !== ri) return r;
      if (ci === 0) return { ...r, up_to: value };
      const prices = [...r.prices]; prices[ci - 1] = value;
      return { ...r, prices };
    }));
  }

  // Pasting a block from Excel spreads it over the grid from the cell pasted in
  // (column 0 = "sold up to"); rows are added as needed.
  function onPaste(e, ri, ci) {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const block = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
    setRows(rs => {
      const next = rs.map(r => ({ ...r, prices: [...r.prices] }));
      block.forEach((cells, bi) => {
        const at = ri + bi;
        while (next.length <= at) next.push(emptyRow(cols));
        cells.forEach((v, bj) => {
          const c = ci + bj;
          if (c === 0) next[at].up_to = v.trim().replace(/[.,\s]/g, '');
          else if (c <= cols) next[at].prices[c - 1] = v.trim();
        });
      });
      return next;
    });
  }

  async function save() {
    setError(''); setSaved('');
    const used = rows.filter(r => r.up_to.trim() || r.prices.some(p => p.trim()));
    if (!used.length) { setError('Type at least one tier'); return; }
    const tiers = used.map(r => Number(r.up_to));
    const prices = {};
    for (const [ci, rt] of plan.room_types.entries()) {
      const list = used.map(r => parsePrice(r.prices[ci]));
      if (list.some(v => Number.isNaN(v))) { setError(`${rt.name}: a price isn't a number`); return; }
      prices[rt.id] = list;
    }
    setBusy(true);
    try {
      const r = await api.put(`/api/channel-manager/ladders/${planId}`, { tiers, prices });
      setSaved(`Saved: ${r.data.tiers} tiers for ${r.data.room_types} room type${r.data.room_types === 1 ? '' : 's'} — the OTAs get the new prices within about 20 seconds.`);
      load(planId);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save');
    } finally { setBusy(false); }
  }

  async function removeLadder() {
    if (!window.confirm(`Remove the price ladder for ${plan.rate_plan_name}? The OTAs get the normal price (room rate + meal plan) again.`)) return;
    try {
      await api.delete(`/api/channel-manager/ladders/${planId}`);
      setSaved('Ladder removed — the OTAs get the normal price again.');
      load(planId);
    } catch (e) { setError(e.response?.data?.error || 'Could not remove'); }
  }

  const tiersTyped = rows.map(r => Number(r.up_to)).filter(n => n > 0);
  const top = tiersTyped.length ? Math.max(...tiersTyped) : 0;
  const fixedHere = fixed.filter(p => p.rate_plan_id === planId && p.linked);

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 1000, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">📈 OTA price ladder</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            A price for each tier of <b>rooms sold in the whole hotel</b> that night, per room per night, <b>service &amp; tax included</b>.
            The OTAs get the price of the tier the <b>next</b> room falls in — with 16 sold, the next room is the 17th, so the "up to 20" row.
            Every booking or cancellation is counted again and the price reaches the OTAs within about 20 seconds. Prices in the PMS (New Booking, the bill) don't change.
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {saved && <div className="alert alert-success">{saved}</div>}

          {data && !data.plans.length && (
            <div className="alert alert-warn">
              <div>No meal plan is linked to the channel manager yet — link them in Settings → Channel Manager first.</div>
            </div>
          )}

          {plan && (
            <>
              <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Meal plan</span>
                <div className="seg">
                  {data.plans.map(p => (
                    <button key={p.rate_plan_id} type="button" className={p.rate_plan_id === planId ? 'active' : ''} onClick={() => pickPlan(p.rate_plan_id)}>
                      {p.rate_plan_name}{p.ladder ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {plan.ladder
                ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Ladder in use · saved {new Date(plan.ladder.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}
                    {plan.ladder.updated_by_name ? ` · ${plan.ladder.updated_by_name}` : ''}
                  </div>
                : <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>No ladder yet — the OTAs get the normal price (room rate + meal plan) for this meal plan.</div>}

              {fixedHere.length > 0 && (
                <div className="alert alert-warn">
                  <div>{fixedHere.length} fixed OTA price{fixedHere.length === 1 ? '' : 's'} for {plan.rate_plan_name} still win over the ladder on their nights (🌐 OTA prices). Remove them there if the ladder should apply.</div>
                </div>
              )}

              <div className="table-wrap">
                <table className="table" style={{ minWidth: 140 + cols * 140 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Sold up to</th>
                      {plan.room_types.map(rt => <th key={rt.id} style={{ textAlign: 'right' }}>{rt.name}</th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={r.key}>
                        <td>
                          <input className="form-input" inputMode="numeric" value={r.up_to} placeholder="e.g. 16"
                            onChange={e => setCell(ri, 0, e.target.value.replace(/\D/g, ''))} onPaste={e => onPaste(e, ri, 0)} style={{ width: 90 }} />
                        </td>
                        {r.prices.map((p, pi) => {
                          const bad = Number.isNaN(parsePrice(p));
                          return (
                            <td key={pi}>
                              <input className="form-input" inputMode="decimal" value={p} onChange={e => setCell(ri, pi + 1, e.target.value)}
                                onPaste={e => onPaste(e, ri, pi + 1)} style={{ textAlign: 'right', minWidth: 110, borderColor: bad ? 'var(--danger, #dc2626)' : undefined }} />
                            </td>
                          );
                        })}
                        <td>
                          {rows.length > 1 && (
                            <button className="btn btn-sm btn-secondary" title="Remove this tier" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2" style={{ marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setRows(rs => [...rs, emptyRow(cols)])}>+ Add tier</button>
                {plan.ladder && <button className="btn btn-sm btn-danger" onClick={removeLadder}>Remove ladder</button>}
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Save ladder for ${plan.rate_plan_name}`}</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                Tip: copy the block from Excel ("sold up to" column + prices, in the same room-type order as here) and paste it into the first "Sold up to" box — it fills the grid.
                A room type whose column is left empty keeps the normal price. The hotel has {data.hotel_rooms} rooms
                {top > 0 && top < data.hotel_rooms ? ` — rooms sold past ${top} use the last tier` : ''}.
                A fixed OTA price (🌐 OTA prices) wins over the ladder on its nights. Each send is listed in Settings → Channel Manager → Last sends with its tier.
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
