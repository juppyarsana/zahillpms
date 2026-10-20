// Settings → Channel Manager (owner, `channel_manager` module). Stage 1:
// link this hotel to its Channex property, then each room type and meal plan
// to a Channex room type / rate plan. Server: routes/channelManager.js.

import { useEffect, useState } from 'react';
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

  const run = async (key, fn) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (err) { setError(errText(err)); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="page-wrap"><div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div></div>;

  const linkedTypes = data?.room_types.filter(r => r.link).length || 0;

  return (
    <div className="page-wrap" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Channel Manager</div>
          <div className="page-subtitle">
            Link this hotel's rooms to Channex, which sends them to the OTAs (Agoda, Booking.com, Traveloka…) · Owner only
          </div>
        </div>
        {data && (
          <span className={`badge ${data.environment === 'staging' ? 'badge-yellow' : 'badge-green'}`}>
            {data.environment === 'staging' ? 'Channex test system (staging)' : 'Channex live'}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}

      {data && !data.configured && (
        <div className="alert alert-warn"><div>Channex is not set up on this server yet (the Channex API key is missing). Ask the platform team.</div></div>
      )}

      {data?.configured && data.channex_error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          <div>Channex could not be reached: {data.channex_error}</div>
        </div>
      )}

      {data?.configured && (
        <>
          <div className="alert alert-info" style={{ marginBottom: 12 }}>
            <div>
              <b>Step 1 of the connection.</b> Linking only tells Channex which rooms the hotel has — nothing is sent to the OTAs yet.
              Free rooms, prices and bookings come in the next steps.
            </div>
          </div>

          {/* ── 1. The Channex property ───────────────────────────── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>1. Channex property</div>
            {data.property ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{data.property.title || 'Unknown property'} {data.property.currency && <span className="badge badge-gray">{data.property.currency}</span>}</div>
                  {data.property.found === false && <div style={{ color: 'var(--danger-text)', fontSize: 13 }}>This property is no longer in the Channex account.</div>}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Channex ID {data.property.external_id}</div>
                </div>
                <button className="btn btn-secondary btn-sm" disabled={!!busy || linkedTypes > 0}
                  title={linkedTypes > 0 ? 'Unlink every room type first' : ''}
                  onClick={() => window.confirm('Unlink this Channex property?') && run('prop-off', () => api.delete('/api/channel-manager/property'))}>
                  Unlink
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="form-input" style={{ flex: '1 1 260px', maxWidth: 380 }} value={pickProperty} onChange={e => setPickProperty(e.target.value)}>
                  <option value="">Choose the hotel in Channex…</option>
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
                  onClick={() => window.confirm('Create a new property in Channex with this hotel\'s name?') && run('prop-new', () => api.put('/api/channel-manager/property', { create: true }))}>
                  {busy === 'prop-new' ? 'Creating…' : 'Create in Channex'}
                </button>
              </div>
            )}
          </div>

          {/* ── 2. Room types and meal plans ──────────────────────── */}
          {data.property && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 4 }}>2. Room types &amp; meal plans</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Each room type is one Channex room type with the same number of rooms; each meal plan of it is one Channex rate plan,
                priced per room for the room type's maximum guests. The PMS is in charge: linking sets the room count and guests in Channex.
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
                            Channex: <b>{rt.link.title || '?'}</b>
                            {rt.link.count_of_rooms != null && <span style={{ color: 'var(--text-muted)' }}> · {rt.link.count_of_rooms} rooms · {rt.link.occ_adults} guests</span>}
                            {rt.link.found === false && <div style={{ color: 'var(--danger-text)' }}>No longer in Channex</div>}
                            {rt.link.differs && <div style={{ color: 'var(--warning-text)' }}>Differs from the PMS ({rt.rooms} rooms · {rt.max_guests} guests)</div>}
                          </div>
                          {rt.link.differs && (
                            <button className="btn btn-primary btn-sm" disabled={!!busy}
                              onClick={() => run('ref-' + rt.id, () => api.post(`/api/channel-manager/room-types/${rt.id}/refresh`))}>
                              {busy === 'ref-' + rt.id ? 'Updating…' : 'Update in Channex'}
                            </button>
                          )}
                          <button className="btn btn-secondary btn-sm" disabled={!!busy}
                            onClick={() => window.confirm(`Unlink ${rt.name} and its meal plans? Nothing is deleted in Channex.`) && run('off-' + rt.id, () => api.delete(`/api/channel-manager/room-types/${rt.id}`))}>
                            Unlink
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <select className="form-input" style={{ width: 220 }} value={pick[rt.id] || ''} onChange={e => setPick(p => ({ ...p, [rt.id]: e.target.value }))}>
                            <option value="">Channex room type…</option>
                            {freeTypes.map(c => <option key={c.id} value={c.id}>{c.title} ({c.count_of_rooms} rooms)</option>)}
                          </select>
                          <button className="btn btn-primary btn-sm" disabled={!pick[rt.id] || !!busy}
                            onClick={() => run('rt-' + rt.id, () => api.put(`/api/channel-manager/room-types/${rt.id}`, { external_id: pick[rt.id] }))}>
                            Link
                          </button>
                          <button className="btn btn-secondary btn-sm" disabled={!!busy || rt.rooms < 1}
                            onClick={() => run('rtn-' + rt.id, () => api.put(`/api/channel-manager/room-types/${rt.id}`, { create: true }))}>
                            {busy === 'rtn-' + rt.id ? 'Creating…' : 'Create in Channex'}
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
                                  {p.link.found === false && <span style={{ color: 'var(--danger-text)' }}>No longer in Channex</span>}
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
                                        <option value="">Channex rate plan…</option>
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
                                    {busy === 'rpn-' + key ? 'Creating…' : 'Create in Channex'}
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
        </>
      )}
    </div>
  );
}
