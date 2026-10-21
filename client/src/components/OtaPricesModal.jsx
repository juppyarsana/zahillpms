import { useEffect, useState } from 'react';
import api from '../services/api';
import { propertyToday } from '../lib/propertyTime';

// OTA prices for one meal plan (migration 125): a price per room per night,
// service & tax included, sent to the OTAs exactly as typed for those nights —
// replacing the worked-out price (room rate + meal plan). PMS prices (New
// Booking, the folio) are not changed. All lines saved together reach the
// channel manager in one send.
const fmt = n => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const fmtDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const emptyLine = () => ({ key: Math.random().toString(36).slice(2), room_type_id: '', rate_plan_id: '', date_from: '', date_to: '', price: '' });

export default function OtaPricesModal({ onClose }) {
  const [data, setData] = useState(null);
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData((await api.get('/api/channel-manager/prices')).data); }
    catch (e) { setError(e.response?.data?.error || 'Could not load the OTA prices'); }
  }
  useEffect(() => { load(); }, []);

  const options = data?.options || [];
  const types = [...new Map(options.map(o => [o.room_type_id, o.room_type_name])).entries()];
  const plansOf = typeId => options.filter(o => o.room_type_id === typeId);

  function setLine(key, patch) {
    setLines(ls => ls.map(l => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      if (patch.room_type_id !== undefined && !plansOf(patch.room_type_id).some(p => p.rate_plan_id === next.rate_plan_id)) {
        const plans = plansOf(patch.room_type_id);
        next.rate_plan_id = plans.length === 1 ? plans[0].rate_plan_id : '';
      }
      if (patch.date_from && (!next.date_to || next.date_to < patch.date_from)) next.date_to = patch.date_from;
      return next;
    }));
  }

  async function save() {
    setError(''); setSaved('');
    const filled = lines.filter(l => l.room_type_id || l.price || l.date_from);
    if (!filled.length) { setError('Add at least one line'); return; }
    setBusy(true);
    try {
      const r = await api.post('/api/channel-manager/prices', {
        lines: filled.map(({ room_type_id, rate_plan_id, date_from, date_to, price }) => ({ room_type_id, rate_plan_id, date_from, date_to, price })),
      });
      setSaved(`${r.data.saved} price${r.data.saved === 1 ? '' : 's'} saved — they go to the OTAs together within about 20 seconds.`);
      setLines([emptyLine()]);
      load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save');
    } finally { setBusy(false); }
  }

  async function remove(p) {
    if (!window.confirm(`Remove the OTA price for ${p.room_type_name} · ${p.rate_plan_name}, ${fmtDate(p.date_from)} – ${fmtDate(p.date_to)}? Those nights go back to the normal price (or an earlier OTA price).`)) return;
    try { await api.delete('/api/channel-manager/prices', { data: { ids: [p.id] } }); load(); }
    catch (e) { setError(e.response?.data?.error || 'Could not remove'); }
  }

  const today = propertyToday();

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 860, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">🌐 OTA prices</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            A price for one meal plan on the OTAs, per room per night, <b>service &amp; tax included</b> — sent exactly as typed.
            It replaces the normal price (room rate + meal plan) on the OTAs for those nights only; prices in the PMS
            (New Booking, the bill) don't change. Every line saved together goes to the OTAs in one send.
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {saved && <div className="alert alert-success">{saved}</div>}

          {data && !options.length && (
            <div className="alert alert-warn">
              <div>No room type and meal plan is linked to the channel manager yet — link them in Settings → Channel Manager first.</div>
            </div>
          )}

          {options.length > 0 && (
            <>
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 720 }}>
                  <thead>
                    <tr><th>Room type</th><th>Meal plan</th><th>First night</th><th>Last night</th><th>Price on the OTAs</th><th></th></tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.key}>
                        <td>
                          <select className="form-input" value={l.room_type_id} onChange={e => setLine(l.key, { room_type_id: e.target.value })}>
                            <option value="">Pick…</option>
                            {types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="form-input" value={l.rate_plan_id} disabled={!l.room_type_id} onChange={e => setLine(l.key, { rate_plan_id: e.target.value })}>
                            <option value="">Pick…</option>
                            {plansOf(l.room_type_id).map(p => <option key={p.rate_plan_id} value={p.rate_plan_id}>{p.rate_plan_name}</option>)}
                          </select>
                        </td>
                        <td><input type="date" className="form-input" min={today} value={l.date_from} onChange={e => setLine(l.key, { date_from: e.target.value })} /></td>
                        <td><input type="date" className="form-input" min={l.date_from || today} value={l.date_to} onChange={e => setLine(l.key, { date_to: e.target.value })} /></td>
                        <td><input type="number" className="form-input" min="0" step="0.01" placeholder="e.g. 1250000" value={l.price} onChange={e => setLine(l.key, { price: e.target.value })} style={{ width: 140 }} /></td>
                        <td>
                          {lines.length > 1 && (
                            <button className="btn btn-sm btn-secondary" title="Remove this line" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setLines(ls => [...ls, emptyLine()])}>+ Add line</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={save}>
                  {busy ? 'Saving…' : `Save ${lines.length} price${lines.length === 1 ? '' : 's'} — send together`}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                The first and last night are both included; a price can run up to 5 years ahead — the OTAs see about 16 months, and each later night is sent as it comes into view. Where two OTA prices cover the same night, the one saved last wins.
                Each send and its Channex task IDs are listed in Settings → Channel Manager → Last sends.
              </div>
            </>
          )}

          <div style={{ fontWeight: 700, marginTop: 20, marginBottom: 8 }}>OTA prices set</div>
          {!data ? <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
            : !data.prices.length ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>None — the OTAs get the normal price (room rate + meal plan).</div>
            : (
              <div className="table-wrap">
                <table className="table" style={{ minWidth: 640 }}>
                  <thead><tr><th>Room type · meal plan</th><th>Nights</th><th style={{ textAlign: 'right' }}>Price</th><th>Saved</th><th></th></tr></thead>
                  <tbody>
                    {data.prices.map(p => (
                      <tr key={p.id} style={{ opacity: p.linked ? 1 : 0.5 }}>
                        <td>{p.room_type_name} · {p.rate_plan_name}{!p.linked && <span className="badge badge-gray" style={{ marginLeft: 6 }}>not linked — not sent</span>}</td>
                        <td>{p.date_from === p.date_to ? fmtDate(p.date_from) : `${fmtDate(p.date_from)} – ${fmtDate(p.date_to)}`}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(p.price)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(p.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}
                          {p.created_by_name ? ` · ${p.created_by_name}` : ''}
                        </td>
                        <td><button className="btn btn-sm btn-danger" onClick={() => remove(p)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
