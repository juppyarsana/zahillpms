import { useEffect, useState } from 'react';
import api from '../services/api';
import { parsePrice, parsePct, fmtPrice, workOutPrices, copyLadder } from '../lib/otaLadder';

// OTA price ladders (migration 137): for one meal plan linked to the channel
// manager, a price per room type for each tier of rooms sold in the whole
// hotel. Each night the channel manager sends the price of the tier the next
// room falls in; a booking or cancellation moves it within ~20 s. Prices are
// per room per night, service & tax included, sent as typed. A fixed OTA
// price still wins on its nights; PMS prices don't change.
// Seasons (migration 150): named dates with their own ladders; inside them a
// season's ladder replaces the All year one. ALL_YEAR is the tab with no season.

const ALL_YEAR = '';
const newKey = () => Math.random().toString(36).slice(2);
const emptyRow = cols => ({ key: newKey(), up_to: '', increase: '', prices: Array(cols).fill('') });
const longDate = ymd => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const nextDay = ymd => new Date(Date.parse(ymd + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const ladderIn = (plan, seasonId) => (seasonId ? plan?.season_ladders?.[seasonId] : plan?.ladder) || null;

function rowsFrom(plan, seasonId) {
  const cols = plan.room_types.length;
  const ladder = ladderIn(plan, seasonId);
  if (!ladder) return [emptyRow(cols)];
  return ladder.tiers.map((t, i) => ({
    key: newKey(), up_to: String(t),
    increase: ladder.increases?.[i] != null ? String(ladder.increases[i]) : '',
    prices: plan.room_types.map(rt => (ladder.prices[rt.id]?.[t] != null ? fmtPrice(ladder.prices[rt.id][t]) : '')),
  }));
}

function SeasonForm({ season, today, onSave, onDelete, onCancel, busy }) {
  const [name, setName] = useState(season?.name || '');
  const [from, setFrom] = useState(season?.date_from || '');
  const [to, setTo] = useState(season?.date_to || '');
  const [copy, setCopy] = useState(true);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--surface-2, #FAF8F5)' }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>{season ? `Edit ${season.name}` : 'New season'}</div>
      <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
          <label className="form-label">Name</label>
          <input className="form-input" value={name} maxLength={80} placeholder="e.g. High season" onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">First night</label>
          <input className="form-input" type="date" min={season ? undefined : today} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Last night</label>
          <input className="form-input" type="date" min={from || today} value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>
      {to && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>A guest staying the last night checks out on {longDate(nextDay(to))}.</div>}
      {!season && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 10 }}>
          <input type="checkbox" checked={copy} onChange={e => setCopy(e.target.checked)} />
          Start from a copy of the All year ladders
        </label>
      )}
      <div className="flex gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSave({ name, date_from: from, date_to: to, copy_all_year: copy })}>
          {season ? 'Save season' : 'Add season'}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onCancel}>Cancel</button>
        {season && <><div style={{ flex: 1 }} /><button className="btn btn-danger btn-sm" disabled={busy} onClick={onDelete}>Delete season</button></>}
      </div>
    </div>
  );
}

