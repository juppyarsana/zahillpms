import { useState, useEffect } from 'react';
import api from '../services/api';

// Who runs a trip (Vendor payouts, migration 140). Operators take turns, so
// front desk picks the vendor for each trip; the activity's Catalog vendors
// are only where the list starts. Amounts are shown / typed only by the owner
// or the `vendors` permission — for anyone else a vendor in the Catalog gets
// its Catalog price and another one is "to set" by accounting.

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');

export function useVendorChoices() {
  const [data, setData] = useState({ vendors: [], can_prices: false, loaded: false });
  useEffect(() => {
    api.get('/api/activities/vendor-choices')
      .then(r => setData({ ...r.data, loaded: true }))
      .catch(() => setData(d => ({ ...d, loaded: true })));
  }, []);
  return data;
}

// What a Catalog vendor costs for this many participants (null = typed each trip).
export function catalogAmount(activity, supplierId, pax) {
  const v = (activity?.vendors || []).find(x => x.supplier_id === supplierId);
  if (!v || v.price_mode === 'typed' || v.price == null) return null;
  return parseFloat(v.price) * (v.price_mode === 'per_person' ? (pax || 1) : 1);
}

// rows: [{ supplier_id, amount: '' | number, locked? }]
export function TripVendorsEditor({ rows, onChange, choices, activity, pax }) {
  const { vendors, can_prices } = choices;
  const set = (i, patch) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const free = vendors.filter(v => !rows.some(r => r.supplier_id === v.id));
  const name = id => vendors.find(v => v.id === id)?.name || rows.find(r => r.supplier_id === id)?.name || 'Vendor';
  return (
    <div>
      {rows.length === 0 && (
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>
          No vendor on this trip. If an outside operator runs it, add them so accounting can pay them.
        </div>
      )}
      {rows.map((r, i) => {
        const cat = catalogAmount(activity, r.supplier_id, pax);
        return (
          <div key={r.supplier_id + i} className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            {r.locked ? (
              <div style={{ flex: 1, fontSize: 13 }}>{name(r.supplier_id)} <span className="text-muted" style={{ fontSize: 11 }}>· paid — can't be changed here</span></div>
            ) : (
              <select className="form-select" style={{ flex: 1 }} value={r.supplier_id}
                onChange={e => set(i, { supplier_id: e.target.value, amount: '' })}>
                <option value={r.supplier_id}>{name(r.supplier_id)}</option>
                {free.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
            {can_prices && (
              <input className="form-input" type="number" min="0" style={{ width: 140 }}
                value={r.amount} disabled={r.locked}
                placeholder={cat != null ? Math.round(cat).toString() : 'to set'}
                title="What the hotel owes this vendor for the trip. Empty = Catalog price, or to set later"
                onChange={e => set(i, { amount: e.target.value })} />
            )}
            {!r.locked && <button type="button" className="btn btn-icon btn-sm" title="Take this vendor off" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>}
          </div>
        );
      })}
      {free.length > 0 ? (
        <select className="form-select" value="" style={{ maxWidth: 260 }}
          onChange={e => e.target.value && onChange([...rows, { supplier_id: e.target.value, amount: '' }])}>
          <option value="">+ Add vendor…</option>
          {free.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      ) : vendors.length === 0 && choices.loaded ? (
        <div className="text-muted" style={{ fontSize: 12 }}>No tour / transport vendors yet — add them on Finance → Vendor payouts.</div>
      ) : null}
      {!can_prices && rows.length > 0 && (
        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Accounting sets what the vendor gets.</div>
      )}
    </div>
  );
}

// Payload for the server: amount only when typed.
export const vendorPayload = rows => rows.map(r => ({
  supplier_id: r.supplier_id, ...(r.amount !== '' && r.amount != null ? { amount: r.amount } : {}),
}));

// The Vendors window for a trip already booked (Activities page, the
// reservation's Activities tab).
export default function TripVendorsModal({ activityBooking, onClose, onDone }) {
  const choices = useVendorChoices();
  const [rows, setRows] = useState(null);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ab = activityBooking;

  useEffect(() => {
    api.get(`/api/activities/bookings/${ab.id}/vendors`).then(r => setRows(r.data.map(l => ({
      supplier_id: l.supplier_id, name: l.supplier_name, amount: l.amount ?? '', locked: l.paid_any,
    })))).catch(e => setError(e?.response?.data?.error || 'Could not load the vendors'));
    api.get('/api/activities').then(r => setActivity(r.data.find(a => a.id === ab.activity_id) || null)).catch(() => {});
  }, [ab.id, ab.activity_id]);

  async function save() {
    setError(''); setSaving(true);
    try {
      await api.put(`/api/activities/bookings/${ab.id}/vendors`, { vendors: vendorPayload(rows) });
      onDone?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Vendors — {ab.activity_name || 'Activity'}</div>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
            {String(ab.scheduled_date || '').slice(0, 10)} · {ab.num_participants} pax · {fmtIDR(ab.total_amount)}
            {(ab.room_guest_name || ab.guest_name) ? ` · ${ab.room_guest_name || ab.guest_name}` : ''}
          </div>
          {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
          {rows == null ? <div className="text-muted">Loading…</div> : (
            <TripVendorsEditor rows={rows} onChange={setRows} choices={choices} activity={activity} pax={ab.num_participants} />
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || rows == null} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
