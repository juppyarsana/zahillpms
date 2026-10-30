import { useEffect, useState } from 'react';
import api from '../services/api';

// Change price for one night (OTA dashboard): on the left why this date is slow
// and what we suggest, on the right the price per room type per meal plan. What
// is saved is an ordinary OTA price for that night (migration 125).
const fmt = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
const digits = v => Number(String(v).replace(/\D/g, '')) || 0;

function Step({ n, title, last, children }) {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      <div style={{ flex: 'none', width: 26, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
          background: last ? 'var(--green-dark)' : '#F4EFE8', color: last ? '#fff' : 'var(--green-dark)' }}>{n}</div>
        {!last && <div style={{ flex: 1, width: 2, background: '#E8DCCB' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 20 }}>
        <div style={{ margin: '3px 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--green-dark)' }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export default function OtaChangePriceModal({ date, onClose, onSaved }) {
  const [night, setNight] = useState(null);
  const [plan, setPlan] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/api/ota-dashboard/night/${date}`)
      .then(r => { if (live) { setNight(r.data); setPlan(r.data.plans[0]?.id || null); } })
      .catch(e => { if (live) setError(e.response?.data?.error || 'Could not load this date'); });
    return () => { live = false; };
  }, [date]);

  const key = (p, l) => `${p}|${l.room_type_id}`;
  const valueOf = (p, l) => edits[key(p, l)] ?? fmt(l.now);
  const typed = (p, l) => digits(valueOf(p, l));
  const changed = (p, l) => typed(p, l) !== Math.round(l.now);
  const belowMin = (p, l) => changed(p, l) && l.min != null && typed(p, l) < l.min;

  const plans = night?.plans || [];
  const current = plans.find(p => p.id === plan);
  const counts = plans.map(p => ({ name: p.name, n: p.lines.filter(l => changed(p.id, l)).length })).filter(c => c.n);
  const total = counts.reduce((s, c) => s + c.n, 0);
  const blocked = plans.some(p => p.lines.some(l => belowMin(p.id, l) || (changed(p.id, l) && typed(p.id, l) <= 0)));

  const setValue = (p, l, v) => setEdits(e => ({ ...e, [key(p, l)]: v }));
  const useAll = () => setEdits(e => {
    const next = { ...e };
    for (const l of current.lines) next[key(current.id, l)] = fmt(l.suggested);
    return next;
  });

  async function save() {
    setBusy(true); setError('');
    try {
      const lines = plans.flatMap(p => p.lines.filter(l => changed(p.id, l))
        .map(l => ({ room_type_id: l.room_type_id, rate_plan_id: p.id, price: typed(p.id, l) })));
      await api.put(`/api/ota-dashboard/night/${date}`, { lines });
      onSaved(night.label);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" style={{ alignItems: 'flex-start', overflowY: 'auto' }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ota-price-title" style={{ maxWidth: 1040, maxHeight: 'none' }}>
        <div className="modal-header">
          <div>
            <div id="ota-price-title" className="modal-title">Change price{night ? `: ${night.label}` : ''}</div>
            {night && <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{night.pct}% full · {night.free} rooms left · {night.days === 0 ? 'tonight' : `${night.days} day${night.days === 1 ? '' : 's'} to go`}</div>}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body">
          {!night && !error && <div className="text-muted">Loading…</div>}
          {error && <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div>}
          {night && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                <Step n={1} title="Where it stands">
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                    {night.long_label} is <b>{night.pct}% full</b>{night.days === 0 ? ' tonight' : ` with ${night.days} day${night.days === 1 ? '' : 's'} to go`}.{' '}
                    {night.needed > 0
                      ? <>It needs <b>{night.needed} more room{night.needed === 1 ? '' : 's'}</b> to reach its {night.target}% target.</>
                      : <>That is at or above its {night.target}% target.</>}
                  </p>
                  <div style={{ position: 'relative', height: 8, background: '#EEE7DE', borderRadius: 99, marginTop: 10 }}>
                    <div style={{ height: 8, borderRadius: 99, background: 'var(--green-dark)', width: `${Math.min(100, night.pct)}%` }} />
                    <div title="Occupancy target" style={{ position: 'absolute', top: -3, width: 2, height: 14, background: '#1A1A1A', left: `${night.target}%` }} />
                  </div>
                </Step>
                <Step n={2} title="How it compares">
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                    {night.same && <>Recent {night.same.weekday} reach <b>{night.same.pct}%</b>{night.same.average ? <> at an average of <b>Rp {fmt(night.same.average)}</b></> : null}. </>}
                    {night.pace}
                  </p>
                </Step>
                <Step n={3} title="What else matters">
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{night.context}</p>
                </Step>
                <Step n={4} title={night.slow ? 'So we suggest' : 'This date'} last>
                  <p style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 700, color: 'var(--green-dark)' }}>{night.headline || 'It is on track, and a manual price is still on'}</p>
                  {(night.notes.length > 0 || night.breakeven) && (
                    <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5 }}>
                      {night.notes.join(' ')}{night.notes.length > 0 && night.breakeven ? ' ' : ''}
                      {night.breakeven && <>To earn the same, every 10 rooms you'd have sold at today's price need to become <b>{night.breakeven}</b>.</>}
                    </p>
                  )}
                  {!night.slow && <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5 }}>Remove the manual price from the page if the ladder should take over again.</p>}
                </Step>
              </div>

              <div style={{ flex: '999 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="seg" role="group" aria-label="Meal plan">
                    {plans.map(p => <button key={p.id} type="button" className={p.id === plan ? 'active' : ''} onClick={() => setPlan(p.id)}>{p.name}</button>)}
                  </div>
                  {night.slow && <button type="button" className="btn btn-secondary btn-sm" onClick={useAll}>Use all suggested</button>}
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Room type</th><th style={{ textAlign: 'right' }}>Left</th><th style={{ textAlign: 'right' }}>Now</th>{night.slow && <th style={{ textAlign: 'right' }}>Suggested</th>}<th style={{ textAlign: 'right' }}>New price</th></tr></thead>
                    <tbody>
                      {current?.lines.map(l => {
                        const low = belowMin(current.id, l);
                        return (
                          <tr key={l.room_type_id}>
                            <td style={{ minWidth: 130 }}>
                              <label htmlFor={`price-${l.room_type_id}`}>{l.name}</label>
                              <div style={{ fontSize: 12, fontWeight: low ? 700 : 400, color: low ? '#B91C1C' : 'var(--text-muted)' }}>{l.min != null ? `Minimum ${fmt(l.min)}` : 'No minimum set'}</div>
                            </td>
                            <td style={{ textAlign: 'right' }}>{l.free}</td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(l.now)}{l.manual && <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E' }}>manual</div>}</td>
                            {night.slow && (
                              <td style={{ textAlign: 'right' }}>
                                <button type="button" aria-label={`Use suggested price for ${l.name}`} onClick={() => setValue(current.id, l, fmt(l.suggested))}
                                  style={{ minHeight: 36, padding: '0 8px', background: '#FBF6EE', color: '#92400E', border: '1px solid #E8DCCB', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                  {Math.round(l.suggested) === Math.round(l.now) ? 'Keep' : fmt(l.suggested)}
                                </button>
                              </td>
                            )}
                            <td style={{ textAlign: 'right' }}>
                              <input id={`price-${l.room_type_id}`} className="form-input" inputMode="numeric" value={valueOf(current.id, l)}
                                onChange={e => setValue(current.id, l, e.target.value)}
                                style={{ width: 112, textAlign: 'right', ...(low ? { borderColor: '#B91C1C', borderWidth: 2 } : {}) }} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ margin: 0, padding: '10px 12px', background: 'var(--warning-bg)', color: 'var(--warning-text)', borderRadius: 8, fontSize: 13, lineHeight: 1.4 }}>
                  This price stays until someone removes it, even if the date fills up. The ladder won't raise it.
                </p>
                {blocked && <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#B91C1C' }}>A price is below its minimum. Change it to send.</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {total > 0 && <span className="text-muted" style={{ fontSize: 13, marginRight: 'auto' }}>Will send: {counts.map(c => `${c.name} ${c.n}`).join(' · ')}</span>}
                  <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                  <button type="button" className="btn btn-primary" disabled={busy || blocked || !total} onClick={save}>{busy ? 'Sending…' : 'Save and send to OTAs'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