export default function OtaLadderModal({ onClose }) {
  const [data, setData] = useState(null);
  const [fixed, setFixed] = useState([]);
  const [seasonId, setSeasonId] = useState(ALL_YEAR);
  const [planId, setPlanId] = useState('');
  const [rows, setRows] = useState([]);
  const [worked, setWorked] = useState({});   // row key → prices as last worked out
  const [roundTo, setRoundTo] = useState(1000);
  const [copyFrom, setCopyFrom] = useState('');
  const [copyPct, setCopyPct] = useState('10');
  const [seasonForm, setSeasonForm] = useState(null);   // 'new' | 'edit'
  const [showEnded, setShowEnded] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  function showGrid(plans, seasonKey, keyPlan) {
    const p = plans.find(x => x.rate_plan_id === keyPlan);
    if (p) setRows(rowsFrom(p, seasonKey));
    setWorked({});
    setCopyFrom('');
  }

  async function load({ season = seasonId, plan = planId } = {}) {
    try {
      const [l, p] = await Promise.all([api.get('/api/channel-manager/ladders'), api.get('/api/channel-manager/prices')]);
      setData(l.data);
      setFixed(p.data.prices || []);
      const known = season && l.data.seasons.some(s => s.id === season) ? season : ALL_YEAR;
      const id = plan || l.data.plans.find(x => ladderIn(x, known))?.rate_plan_id || l.data.plans[0]?.rate_plan_id || '';
      setSeasonId(known);
      setPlanId(id);
      showGrid(l.data.plans, known, id);
    } catch (e) { setError(e.response?.data?.error || 'Could not load the price ladders'); }
  }
  useEffect(() => { load(); }, []);

  const plan = data?.plans.find(p => p.rate_plan_id === planId);
  const season = data?.seasons.find(s => s.id === seasonId) || null;
  const scopeName = season ? season.name : 'All year';
  const cols = plan?.room_types.length || 0;
  const endedCount = data ? data.seasons.filter(s => s.ended).length : 0;
  // Ended seasons no longer set a price: hidden unless asked for, or the one open.
  const seasonTabs = data ? data.seasons.filter(s => !s.ended || showEnded || s.id === seasonId) : [];
  const ladder = ladderIn(plan, seasonId);

  function pick(nextSeason, nextPlan) {
    setSeasonId(nextSeason); setPlanId(nextPlan); setError(''); setSaved(''); setSeasonForm(null);
    showGrid(data.plans, nextSeason, nextPlan);
  }

  function setCell(ri, ci, value) {
    setRows(rs => rs.map((r, i) => {
      if (i !== ri) return r;
      if (ci === 0) return { ...r, up_to: value };
      const prices = [...r.prices]; prices[ci - 1] = value;
      return { ...r, prices };
    }));
  }
  const setIncrease = (ri, value) => setRows(rs => rs.map((r, i) => (i === ri ? { ...r, increase: value } : r)));

  // Pasting a block from Excel spreads it over the grid from the cell pasted in
  // (column 0 = "sold up to"; the Increase column is not part of it); rows are
  // added as needed.
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

  function workOut() {
    setError(''); setSaved('');
    if (rows.some(r => Number.isNaN(parsePct(r.increase)))) { setError("An increase isn't a number"); return; }
    if (rows.slice(1).every(r => parsePct(r.increase) === null)) { setError('Type a % on the rows below the first'); return; }
    if (!rows[0]?.prices.some(p => parsePrice(p))) { setError('Type the first row\'s prices first'); return; }
    const next = workOutPrices(rows, roundTo);
    // Ask only when this would overwrite a price someone typed: not one the last press worked out.
    const changesTyped = next.some((r, i) => r.prices.some((p, c) => {
      const was = rows[i].prices[c];
      return was.trim() && was !== p && was !== worked[r.key]?.[c];
    }));
    if (changesTyped && !window.confirm('This replaces prices already in the grid with the worked-out ones. Continue?')) return;
    setRows(next);
    setWorked(Object.fromEntries(next.map(r => [r.key, r.prices])));
  }

  const copySources = data ? data.plans.flatMap(p => [
    ...(p.ladder ? [{ value: `|${p.rate_plan_id}`, label: `All year · ${p.rate_plan_name}`, ladder: p.ladder }] : []),
    ...(data.seasons.filter(s => p.season_ladders[s.id]).map(s => ({ value: `${s.id}|${p.rate_plan_id}`, label: `${s.name} · ${p.rate_plan_name}`, ladder: p.season_ladders[s.id] }))),
  ]).filter(o => o.value !== `${seasonId}|${planId}`) : [];

  function copy() {
    setError(''); setSaved('');
    const source = copySources.find(o => o.value === copyFrom);
    if (!source) { setError('Pick a ladder to copy from'); return; }
    const pct = parsePct(copyPct) ?? 0;
    if (Number.isNaN(pct) || pct < -90 || pct > 500) { setError('The % must be between -90 and 500'); return; }
    if (rows.some(r => r.prices.some(p => p.trim())) && !window.confirm(`This replaces the grid with ${source.label} ${pct >= 0 ? '+' : ''}${pct}%. Nothing is saved until you press Save. Continue?`)) return;
    const copied = copyLadder(source.ladder, plan.room_types, pct, roundTo).map(r => ({ ...r, key: newKey() }));
    setRows(copied);
    setWorked({});
    setSaved(`Copied from ${source.label} ${pct >= 0 ? '+' : ''}${pct}%. Check the prices, then press Save.`);
  }

  async function save() {
    setError(''); setSaved('');
    const used = rows.filter(r => r.up_to.trim() || r.prices.some(p => p.trim()));
    if (!used.length) { setError('Type at least one tier'); return; }
    if (used.some(r => Number.isNaN(parsePct(r.increase)))) { setError("An increase isn't a number"); return; }
    const tiers = used.map(r => Number(r.up_to));
    const increases = used.map((r, i) => (i === 0 ? null : parsePct(r.increase)));
    const prices = {};
    for (const [ci, rt] of plan.room_types.entries()) {
      const list = used.map(r => parsePrice(r.prices[ci]));
      if (list.some(v => Number.isNaN(v))) { setError(`${rt.name}: a price isn't a number`); return; }
      prices[rt.id] = list;
    }
    setBusy(true);
    try {
      const r = await api.put(`/api/channel-manager/ladders/${planId}`, { season_id: seasonId || null, tiers, increases, prices });
      await load({ season: seasonId, plan: planId });
      setSaved(`Saved ${scopeName}: ${r.data.tiers} tiers for ${r.data.room_types} room type${r.data.room_types === 1 ? '' : 's'}. The OTAs get the new prices within about 20 seconds.`);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save');
    } finally { setBusy(false); }
  }

  async function removeLadder() {
    const after = season ? 'Its nights go back to the All year ladder.' : 'The OTAs get the normal price (room rate + meal plan) again.';
    if (!window.confirm(`Remove the ${scopeName} prices for ${plan.rate_plan_name}? ${after}`)) return;
    try {
      await api.delete(`/api/channel-manager/ladders/${planId}`, { params: season ? { season_id: season.id } : {} });
      await load({ season: seasonId, plan: planId });
      setSaved(`${scopeName} prices removed. ${after}`);
    } catch (e) { setError(e.response?.data?.error || 'Could not remove'); }
  }

  async function saveSeason(body) {
    setError(''); setSaved(''); setBusy(true);
    try {
      if (seasonForm === 'new') {
        const r = await api.post('/api/channel-manager/ladders/seasons', body);
        setSeasonForm(null);
        await load({ season: r.data.id, plan: planId });
        setSaved(`${r.data.name} added.${body.copy_all_year ? ' It starts as a copy of the All year ladders, so change the prices now.' : ' Its nights use the All year ladder until you save prices here.'}`);
      } else {
        const r = await api.put(`/api/channel-manager/ladders/seasons/${season.id}`, body);
        setSeasonForm(null);
        await load({ season: season.id, plan: planId });
        setSaved(`${r.data.name} saved. The OTAs get the change within about 20 seconds.`);
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save the season');
    } finally { setBusy(false); }
  }

  async function deleteSeason() {
    if (!window.confirm(`Delete ${season.name} and all its prices? Its nights go back to the All year ladder.`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/channel-manager/ladders/seasons/${season.id}`);
      setSeasonForm(null);
      await load({ season: ALL_YEAR, plan: planId });
      setSaved(`${season.name} deleted. Its nights are back on the All year ladder.`);
    } catch (e) { setError(e.response?.data?.error || 'Could not delete the season'); } finally { setBusy(false); }
  }

  const tiersTyped = rows.map(r => Number(r.up_to)).filter(n => n > 0);
  const top = tiersTyped.length ? Math.max(...tiersTyped) : 0;
  // Fixed OTA prices on this meal plan that this ladder would lose to.
  const fixedHere = fixed.filter(p => p.rate_plan_id === planId && p.linked && (!season || (p.date_from <= season.date_to && p.date_to >= season.date_from)));

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 1040, width: '100%' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 12px', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Season</span>
                <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="seg seg-wrap">
                    <button type="button" className={!seasonId ? 'active' : ''} onClick={() => pick(ALL_YEAR, planId)}>All year</button>
                    {seasonTabs.map(s => (
                      <button key={s.id} type="button" className={s.id === seasonId ? 'active' : ''} onClick={() => pick(s.id, planId)}>
                        {s.name}{s.ended ? ' (ended)' : ''}{data.plans.some(p => p.season_ladders[s.id]) ? ' ✓' : ''}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSeasonForm('new'); setError(''); setSaved(''); }}>+ New season</button>
                  {endedCount > 0 && (
                    <button type="button" style={{ background: 'none', border: 0, padding: 0, color: 'var(--green-dark)', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }} onClick={() => setShowEnded(v => !v)}>
                      {showEnded ? 'Hide ended' : `Show ended (${endedCount})`}
                    </button>
                  )}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Dates</span>
                <div style={{ fontSize: 13 }}>
                  {season
                    ? <>{longDate(season.date_from)} – {longDate(season.date_to)} (last night) · <button type="button" className="btn-link" style={{ background: 'none', border: 0, padding: 0, color: 'var(--green-dark)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }} onClick={() => { setSeasonForm('edit'); setError(''); setSaved(''); }}>Edit dates</button></>
                    : <span style={{ color: 'var(--text-muted)' }}>Every night, except nights inside a season</span>}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Meal plan</span>
                <div className="seg seg-wrap" style={{ justifySelf: 'start' }}>
                  {data.plans.map(p => (
                    <button key={p.rate_plan_id} type="button" className={p.rate_plan_id === planId ? 'active' : ''} onClick={() => pick(seasonId, p.rate_plan_id)}>
                      {p.rate_plan_name}{ladderIn(p, seasonId) ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {seasonForm && (
                <SeasonForm key={seasonForm + seasonId} season={seasonForm === 'edit' ? season : null} today={data.today} busy={busy}
                  onSave={saveSeason} onDelete={deleteSeason} onCancel={() => setSeasonForm(null)} />
              )}

              <div style={{ fontSize: 14, fontWeight: 600, padding: '8px 12px', background: 'var(--surface-2, #F3EEE8)', borderRadius: 8, marginBottom: 8 }}>
                You are editing: {scopeName} · {plan.rate_plan_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                {ladder
                  ? <>Ladder in use · saved {new Date(ladder.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}{ladder.updated_by_name ? ` · ${ladder.updated_by_name}` : ''}</>
                  : season
                    ? <>No {season.name} prices for this meal plan yet. Its nights use the All year ladder.</>
                    : <>No ladder yet — the OTAs get the normal price (room rate + meal plan) for this meal plan.</>}
              </div>

              {fixedHere.length > 0 && (
                <div className="alert alert-warn">
                  <div>
                    <div>{fixedHere.length} fixed OTA price{fixedHere.length === 1 ? '' : 's'} for {plan.rate_plan_name} {fixedHere.length === 1 ? 'wins' : 'win'} over this ladder on {fixedHere.length === 1 ? 'its nights' : 'their nights'}. Remove them in 📌 Fixed OTA prices if the ladder should apply:</div>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                      {fixedHere.slice(0, 8).map(p => <li key={p.id}>{p.room_type_name}: {longDate(p.date_from)} – {longDate(p.date_to)}, Rp {fmtPrice(p.price)}</li>)}
                      {fixedHere.length > 8 && <li>and {fixedHere.length - 8} more</li>}
                    </ul>
                  </div>
                </div>
              )}

              {copySources.length > 0 && (
                <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>Copy from</span>
                  <select className="form-select" style={{ width: 'auto', maxWidth: '100%' }} value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
                    <option value="">Choose a ladder…</option>
                    {copySources.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span>+</span>
                  <input className="form-input" inputMode="decimal" aria-label="Percent to add" style={{ width: 70, textAlign: 'right' }} value={copyPct} onChange={e => setCopyPct(e.target.value)} />
                  <span>%</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>Copy into the grid</button>
                </div>
              )}

              <div className="table-wrap">
                <table className="table" style={{ minWidth: 230 + cols * 140 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Sold up to</th>
                      <th style={{ width: 90 }}>Increase</th>
                      {plan.room_types.map(rt => <th key={rt.id} style={{ textAlign: 'right' }}>{rt.name}</th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={r.key}>
                        <td>
                          <input className="form-input" inputMode="numeric" value={r.up_to} placeholder="e.g. 16"
                            onChange={e => setCell(ri, 0, e.target.value.replace(/\D/g, ''))} onPaste={e => onPaste(e, ri, 0)} style={{ width: 80 }} />
                        </td>
                        <td>
                          {ri === 0
                            ? <span style={{ color: 'var(--text-muted)', paddingLeft: 8 }}>–</span>
                            : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input className="form-input" inputMode="decimal" aria-label={`Increase for row ${ri + 1}`} value={r.increase} placeholder="5"
                                  onChange={e => setIncrease(ri, e.target.value)} style={{ width: 58, textAlign: 'right', borderColor: Number.isNaN(parsePct(r.increase)) ? 'var(--danger, #dc2626)' : undefined }} />%
                              </span>}
                        </td>
                        {r.prices.map((p, pi) => {
                          const bad = Number.isNaN(parsePrice(p));
                          return (
                            <td key={pi}>
                              <input className="form-input" inputMode="decimal" aria-label={`${plan.room_types[pi].name}, row ${ri + 1}`} value={p} onChange={e => setCell(ri, pi + 1, e.target.value)}
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
                <span style={{ fontSize: 13, marginLeft: 8 }}>Round to</span>
                <select className="form-select" aria-label="Round to" style={{ width: 'auto' }} value={roundTo} onChange={e => setRoundTo(Number(e.target.value))}>
                  <option value={1000}>1.000</option>
                  <option value={10000}>10.000</option>
                  <option value={0}>No rounding</option>
                </select>
                <button className="btn btn-secondary btn-sm" onClick={workOut}>Work out prices</button>
                {ladder && <button className="btn btn-sm btn-danger" onClick={removeLadder}>{season ? `Remove ${season.name} prices` : 'Remove ladder'}</button>}
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Save ${scopeName} · ${plan.rate_plan_name}`}</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                <b>Work out prices</b>: type the first row and a % per row; each % builds on the row above. You can still change any price afterwards.
                Tip: copy the block from Excel ("sold up to" column + prices, in the same room-type order as here) and paste it into the first "Sold up to" box — it fills the grid.
                A room type whose column is left empty {season ? 'uses its All year ladder' : 'keeps the normal price'}. The hotel has {data.hotel_rooms} rooms
                {top > 0 && top < data.hotel_rooms ? ` — rooms sold past ${top} use the last tier` : ''}.
                A fixed OTA price (📌 Fixed OTA prices) wins over the ladder on its nights. Each send is listed in Settings → Channel Manager → Last sends with its tier.
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
