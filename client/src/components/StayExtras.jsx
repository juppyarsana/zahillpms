import { useState, useEffect } from 'react';
import api from '../services/api';
import { defaultNights } from './StayNightsPicker';
import PerNightLine, { defaultBreakfasts, withUnits } from './PerNightLine';
import { fmtYmd } from '../lib/propertyTime';

// The reservation's door to Sales items (migration 074): "Extras for this
// stay" lists the per-night extras on the booking (extra bed on 28 Sep…) and
// "+ Add item" charges any Sales item to the room — through the same
// POST /api/sales as the Sales till, so it shows in Sales History, on the
// folio and in the reports exactly as if sold from Sales.

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const FNB = ['food', 'drinks'];   // the restaurant's, not sold from the front desk

export function AddStayItemModal({ booking, onClose, onDone, onBookActivity }) {
  const [products, setProducts] = useState([]);
  const [pick, setPick] = useState(null);          // product
  const [qty, setQty] = useState(1);
  // Per-night items: { quantity, price_per_night, breakfasts, breakfasts_touched, nights }
  const [line, setLine] = useState(null);
  // "Other charge" and other open-price items (migration 077): typed each time.
  const [openDesc, setOpenDesc] = useState('');
  const [openPrice, setOpenPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/products').then(r => setProducts(r.data.filter(p => p.is_available && !FNB.includes(p.category))));
  }, []);

  function choose(p) {
    setPick(p); setQty(1); setError('');
    setOpenDesc(''); setOpenPrice(p.open_price && parseFloat(p.price) > 0 ? String(parseFloat(p.price)) : '');
    setLine(p.per_night ? {
      quantity: 1, nights: defaultNights(booking), price_per_night: String(parseFloat(p.price)),
      breakfasts: defaultBreakfasts(p, 1), breakfasts_touched: false,
    } : null);
  }
  function changeQty(v) {
    setQty(v);
    if (pick?.per_night) setLine(l => withUnits(l, pick, parseInt(v) || 0));
  }

  const nights = line?.nights || [];
  const units = pick ? (parseInt(qty) || 0) * (pick.per_night ? nights.length : 1) : 0;
  const price = pick?.per_night ? (parseFloat(line.price_per_night) || 0)
    : pick?.open_price ? (parseFloat(openPrice) || 0) : parseFloat(pick?.price || 0);
  const total = pick ? price * units : 0;
  const valid = pick && parseInt(qty) >= 1 && (!pick.open_price || (openDesc.trim() && parseFloat(openPrice) > 0)) && (!pick.per_night || (nights.length > 0
    && line.price_per_night !== '' && parseFloat(line.price_per_night) >= 0 && line.breakfasts !== '' && line.breakfasts >= 0));

  async function save() {
    setSaving(true); setError('');
    try {
      await api.post('/api/sales', {
        booking_id: booking.id, payment_method: 'room_charge',
        items: [{ product_id: pick.id, quantity: parseInt(qty),
          ...(pick.per_night ? { nights, price_per_night: parseFloat(line.price_per_night), breakfasts: line.breakfasts } : {}),
          ...(pick.open_price ? { description: openDesc.trim(), unit_price: parseFloat(openPrice) } : {}) }],
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add the item');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 560, width: '100%' }}>
        <div className="modal-header">
          <div className="modal-title">Add to this stay</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!pick ? (
            <>
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>Charged to the room — the same items as Sales.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {products.map(p => (
                  <button key={p.id} className="btn btn-secondary" style={{ flexDirection: 'column', height: 70, fontSize: 12 }} onClick={() => choose(p)}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span style={{ color: 'var(--green)', fontSize: 11 }}>{p.open_price ? 'type the price' : `${fmtIDR(p.price)}${p.per_night ? ' / night' : ''}`}</span>
                  </button>
                ))}
                {products.length === 0 && <div className="text-muted">No items — add them in Sales → Items.</div>}
              </div>
              {onBookActivity && (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
                  Booking a tour or activity?{' '}
                  <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px' }} onClick={onBookActivity}>Book activity →</button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex-between" style={{ marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{pick.name}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {pick.open_price ? 'Type what it is and the price' : <>{fmtIDR(pick.price)}{pick.per_night ? ' per night' : ''}</>}
                    {parseFloat(pick.meal_price) > 0 && pick.meal_pax > 0 && ` · incl. ${plural(pick.meal_pax, 'breakfast')}`}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => setPick(null)}>← Other item</button>
              </div>
              {pick.open_price && (
                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">What is it? *</label>
                    <input className="form-input" value={openDesc} maxLength={200} autoFocus
                      onChange={e => setOpenDesc(e.target.value)} placeholder="e.g. Broken glass" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Price (IDR, before tax) *</label>
                    <input className="form-input" type="number" min="0" value={openPrice} onChange={e => setOpenPrice(e.target.value)} />
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{pick.per_night ? 'How many (per night)' : 'Quantity'}</label>
                <input className="form-input" type="number" min="1" value={qty} onChange={e => changeQty(e.target.value)} style={{ width: 100 }} />
              </div>
              {pick.per_night && (
                <div className="form-group">
                  <PerNightLine booking={booking} product={pick} line={line} onChange={setLine} />
                </div>
              )}
              <div className="flex-between" style={{ fontWeight: 700, fontSize: 15, marginTop: 8 }}>
                <span>{pick.per_night ? `${qty || 0} × ${plural(nights.length, 'night')}` : `${qty || 0} ×`} · charged to the room</span>
                <span>{fmtIDR(total)}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                {pick.per_night
                  ? 'Goes on the folio night by night with the room (nights already passed are posted now). Shows in Sales → History too.'
                  : 'Goes on the folio now. Shows in Sales → History too.'}
              </div>
              {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {pick && <button className="btn btn-primary" disabled={!valid || saving} onClick={save}>{saving ? 'Adding…' : `Add ${fmtIDR(total)}`}</button>}
        </div>
      </div>
    </div>
  );
}

// "Extras for this stay" card on the booking's Details tab.
export default function StayExtrasCard({ booking, openAdd, onChanged, onBookActivity }) {
  const [addons, setAddons] = useState([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);   // addon row
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/api/bookings/${booking.id}/addons`).then(r => setAddons(r.data)).catch(() => {});
  useEffect(() => { load(); }, [booking.id, booking.check_in_date, booking.check_out_date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (openAdd) setAdding(true); }, [openAdd]);

  const canAdd = !['cancelled', 'no_show'].includes(booking.status);
  const active = addons.filter(a => a.status === 'active');
  const removedCount = addons.length - active.length;
  // Group by item: "Extra Bed — 28 Sep, 29 Sep"
  const byItem = active.reduce((m, a) => { (m[a.description] ||= []).push(a); return m; }, {});

  async function confirmRemove() {
    setBusy(true);
    try {
      await api.delete(`/api/bookings/${booking.id}/addons/${removing.id}`, { data: { reason } });
      setRemoving(null); setReason('');
      load(); onChanged?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not remove it');
    } finally {
      setBusy(false);
    }
  }

  if (!canAdd && active.length === 0) return null;
  return (
    <div className="card mt-3" id="stay-extras">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Extras for this stay</div>
        {canAdd && <button className="btn btn-sm btn-secondary" onClick={() => setAdding(true)}>+ Add item</button>}
      </div>
      {active.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13 }}>
          Nothing yet. Extra bed and other Sales items can be added here, charged to the room.
        </div>
      ) : Object.entries(byItem).map(([item, rows]) => (
        <div key={item} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            {item}
            {rows.some(a => a.breakfasts > 0) && <span className="text-muted" style={{ fontWeight: 400 }}> · incl. breakfast (bf = breakfasts per night)</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {rows.map(a => (
              <span key={a.id} className={`badge ${a.in_stay ? (a.posted ? 'badge-green' : 'badge-blue') : 'badge-gray'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 12 }}
                title={!a.in_stay ? 'Outside the stay dates — not charged' : a.posted ? 'On the folio' : 'Posted with the room at night audit'}>
                {fmtYmd(a.service_date, { weekday: 'short', day: 'numeric', month: 'short' })}
                {a.quantity > 1 && ` × ${a.quantity}`} · {fmtIDR(a.unit_price * a.quantity)}
                {a.breakfasts > 0 && ` · ${a.breakfasts} bf`}
                {!a.in_stay && ' · not charged'}
                <button onClick={() => setRemoving(a)} title="Remove this night"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: 'inherit' }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      ))}
      {active.length > 0 && (
        <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
          <span className="badge badge-green" style={{ fontSize: 10 }}>green</span> on the folio ·{' '}
          <span className="badge badge-blue" style={{ fontSize: 10 }}>blue</span> posted with the room at the night audit · ✕ removes a night
        </div>
      )}
      {removedCount > 0 && <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>{plural(removedCount, 'night')} removed earlier — see Edit History.</div>}

      {adding && (
        <AddStayItemModal booking={booking} onClose={() => setAdding(false)} onBookActivity={onBookActivity}
          onDone={() => { setAdding(false); load(); onChanged?.(); }} />
      )}
      {removing && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div className="modal-title">Remove {removing.description} — {fmtYmd(removing.service_date, { weekday: 'short', day: 'numeric', month: 'short' })}?</div>
              <button className="btn btn-icon" onClick={() => setRemoving(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13 }}>
                {removing.posted
                  ? 'It is already on the folio — the charge will be voided (kept, marked voided).'
                  : 'It is not on the folio yet, so it simply won\'t be charged.'}
                {' '}The sale in Sales History is reduced to match, and this is noted in Edit History.
              </p>
              <div className="form-group">
                <label className="form-label">Reason (optional)</label>
                <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. guest didn't need it" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRemoving(null)}>Keep it</button>
              <button className="btn btn-danger" disabled={busy} onClick={confirmRemove}>{busy ? 'Removing…' : 'Remove this night'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
