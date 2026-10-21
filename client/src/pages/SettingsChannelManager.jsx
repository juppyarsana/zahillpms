// Settings → Channel Manager (owner, `channel_manager` module). Stage 1:
// link this hotel to its Channex property, then each room type and meal plan
// to a Channex room type / rate plan. Stage 2: the "Sending to Channex"
// card (free rooms + prices, services/channelSync.js). Stage 3: the "Bookings from
// the OTAs" card (services/channelBookings.js). Stage 4: the go-live checklist and
// Compare with Channex (services/channelHealth.js). Server: routes/channelManager.js.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const MEAL_LABEL = {
  room_only: 'room only', breakfast: 'breakfast', half_board: 'half board',
  full_board: 'full board', all_inclusive: 'all inclusive', none: '—',
};

function errText(err) { return err.response?.data?.error || err.message || 'Something went wrong'; }

export default function SettingsChannelManager() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);       // key of the action running
  const [error, setError] = useState(null);
  const [pickProperty, setPickProperty] = useState('');
  const [pick, setPick] = useState({});         // roomTypeId or roomTypeId:planId → external id

  const load = () => api.get('/api/channel-manager/setup')
    .then(r => { setData(r.data); setError(null); })
    .catch(err => setError(errText(err)))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  // The send status changes by itself (the server sends within seconds of a change).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      api.get('/api/channel-manager/sync').then(r => setData(d => (d ? { ...d, sync: r.data.sync } : d))).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  const run = async (key, fn) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (err) { setError(errText(err)); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="page-wrap"><div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div></div>;

  const linkedTypes = data?.room_types.filter(r => r.link).length || 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Channel Manager</div>
          <div className="page-subtitle">
            Link this hotel's rooms to the channel manager, which sends them to the OTAs (Agoda, Booking.com, Traveloka…) · Owner only
          </div>
        </div>
        {data && (
          <span className={`badge ${data.environment === 'staging' ? 'badge-yellow' : 'badge-green'}`}>
            {data.environment === 'staging' ? 'Channel manager — test system' : 'Channel manager live'}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}

      {data && !data.configured && (
        <div className="alert alert-warn"><div>The channel manager is not set up on this server yet (the API key is missing). Ask the platform team.</div></div>
      )}

      {data?.configured && data.channex_error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          <div>The channel manager could not be reached: {data.channex_error}</div>
        </div>
      )}

      {data?.configured && (
        <>
          <div className="alert alert-info" style={{ marginBottom: 12 }}>
            <div>
              Once a room type and its meal plans are linked, the PMS keeps the channel manager up to date by itself: free rooms and the nightly
              price for the next {data.sync_days || 365} nights, sent within about half a minute of any booking, room or price change.
              The channel manager passes them only to the OTAs connected there. OTA bookings come back into the PMS by themselves (card 4).
            </div>
          </div>

          <Checklist reloadKey={data} />

          {/* ── 1. The Channex property ───────────────────────────── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>1. Channel manager property</div>
            {data.property ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{data.property.title || 'Unknown property'} {data.property.currency && <span className="badge badge-gray">{data.property.currency}</span>}</div>
                  {data.property.found === false && <div style={{ color: 'var(--danger-text)', fontSize: 13 }}>This property is no longer in the channel manager account.</div>}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>ID {data.property.external_id}</div>
                </div>
                <button className="btn btn-secondary btn-sm" disabled={!!busy || linkedTypes > 0}
                  title={linkedTypes > 0 ? 'Unlink every room type first' : ''}
                  onClick={() => window.confirm('Unlink this channel manager property?') && run('prop-off', () => api.delete('/api/channel-manager/property'))}>
                  Unlink
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="form-input" style={{ flex: '1 1 260px', maxWidth: 380 }} value={pickProperty} onChange={e => setPickProperty(e.target.value)}>
                  <option value="">Choose the hotel in the channel manager…</option>
                  {data.channex_properties.map(p => (
                    <option key={p.id} value={p.id}>{p.title}{p.currency ? ` (${p.currency})` : ''}</option>
                  ))}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!pickProperty || !!busy}
                  onClick={() => run('prop', () => api.put('/api/channel-manager/property', { external_id: pickProperty }))}>
                  {busy === 'prop' ? 'Linking…' : 'Link'}
                </button>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>or</span>
                <button className="btn btn-secondary btn-sm" disabled={!!busy}
                  onClick={() => window.confirm('Create a new property in the channel manager with this hotel\'s name?') && run('prop-new', () => api.put('/api/channel-manager/property', { create: true }))}>
                  {busy === 'prop-new' ? 'Creating…' : 'Create in the channel manager'}
                </button>
              </div>
            )}
          </div>

          {/* ── 2. Room types and meal plans ──────────────────────── */}
          {data.property && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 4 }}>2. Room types &amp; meal plans</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Each room type is one channel manager room type with the same number of rooms; each meal plan of it is one channel manager rate plan,
                priced per room for the room type's maximum guests. The PMS is in charge: linking sets the room count and guests in the channel manager.
              </div>

              {data.room_types.length === 0 && <div style={{ color: 'var(--text-muted)' }}>No room types yet — add them under Units.</div>}

              {data.room_types.map(rt => {
                const freeTypes = data.channex_room_types.filter(c => !c.linked);
                const cxPlansOfType = rt.link ? data.channex_rate_plans.filter(p => p.room_type_id === rt.link.external_id && !p.linked) : [];
                return (
                  <div key={rt.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 180 }}>
                        <div style={{ fontWeight: 600 }}>{rt.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rt.rooms} room{rt.rooms === 1 ? '' : 's'} · up to {rt.max_guests} guests</div>
                      </div>

                      {rt.link ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 13 }}>
                            <span className="badge badge-green">Linked</span>{' '}
                            Channel manager: <b>{rt.link.title || '?'}</b>
                            {rt.link.count_of_rooms != null && <span style={{ color: 'var(--text-muted)' }}> · {rt.link.count_of_rooms} rooms · {rt.link.occ_adults} guests</span>}
                            {rt.link.found === false && <div style={{ color: 'var(--danger-text)' }}>No longer in the channel manager</div>}
                            {rt.link.differs && <div style={{ color: 'var(--warning-text)' }}>Differs from the PMS ({rt.rooms} rooms · {rt.max_guests} guests)</div>}
                          </div>
                          {rt.link.differs && (
                            <button className="btn btn-primary btn-sm" disabled={!!busy}
                              onClick={() => run('ref-' + rt.id, () => api.post(`/api/channel-manager/room-types/${rt.id}/refresh`))}>
                              {busy === 'ref-' + rt.id ? 'Updating…' : 'Update in the channel manager'}
                            </button>
                          )}
                          <button className="btn btn-secondary btn-sm" disabled={!!busy}
                            onClick={() => window.confirm(`Unlink ${rt.name} and its meal plans? Nothing is deleted in the channel manager.`) && run('off-' + rt.id, () => api.delete(`/api/channel-manager/room-types/${rt.id}`))}>
                            Unlink
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <select className="form-input" style={{ width: 220 }} value={pick[rt.id] || ''} onChange={e => setPick(p => ({ ...p, [rt.id]: e.target.value }))}>
                            <option value="">Channel manager room type…</option>
                            {freeTypes.map(c => <option key={c.id} value={c.id}>{c.title} ({c.count_of_rooms} rooms)</option>)}
                          </select>
                          <button className="btn btn-primary btn-sm" disabled={!pick[rt.id] || !!busy}
                            onClick={() => run('rt-' + rt.id, () => api.put(`/api/channel-manager/room-types/${rt.id}`, { external_id: pick[rt.id] }))}>
                            Link
                          </button>
                          <button className="btn btn-secondary btn-sm" disabled={!!busy || rt.rooms < 1}
                            onClick={() => run('rtn-' + rt.id, () => api.put(`/api/channel-manager/room-types/${rt.id}`, { create: true }))}>
                            {busy === 'rtn-' + rt.id ? 'Creating…' : 'Create in the channel manager'}
                          </button>
                        </div>
                      )}
                    </div>

                    {rt.link && rt.rate_plans.length > 0 && (
                      <div style={{ marginTop: 8, marginLeft: 16, borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
                        {rt.rate_plans.map(p => {
                          const key = `${rt.id}:${p.id}`;
                          return (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0' }}>
                              <div style={{ fontSize: 13 }}>
                                <b>{p.code}</b> {p.name}
                                <span style={{ color: 'var(--text-muted)' }}> · {MEAL_LABEL[p.meal_type] || p.meal_type}</span>
                                {!p.is_active && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Inactive</span>}
                              </div>
                              {p.link ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
                                  <span><span className="badge badge-green">Linked</span> {p.link.title || '?'}</span>
                                  {p.link.found === false && <span style={{ color: 'var(--danger-text)' }}>No longer in the channel manager</span>}
                                  <button className="btn btn-secondary btn-sm" disabled={!!busy}
                                    onClick={() => window.confirm(`Unlink ${p.name} for ${rt.name}?`) && run('rpoff-' + key, () => api.delete(`/api/channel-manager/room-types/${rt.id}/rate-plans/${p.id}`))}>
                                    Unlink
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {cxPlansOfType.length > 0 && (
                                    <>
                                      <select className="form-input" style={{ width: 200 }} value={pick[key] || ''} onChange={e => setPick(x => ({ ...x, [key]: e.target.value }))}>
                                        <option value="">Channel manager rate plan…</option>
                                        {cxPlansOfType.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                                      </select>
                                      <button className="btn btn-primary btn-sm" disabled={!pick[key] || !!busy}
                                        onClick={() => run('rp-' + key, () => api.put(`/api/channel-manager/room-types/${rt.id}/rate-plans/${p.id}`, { external_id: pick[key] }))}>
                                        Link
                                      </button>
                                    </>
                                  )}
                                  <button className="btn btn-secondary btn-sm" disabled={!!busy}
                                    onClick={() => run('rpn-' + key, () => api.put(`/api/channel-manager/room-types/${rt.id}/rate-plans/${p.id}`, { create: true }))}>
                                    {busy === 'rpn-' + key ? 'Creating…' : 'Create in the channel manager'}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 3. Sending free rooms and prices ──────────────────── */}
          {data.property && linkedTypes > 0 && (
            <SyncCard sync={data.sync} days={data.sync_days} busy={busy}
              onSend={() => run('sync', () => api.post('/api/channel-manager/sync'))} />
          )}

          {/* ── 4. Bookings coming in ─────────────────────────────── */}
          {data.property && linkedTypes > 0 && <BookingsCard />}
        </>
      )}
    </div>
  );
}

function when(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const at = d.toLocaleString('en-GB', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return mins < 1 ? `just now (${at})` : mins < 60 ? `${mins} min ago (${at})` : at;
}

const MODE = { change: 'Changes', full: 'Nightly full send', manual: 'Send everything now' };

// The last 20 sends with their Channex task IDs (migration 124) — Channex's
// certification asks for a task ID from each test.
function SendLog({ log }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  if (!log.length) return null;
  const ids = e => [...(e.task_ids?.availability || []).map(id => ['Rooms', id]), ...(e.task_ids?.restrictions || []).map(id => ['Prices', id])];
  const copy = async (k, text) => { try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(null), 1500); } catch { /* no clipboard */ } };
  return (
    <div style={{ marginTop: 14 }}>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} Last sends ({log.length}) — with task IDs</button>
      {open && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table" style={{ minWidth: 640, fontSize: 12 }}>
            <thead><tr><th>When</th><th>What</th><th>task IDs</th></tr></thead>
            <tbody>
              {log.map((e, k) => (
                <tr key={k}>
                  <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{when(e.at)}<div style={{ color: 'var(--text-muted)' }}>{MODE[e.mode] || e.mode}</div></td>
                  <td style={{ verticalAlign: 'top' }}>
                    {!e.ok ? <span style={{ color: 'var(--danger-text)' }}>Failed: {e.error}</span>
                      : e.mode !== 'change' ? `Everything: ${e.availability_ranges} room · ${e.rate_ranges} price updates (${e.nights} values)`
                      : <>{(e.items || []).map((t, n) => <div key={n}>{t}</div>)}{e.items_more > 0 && <div style={{ color: 'var(--text-muted)' }}>+ {e.items_more} more</div>}</>}
                    {e.warnings > 0 && <div style={{ color: 'var(--warning-text)' }}>{e.warnings} value{e.warnings === 1 ? '' : 's'} not taken by the channel manager</div>}
                  </td>
                  <td style={{ verticalAlign: 'top' }}>
                    {ids(e).map(([kind, id]) => (
                      <div key={id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-muted)', width: 44 }}>{kind}</span>
                        <code style={{ wordBreak: 'break-all' }}>{id}</code>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '0 6px' }} onClick={() => copy(id, id)}>{copied === id ? '✓' : 'Copy'}</button>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SyncCard({ sync, days, busy, onSend }) {
  const last = sync?.last_sent || null;
  const [cmp, setCmp] = useState(null);
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpErr, setCmpErr] = useState(null);
  const compare = async () => {
    setCmpBusy(true); setCmpErr(null);
    try { setCmp((await api.get('/api/channel-manager/compare', { params: { days: 30 } })).data); }
    catch (e) { setCmpErr(errText(e)); } finally { setCmpBusy(false); }
  };
  const failing = sync?.last_error && (!sync.last_ok_at || new Date(sync.last_error_at) > new Date(sync.last_ok_at));
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="card-title" style={{ margin: 0 }}>3. Sending to the channel manager</div>
        {failing ? <span className="badge badge-red">Not sending — retrying</span>
          : sync?.waiting || sync?.running ? <span className="badge badge-yellow">Sending changes…</span>
          : sync?.last_ok_at ? <span className="badge badge-green">Up to date</span>
          : <span className="badge badge-gray">Nothing sent yet</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" disabled={cmpBusy} onClick={compare}>{cmpBusy ? 'Comparing…' : 'Compare with the channel manager'}</button>
          <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={onSend}>
            {busy === 'sync' ? 'Sending…' : 'Send everything now'}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
        Free rooms per room type and the price per meal plan (normal rate incl. pricing periods + meal plan for the room type's
        maximum guests, service &amp; tax included) for the next {days || 500} nights. Changes go within about half a minute — only what changed; everything is
        sent again every night at 04:10 (Send everything now: at most once an hour).
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 13 }}>
        <div><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Last sent</div>{when(sync?.last_ok_at)}</div>
        <div><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Last full send</div>{when(sync?.last_full_at)}</div>
        {last && (
          <div><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Last send</div>
            {last.nights_changed ? `${last.nights_changed} nights changed (${last.availability_ranges} room · ${last.rate_ranges} price updates)` : 'nothing had changed'}
          </div>
        )}
      </div>
      {failing && (
        <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>
          <div>The channel manager refused or could not be reached ({when(sync.last_error_at)}) — the PMS tries again after 1, 2, 4… up to 15 minutes: {sync.last_error}</div>
        </div>
      )}
      {cmpErr && <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}><div>{cmpErr}</div></div>}
      {cmp && (
        <div className={`alert ${cmp.different ? 'alert-warn' : 'alert-success'}`} style={{ marginTop: 12, marginBottom: 0 }}>
          <div style={{ width: '100%' }}>
            {cmp.different
              ? <><b>{cmp.different} of {cmp.checked} values differ</b> in the next {cmp.days} nights — usually a change still on its way (wait half a minute and compare again) or a value changed by hand in the channel manager. <i>Send everything now</i> puts the channel manager back to the PMS's figures.</>
              : <><b>The channel manager holds exactly what the PMS sends</b> — {cmp.checked} values over the next {cmp.days} nights.</>}
            {cmp.differences.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table" style={{ fontSize: 12, minWidth: 420 }}>
                  <thead><tr><th>Night</th><th>Room type / plan</th><th>What</th><th style={{ textAlign: 'right' }}>PMS</th><th style={{ textAlign: 'right' }}>Channel manager</th></tr></thead>
                  <tbody>
                    {cmp.differences.slice(0, 20).map((d, i) => (
                      <tr key={i}>
                        <td>{dayOf(d.night)}</td><td>{d.name}</td><td>{d.kind}</td>
                        <td style={{ textAlign: 'right' }}>{d.kind === 'price' ? fmtRp(d.pms) : d.pms}</td>
                        <td style={{ textAlign: 'right' }}>{d.channex == null ? '—' : d.kind === 'price' ? fmtRp(d.channex) : d.channex}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {last?.warnings?.length > 0 && (
        <div className="alert alert-warn" style={{ marginTop: 12, marginBottom: 0 }}>
          <div>The channel manager did not take some values: {last.warnings.map(w => JSON.stringify(w)).join(' · ').slice(0, 400)}</div>
        </div>
      )}
      <SendLog log={sync?.send_log || []} />
    </div>
  );
}


const RESULT = {
  applied:   { label: 'Saved',        cls: 'badge-green' },
  attention: { label: 'Needs you',    cls: 'badge-yellow' },
  ignored:   { label: 'Nothing to do', cls: 'badge-gray' },
  error:     { label: 'Not saved — retrying', cls: 'badge-red' },
};
const KIND = { new: 'New', modified: 'Changed', cancelled: 'Cancelled' };
const dayOf = v => v ? new Date(v + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

function RevisionRow({ r, onHandled, busy }) {
  const meta = RESULT[r.result] || RESULT.ignored;
  const open = ['attention', 'error'].includes(r.result) && !r.handled_at;
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: open ? 'var(--warning-bg)' : 'var(--cream)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <b>{KIND[r.revision_status] || r.revision_status} · {r.ota_name}</b>
          <span style={{ color: 'var(--text-muted)' }}>{r.ota_code}</span>
          <span className={`badge ${meta.cls}`}>{r.handled_at ? 'Handled' : meta.label}</span>
        </div>
        <div style={{ fontSize: 13, marginTop: 2 }}>
          {r.guest_name || 'Guest'}{r.arrival ? ` · ${dayOf(r.arrival)} – ${dayOf(r.departure)}` : ''}
          <span style={{ color: 'var(--text-muted)' }}> · {when(r.received_at)}</span>
        </div>
        {r.message && <div style={{ fontSize: 12, color: open ? 'var(--warning-text)' : 'var(--text-muted)', marginTop: 4 }}>{r.message}</div>}
        {r.handled_at && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Handled by {r.handled_by_name || 'staff'} · {when(r.handled_at)}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(r.booking_ids || []).slice(0, 4).map((id, i) => (
          <Link key={id} to={`/reservations/${id}`} className="btn btn-secondary btn-sm">Open{(r.booking_ids.length > 1) ? ` ${i + 1}` : ''} →</Link>
        ))}
        {open && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onHandled(r)}>
            {r.result === 'error' ? 'Entered by hand' : 'Done — handled'}
          </button>
        )}
      </div>
    </div>
  );
}

function BookingsCard() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = () => api.get('/api/channel-manager/bookings').then(r => { setD(r.data); setErr(null); }).catch(e => setErr(errText(e)));
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => clearInterval(id);
  }, []);
  const pull = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post('/api/channel-manager/bookings/pull'); setD(r.data); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const handled = async (r) => {
    const what = r.result === 'error' ? 'You entered this booking by hand (or it is not needed)? It is then confirmed to the channel manager and taken off this list.'
      : 'You have dealt with this by hand? It is taken off this list.';
    if (!window.confirm(what)) return;
    setBusy(true);
    try { await api.post(`/api/channel-manager/revisions/${r.id}/handled`); await load(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const webhookOn = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/api/channel-manager/webhook'); await load(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const recent = (d?.recent || []).filter(r => !(d.open || []).some(o => o.id === r.id));
  const wh = d?.webhook;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="card-title" style={{ margin: 0 }}>4. Bookings from the OTAs</div>
        {d?.open?.length ? <span className="badge badge-yellow">{d.open.length} need{d.open.length === 1 ? 's' : ''} you</span> : null}
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={pull}>{busy ? 'Checking…' : 'Check now'}</button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
        The PMS reads new, changed and cancelled OTA bookings from the channel manager and puts them in: the first free room of the type,
        the guest, the OTA as the source, the price, who collects the money. Front desk sees each one as a pop-up and on
        🌐 OTA bookings (also Reservations → ⚠ To check and the Telegram New booking alert). What the PMS can't do safely — no free room,
        a guest already checked in — waits there and here for you. Last read: {when(d?.last_pull_at)}.
      </div>
      {wh && (
        <div style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          {wh.on
            ? <span>⚡ <b>Instant:</b> The channel manager tells the PMS the moment a booking comes in{wh.last_webhook_at ? ` — last call ${when(wh.last_webhook_at)}` : ''}. A back-up read every 15 minutes catches anything missed.</span>
            : !wh.public_url
              ? <span style={{ color: 'var(--text-muted)' }}>⏱ Read every minute. (Instant needs the server's public address — not on a test laptop.)</span>
              : <><span style={{ color: 'var(--warning-text)' }}>⏱ Read every minute — The channel manager is not set to call the PMS{wh.error ? `: ${wh.error}` : ''}.</span>
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={webhookOn}>Turn on instant</button></>}
        </div>
      )}
      {(err || d?.last_pull_error) && <div className="alert alert-error"><div>{err || `The channel manager could not be read: ${d.last_pull_error}`}</div></div>}
      {d?.open?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {d.open.map(r => <RevisionRow key={r.id} r={r} onHandled={handled} busy={busy} />)}
        </div>
      )}
      {recent.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', margin: '4px 0 6px' }}>Latest</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.slice(0, 15).map(r => <RevisionRow key={r.id} r={r} onHandled={handled} busy={busy} />)}
          </div>
        </>
      )}
      {d && !d.open?.length && !recent.length && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No OTA bookings have come in yet.</div>}
    </div>
  );
}


function fmtRp(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }

const STATE = {
  ok:   { icon: '✓', color: 'var(--success-text)' },
  warn: { icon: '!', color: 'var(--warning-text)' },
  fail: { icon: '✕', color: 'var(--danger-text)' },
  info: { icon: 'i', color: 'var(--info-text)' },
};

function Checklist({ reloadKey }) {
  const [c, setC] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    api.get('/api/channel-manager/checklist').then(r => {
      setC(r.data);
      setOpen(o => (o === null ? !r.data.ready : o));
    }).catch(() => {});
  }, [reloadKey]);
  if (!c) return null;
  const fails = c.items.filter(i => i.state === 'fail').length;
  const warns = c.items.filter(i => i.state === 'warn').length;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <div className="card-title" style={{ margin: 0 }}>Go-live checklist</div>
        {fails ? <span className="badge badge-red">{fails} to fix</span>
          : <span className="badge badge-green">Ready</span>}
        {warns > 0 && <span className="badge badge-yellow">{warns} to look at</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{open ? 'Hide ▴' : 'Show ▾'}</span>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {c.items.map(i => (
            <div key={i.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: '#fff', background: STATE[i.state].color }}>{STATE[i.state].icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{i.title}</div>
                {i.detail && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 1 }}>{i.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
