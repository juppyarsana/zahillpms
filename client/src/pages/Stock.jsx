import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { COST_CATEGORIES } from '../lib/costLists';
import { useAuth } from '../context/AuthContext';
import { BIG_UNIT, fmtQty } from '../lib/units';
import ItemPicker from '../components/ItemPicker';

// Operations → Stock (migration 136): everything kept in stock — stock items
// and Sales items with Track stock — with Adjust (one item, a known event),
// Stock opname (every item counted on one day), Usage between two opnames and
// Stock value. Buying is on Purchasing.
//
// Two stocks, chosen at the top: Hotel stock (kept here) and Restaurant stock
// (kept and counted by the chef in the POS, read here through the hotel link:
// its items, each item's history and usage — used vs by recipe — from the
// POS's stock ledger). Stock value adds both up.
//
// Hotel stock is kept per store (migration 156): Main Store, Engineering,
// Housekeeping… The store picker (?store=) shows one store's quantities;
// "All stores" shows the total with where it is. Kitchen / Resto are the
// restaurant's (POS) stock.

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const signedIDR = n => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmtIDR(Math.abs(n))}`;
const qty = (q, unit) => (q == null ? '—' : `${+Number(q).toFixed(3)}${unit ? ' ' + unit : ''}`);
const fmtDay = d => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = s => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const UNITS = ['kg', 'g', 'l', 'ml', 'pcs'];

async function openPdf(url) {
  const r = await api.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
  if (!window.open(blobUrl, '_blank')) { const a = document.createElement('a'); a.href = blobUrl; a.download = 'stock-opname.pdf'; a.click(); }
}
async function download(url, filename) {
  const r = await api.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(r.data);
  const a = document.createElement('a'); a.href = blobUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

const TABS = {
  hotel: [
    { key: 'items', label: 'Stock items' },
    { key: 'opname', label: 'Stock opname' },
    { key: 'usage', label: 'Usage' },
    { key: 'value', label: 'Stock value' },
    { key: 'transfers', label: 'Transfers' },
  ],
  restaurant: [
    { key: 'items', label: 'Stock items' },
    { key: 'usage', label: 'Usage' },
    { key: 'value', label: 'Stock value' },
  ],
};

function useStores() {
  const [stores, setStores] = useState([]);
  const load = () => api.get('/api/stock/stores', { params: { inactive: 1 } }).then(r => setStores(r.data)).catch(() => setStores([]));
  useEffect(() => { load(); }, []);
  return [stores, load];
}
const pmsStores = stores => stores.filter(s => s.kind !== 'pos' && s.is_active);
const storeName = (stores, id) => stores.find(s => s.id === id)?.name || '';
// "Main Store 10 · Housekeeping 4" — only when it isn't all in Main Store.
function whereText(i, stores) {
  const per = Object.entries(i.stores || {}).filter(([, q]) => q);
  if (!per.length) return '';
  if (per.length === 1 && stores.find(s => s.id === per[0][0])?.kind === 'main') return '';
  return per.map(([id, q]) => `${storeName(stores, id) || 'Store'} ${+Number(q).toFixed(3)}`).join(' · ');
}

export default function Stock() {
  const { hasModule, user, can } = useAuth();
  // `store_transfers` without `stock`: only the Transfers tab (confirm what arrives).
  const full = can('stock');
  const [stores, reloadStores] = useStores();
  const [editStores, setEditStores] = useState(false);
  const withPos = hasModule('pos_integration');
  const [params, setParams] = useSearchParams();
  const stock = full && withPos && params.get('stock') === 'restaurant' ? 'restaurant' : 'hotel';
  const tabs = full ? TABS[stock] : TABS.hotel.filter(t => t.key === 'transfers');
  const tab = tabs.some(t => t.key === params.get('tab')) ? params.get('tab') : tabs[0].key;
  const [openTransfers, setOpenTransfers] = useState(0);
  useEffect(() => { api.get('/api/stock-transfers/count').then(r => setOpenTransfers(r.data.open)).catch(() => {}); }, [tab]);
  const go = (st, tb) => setParams(p => { const n = new URLSearchParams(p); n.set('stock', st); n.set('tab', tb); return n; }, { replace: true });
  const storeId = pmsStores(stores).some(s => s.id === params.get('store')) ? params.get('store') : '';
  const setStore = id => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('store', id); else n.delete('store'); return n; }, { replace: true });
  const showStores = full && stock === 'hotel' && tab !== 'usage' && pmsStores(stores).length > 1;
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Stock</div>
          <div className="page-subtitle">{stock === 'restaurant'
            ? 'The restaurant\'s stock — kept and counted by the chef in the POS, shown here'
            : 'What is in stock, what was used, and the stock opname — buying is on Purchasing'}</div>
        </div>
        <div className="flex gap-2">
          {user?.role === 'owner' && <button className="btn btn-secondary" onClick={() => setEditStores(true)}>Stores</button>}
          <Link className="btn btn-secondary" to="/guide/stock">📘 Guide</Link>
          {full && <Link className="btn btn-primary" to="/purchasing?tab=requests&new=1&low=1" title="Ask purchasing to buy — starts with the items that are low or out">🛒 Request to buy</Link>}
        </div>
      </div>
      {full && withPos && (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button type="button" className={stock === 'hotel' ? 'active' : ''} onClick={() => go('hotel', tab === 'usage' || tab === 'value' ? tab : 'items')}>Hotel stock</button>
          <button type="button" className={stock === 'restaurant' ? 'active' : ''} onClick={() => go('restaurant', tab === 'usage' || tab === 'value' ? tab : 'items')}>Restaurant stock</button>
        </div>
      )}
      <div className="tab-bar">
        {tabs.map(t => <button key={t.key} className={`tab-bar-item${tab === t.key ? ' active' : ''}`} onClick={() => go(stock, t.key)}>{t.label}
          {t.key === 'transfers' && openTransfers > 0 && <span className="tab-count">{openTransfers}</span>}</button>)}
      </div>
      {showStores && (
        <div className="seg" style={{ margin: '12px 0 0', flexWrap: 'wrap' }}>
          <button type="button" className={!storeId ? 'active' : ''} onClick={() => setStore('')}>All stores</button>
          {pmsStores(stores).map(s => <button key={s.id} type="button" className={storeId === s.id ? 'active' : ''} onClick={() => setStore(s.id)}>{s.name}</button>)}
        </div>
      )}
      {stock === 'hotel' && tab === 'items' && <ItemsTab stores={stores} storeId={storeId} />}
      {stock === 'hotel' && tab === 'opname' && <OpnameTab stores={stores} storeId={storeId} />}
      {stock === 'hotel' && tab === 'usage' && <UsageTab />}
      {stock === 'restaurant' && tab === 'items' && <RestaurantTab />}
      {stock === 'restaurant' && tab === 'usage' && <RestaurantUsageTab />}
      {tab === 'value' && <ValueTab withPos={withPos} stores={stores} />}
      {tab === 'transfers' && <TransfersTab stores={stores} storeId={storeId} canSend={full} onCount={setOpenTransfers} />}
      {editStores && <StoresModal stores={stores} onClose={() => setEditStores(false)} onChanged={reloadStores} />}
    </div>
  );
}

// ───────────────────────────── Stock items ─────────────────────────────

function stockBadge(i) {
  if (i.out) return <span className="badge badge-red">{qty(i.on_hand, i.unit)}</span>;
  if (i.low) return <span className="badge badge-amber">Low · {qty(i.on_hand, i.unit)}</span>;
  return <span>{qty(i.on_hand, i.unit)}</span>;
}

function ItemsTab({ stores, storeId }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('all');           // all | low
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState(null);       // {} new | item
  const [adjusting, setAdjusting] = useState(null);
  const [history, setHistory] = useState(null);
  const [toast, setToast] = useState('');

  const load = () => api.get('/api/stock/items', { params: { inactive: inactive ? 1 : undefined, store: storeId || undefined } }).then(r => setItems(r.data)).catch(() => setItems([]));
  useEffect(() => { load(); }, [inactive, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const store = stores.find(s => s.id === storeId);
  function flash(m) { setToast(m); setTimeout(() => setToast(''), 4000); }

  const q = search.trim().toLowerCase();
  // In one store (other than Main Store) show only what it holds.
  const inStore = i => !store || store.kind === 'main' || i.on_hand !== 0;
  const rows = items.filter(i => inStore(i) && (!q || i.name.toLowerCase().includes(q) || i.category_label.toLowerCase().includes(q)) && (show === 'all' || i.low || i.out));
  const lowCount = items.filter(i => i.is_active && (i.low || i.out)).length;
  const total = rows.reduce((t, i) => t + (i.value || 0), 0);

  return (
    <div>
      <div className="page-toolbar">
        <input className="form-input" style={{ maxWidth: 260 }} placeholder="Search item or category…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="seg">
          <button type="button" className={show === 'all' ? 'active' : ''} onClick={() => setShow('all')}>All</button>
          <button type="button" className={show === 'low' ? 'active' : ''} onClick={() => setShow('low')}>Low or out{lowCount ? ` (${lowCount})` : ''}</button>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} /> Show inactive</label>
        <div className="page-toolbar-end"><button className="btn btn-primary" onClick={() => setEditing({})}>+ Add stock item</button></div>
      </div>
      <p className="text-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        {store ? <>What <b>{store.name}</b> holds. </> : <>Every store together. </>}
        Stock items (used by the hotel) and Sales items with Track stock on (sold as they are). Stock goes up when bought on Purchasing
        (into Main Store unless another store is picked), down when sold, and with <b>Adjust</b> for waste, use or a correction. Click an item for its history.
      </p>
      {toast && <div className="alert alert-success"><div>{toast}</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 760 }}>
            <thead><tr><th>Item</th><th>Category</th><th style={{ textAlign: 'right' }}>On hand</th><th style={{ textAlign: 'right' }}>Average cost</th><th style={{ textAlign: 'right' }}>Value</th><th></th></tr></thead>
            <tbody>
              {rows.map(i => (
                <tr key={i.key} style={{ cursor: 'pointer', opacity: i.is_active ? 1 : 0.55 }} onClick={() => setHistory(i)}>
                  <td><div style={{ fontWeight: 600 }}>{i.name}</div><div className="text-muted" style={{ fontSize: 12 }}>{i.kind_label}{!i.is_active ? ' · inactive' : ''}</div></td>
                  <td>{i.category_label}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{stockBadge(i)}
                    {!storeId && whereText(i, stores) && <div className="text-muted" style={{ fontSize: 11 }}>{whereText(i, stores)}</div>}
                    {!storeId && i.in_transit > 0 && <div style={{ fontSize: 11, color: 'var(--warning, #b45309)' }}>{qty(i.in_transit)} on the way</div>}
                    {storeId && i.total_on_hand !== i.on_hand && <div className="text-muted" style={{ fontSize: 11 }}>{qty(i.total_on_hand)} in all stores</div>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{i.avg_cost != null ? `${fmtIDR(i.avg_cost)} / ${i.unit}` : <span className="text-muted">not known</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{i.value != null ? fmtIDR(i.value) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    {i.is_active && <button className="btn btn-sm btn-secondary" onClick={() => setAdjusting(i)}>Adjust</button>}{' '}
                    {i.kind === 'rm' && <button className="btn btn-sm btn-secondary" onClick={() => setEditing(i)}>Edit</button>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>{items.length ? 'Nothing matches' : 'Nothing kept in stock yet — add a stock item'}</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr><td colSpan={4} style={{ fontWeight: 600 }}>Value of these items</td><td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtIDR(total)}</td><td></td></tr></tfoot>}
          </table>
        </div>
      </div>
      {editing && <ItemModal item={editing.key ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); flash('Saved'); }} />}
      {adjusting && <AdjustModal item={adjusting} stores={stores} storeId={storeId} onClose={() => setAdjusting(null)}
        onDone={(r, name) => { setAdjusting(null); load(); flash(`${r.item.name}: ${qty(r.item.on_hand, r.item.unit)} left in ${name}`); }} />}
      {history && <HistoryModal item={history} store={store} onClose={() => setHistory(null)} onAdjust={() => { setAdjusting(history); setHistory(null); }} />}
    </div>
  );
}

function ItemModal({ item, onClose, onSaved }) {
  const [f, setF] = useState({ name: item?.name || '', unit: item?.unit || 'kg', category: item?.category || 'food', low_threshold: item?.low_threshold ?? '', is_active: item ? item.is_active : true });
  const [error, setError] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save() {
    setError('');
    try {
      if (item) await api.put(`/api/stock/items/${item.key}`, f);
      else await api.post('/api/stock/items', f);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'Could not save'); }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">{item ? `Edit ${item.name}` : 'Add stock item'}</div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" autoFocus value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Rice" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Counted in</label>
              <select className="form-select" value={f.unit} onChange={e => set('unit', e.target.value)}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Category</label>
              <select className="form-select" value={f.category} onChange={e => set('category', e.target.value)}>{COST_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label">Low stock below</label><input className="form-input" type="number" min="0" value={f.low_threshold} onChange={e => set('low_threshold', e.target.value)} placeholder="optional" /></div>
          {item && <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={f.is_active} onChange={e => set('is_active', e.target.checked)} /> In use (untick = no longer bought or counted)</label>}
          <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>The stock and its cost come from purchases, Adjust and the stock opname — not typed here.</div>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}

function AdjustModal({ item, stores, storeId, onClose, onDone }) {
  const choices = pmsStores(stores);
  const main = choices.find(s => s.kind === 'main');
  // Start on the store being looked at; on All stores, the one holding it (Main Store first).
  const [store, setStore] = useState(() => storeId
    || (item.stores?.[main?.id] ? main.id : Object.keys(item.stores || {}).find(id => choices.some(s => s.id === id)) || main?.id || ''));
  const inStore = Number(item.stores?.[store] || 0);
  const [reason, setReason] = useState('waste');
  const [direction, setDirection] = useState('down');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = Number(amount) || 0;
  const change = reason === 'correction' && direction === 'up' ? n : -n;
  async function save() {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/api/stock/items/${item.key}/adjust`, { reason, quantity: n, direction, note, store_id: store || undefined });
      onDone(r.data, storeName(stores, store) || 'stock');
    } catch (err) { setError(err.response?.data?.error || 'Could not save'); setBusy(false); }
  }
  const HINT = {
    waste: 'Spoiled, broken, past its date — thrown away.',
    used: 'Used without being sold — e.g. welcome drinks, a staff meal, a room amenity.',
    correction: 'The stock in the PMS was wrong (typed wrong, found more). For the regular count use the stock opname.',
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal-header"><div><div className="modal-title">Adjust · {item.name}</div><div className="text-muted" style={{ fontSize: 12 }}>{qty(inStore, item.unit)} in {storeName(stores, store) || 'stock'}</div></div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
          {choices.length > 1 && (
            <div className="form-group"><label className="form-label">Store</label>
              <select className="form-select" value={store} onChange={e => setStore(e.target.value)}>
                {choices.map(s => <option key={s.id} value={s.id}>{s.name}{item.stores?.[s.id] ? ` — ${qty(item.stores[s.id], item.unit)}` : ''}</option>)}
              </select></div>
          )}
          <div className="seg" style={{ marginBottom: 6 }}>
            {[['waste', 'Waste / spoiled'], ['used', 'Used (not sold)'], ['correction', 'Correction']].map(([k, l]) =>
              <button key={k} type="button" className={reason === k ? 'active' : ''} onClick={() => setReason(k)}>{l}</button>)}
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>{HINT[reason]}</div>
          {reason === 'correction' && (
            <div className="seg" style={{ marginBottom: 12 }}>
              <button type="button" className={direction === 'down' ? 'active' : ''} onClick={() => setDirection('down')}>Less than the PMS says (−)</button>
              <button type="button" className={direction === 'up' ? 'active' : ''} onClick={() => setDirection('up')}>More (+)</button>
            </div>
          )}
          <div className="form-group"><label className="form-label">How many ({item.unit})</label>
            <input className="form-input" type="number" min="0" step={item.kind === 'p' ? '1' : '0.001'} autoFocus value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">{reason === 'correction' ? 'Why (required)' : 'Note'}</label>
            <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder={reason === 'waste' ? 'e.g. cracked in delivery' : reason === 'used' ? 'e.g. welcome drinks, group arrival' : 'e.g. delivery typed as 10, was 12'} /></div>
          {n > 0 && <div style={{ fontSize: 14 }}>After: <b>{qty(inStore + change, item.unit)}</b> in {storeName(stores, store)}{item.avg_cost != null ? <span className="text-muted"> · {signedIDR(change * item.avg_cost)}</span> : ''}</div>}
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !(n > 0) || (reason === 'correction' && !note.trim())} onClick={save}>Save</button></div>
      </div>
    </div>
  );
}

function HistoryModal({ item, store, onClose, onAdjust }) {
  const [h, setH] = useState(null);
  useEffect(() => {
    api.get(`/api/stock/items/${item.key}/history`, { params: { store: store?.id || undefined } }).then(r => setH(r.data)).catch(() => setH({ lines: [] }));
  }, [item.key, store?.id]);
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 760, width: '100%' }}>
        <div className="modal-header"><div><div className="modal-title">{item.name}</div><div className="text-muted" style={{ fontSize: 12 }}>{item.kind_label} · {item.category_label} · {qty(item.on_hand, item.unit)} in {store ? store.name : 'stock'}{item.value != null ? ` · ${fmtIDR(item.value)}` : ''}</div></div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {!h ? <div className="text-muted">Loading…</div> : (
            <div className="table-wrap">
              <table style={{ fontSize: 13, minWidth: 600 }}>
                <thead><tr><th>When</th><th>What</th>{!store && <th>Store</th>}<th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>After</th><th>Note</th></tr></thead>
                <tbody>
                  {h.lines.map(l => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                      <td>{l.reason_label}{l.by_name ? <div className="text-muted" style={{ fontSize: 11 }}>{l.by_name}</div> : null}</td>
                      {!store && <td style={{ fontSize: 12 }}>{l.store_name || ''}</td>}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: l.change_qty < 0 ? 'var(--danger-text)' : 'var(--success-text)' }}>{l.change_qty > 0 ? '+' : ''}{qty(l.change_qty, item.unit)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{qty(l.after, item.unit)}</td>
                      <td className="text-muted" style={{ maxWidth: 220 }}>{l.note || ''}</td>
                    </tr>
                  ))}
                  {h.lines.length === 0 && <tr><td colSpan={6} className="text-muted" style={{ textAlign: 'center', padding: 16 }}>No movements yet</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-footer">{item.is_active && <button className="btn btn-secondary" onClick={onAdjust}>Adjust</button>}<button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ───────────────────────────── Stock opname ─────────────────────────────

function OpnameTab({ stores, storeId }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);       // the opname shown
  const [error, setError] = useState('');
  const choices = pmsStores(stores);
  const [pick, setPick] = useState('');         // the store to count, when looking at All stores
  const countStore = storeId || pick || choices.find(s => s.kind === 'main')?.id || '';
  const load = () => api.get('/api/stock/opnames').then(r => setList(r.data)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  // One stock opname per store at a time.
  const shownList = (list || []).filter(o => !storeId || o.store_id === storeId);
  const draft = (list || []).find(o => o.status === 'draft' && o.store_id === countStore);
  const otherDrafts = (list || []).filter(o => o.status === 'draft' && o.store_id !== countStore && (!storeId || o.store_id === storeId));

  async function start() {
    setError('');
    try { const r = await api.post('/api/stock/opnames', { store_id: countStore || undefined }); setOpen(r.data.opname); load(); }
    catch (err) { setError(err.response?.data?.error || 'Could not start'); }
  }
  const show = id => api.get(`/api/stock/opnames/${id}`).then(r => setOpen(r.data)).catch(() => setError('Could not open it'));

  if (open) return <OpnameSheet o={open} onBack={() => { setOpen(null); load(); }} onChanged={setOpen} />;
  return (
    <div>
      <div className="page-toolbar">
        <div className="text-muted" style={{ fontSize: 13, maxWidth: 640 }}>
          Count everything on the shelf of one store on one day — weekly or monthly. The difference against what the PMS expects is the stock that left without a record.
        </div>
        <div className="page-toolbar-end">
          {otherDrafts.map(o => <button key={o.id} className="btn btn-secondary" onClick={() => show(o.id)}>Continue {o.no_text} · {o.store_name}</button>)}
          {!storeId && choices.length > 1 && (
            <select className="form-select" style={{ width: 'auto' }} value={countStore} onChange={e => setPick(e.target.value)} aria-label="Store to count">
              {choices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {draft ? <button className="btn btn-primary" onClick={() => show(draft.id)}>Continue {draft.no_text}{choices.length > 1 ? ` · ${draft.store_name}` : ''}</button>
            : <button className="btn btn-primary" onClick={start}>+ Start stock opname{choices.length > 1 ? ` of ${storeName(stores, countStore)}` : ''}</button>}
        </div>
      </div>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 700 }}>
            <thead><tr><th>No.</th><th>Date</th><th>Store</th><th>Status</th><th style={{ textAlign: 'right' }}>Counted</th><th style={{ textAlign: 'right' }}>Value on hand</th><th style={{ textAlign: 'right' }}>Difference</th><th>By</th></tr></thead>
            <tbody>
              {shownList.map(o => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => show(o.id)}>
                  <td style={{ fontWeight: 600 }}>{o.no_text}</td>
                  <td>{fmtDay(o.count_date)}</td>
                  <td>{o.store_name}</td>
                  <td>{o.status === 'draft' ? <span className="badge badge-amber">Being counted</span> : <span className="badge badge-green">Finished</span>}</td>
                  <td style={{ textAlign: 'right' }}>{o.counted} of {o.items}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{o.status === 'finished' ? fmtIDR(o.counted_value) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: o.difference_value < 0 ? 'var(--danger-text)' : undefined }}>{o.status === 'finished' ? signedIDR(o.difference_value) : '—'}</td>
                  <td>{o.finished_by_name || o.created_by_name}</td>
                </tr>
              ))}
              {list && shownList.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No stock opname yet — start the first one</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function OpnameSheet({ o, onBack, onChanged }) {
  const draft = o.status === 'draft';
  const [counts, setCounts] = useState(() => Object.fromEntries(o.lines.map(l => [l.id, l.counted == null ? '' : String(+l.counted)])));
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const timer = useRef(null);

  // Saved by itself a moment after typing stops, so nothing is lost.
  useEffect(() => {
    if (!draft || !Object.keys(dirty).length) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 1200);
    return () => clearTimeout(timer.current);
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const ids = Object.keys(dirty);
    if (!ids.length) return true;
    setSaving(true); setError('');
    try {
      const r = await api.put(`/api/stock/opnames/${o.id}/counts`, { counts: ids.map(id => ({ line_id: id, counted: counts[id] })) });
      setDirty({}); onChanged(r.data.opname);
      setSaving(false);
      return true;
    } catch (err) { setError(err.response?.data?.error || 'Could not save'); setSaving(false); return false; }
  }
  async function finish() {
    if (!(await save())) return;
    try { const r = await api.post(`/api/stock/opnames/${o.id}/finish`); setConfirming(false); onChanged(r.data.opname); }
    catch (err) { setError(err.response?.data?.error || 'Could not finish'); setConfirming(false); }
  }
  async function cancel() {
    if (!window.confirm(`Cancel ${o.no_text}? The counts typed so far are dropped; the stock is not changed.`)) return;
    await api.post(`/api/stock/opnames/${o.id}/cancel`); onBack();
  }
  // Live difference while typing.
  const view = o.lines.map(l => {
    const c = counts[l.id];
    const counted = !draft ? l.counted : c === '' ? null : Number(c);
    const diff = counted == null || Number.isNaN(counted) ? null : Math.round((counted - l.expected) * 1000) / 1000;
    return { ...l, counted, diff, diffValue: diff != null && l.unit_cost != null ? diff * l.unit_cost : null };
  });
  const q = search.trim().toLowerCase();
  const shown = view.filter(l => !q || l.description.toLowerCase().includes(q) || l.category_label.toLowerCase().includes(q));
  const groups = [];
  for (const l of shown) { let g = groups.find(x => x.label === l.category_label); if (!g) groups.push(g = { label: l.category_label, lines: [] }); g.lines.push(l); }
  const counted = view.filter(l => l.counted != null);
  const diffTotal = counted.reduce((t, l) => t + (l.diffValue || 0), 0);

  return (
    <div>
      <div className="page-toolbar">
        <button className="btn btn-sm btn-secondary" onClick={onBack}>‹ All stock opnames</button>
        <div style={{ fontWeight: 700 }}>{o.no_text} · {o.store_name ? `${o.store_name} · ` : ''}{fmtDay(o.count_date)}</div>
        {draft ? <span className="badge badge-amber">Being counted</span> : <span className="badge badge-green">Finished {fmtDateTime(o.finished_at)} · {o.finished_by_name}</span>}
        <div className="page-toolbar-end">
          <button className="btn btn-sm btn-secondary" onClick={() => openPdf(`/api/stock/opnames/${o.id}/sheet`)}>{draft ? 'Print count sheet' : 'Print'}</button>
          {draft && <button className="btn btn-sm btn-secondary" onClick={cancel}>Cancel opname</button>}
          {draft && <button className="btn btn-sm btn-primary" onClick={() => setConfirming(true)}>Finish…</button>}
        </div>
      </div>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
        <div className="stat-card"><div className="stat-label">Counted</div><div className="stat-value">{counted.length} of {view.length}</div></div>
        <div className="stat-card"><div className="stat-label">Short / over</div><div className="stat-value">{counted.filter(l => l.diff < 0).length} / {counted.filter(l => l.diff > 0).length}</div></div>
        <div className="stat-card"><div className="stat-label">Difference</div><div className="stat-value" style={{ color: diffTotal < 0 ? 'var(--danger-text)' : undefined }}>{signedIDR(diffTotal)}</div></div>
      </div>
      {draft && <p className="text-muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
        Type what is on the shelf — it saves by itself{saving ? ' (saving…)' : Object.keys(dirty).length ? '' : ' ✓'}. Leave an item empty if it isn't counted: it stays as it is.
        Finish on the day you count, before more is used or sold.
      </p>}
      <input className="form-input" style={{ maxWidth: 260, marginBottom: 10 }} placeholder="Find an item…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 640 }}>
            <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>The PMS expects</th><th style={{ textAlign: 'right', width: 150 }}>Counted</th><th style={{ textAlign: 'right' }}>Difference</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
            {groups.map(g => (
              <tbody key={g.label}>
                <tr><td colSpan={5} style={{ background: 'var(--bg-subtle)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{g.label}</td></tr>
                {g.lines.map(l => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{qty(l.expected, l.unit)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {draft ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                          <input className="form-input" type="number" min="0" step={l.kind === 'p' ? '1' : '0.001'} style={{ width: 100, textAlign: 'right', height: 32 }}
                            value={counts[l.id]} onChange={e => { const v = e.target.value; setCounts(c => ({ ...c, [l.id]: v })); setDirty(d => ({ ...d, [l.id]: true })); }} />
                          <span className="text-muted" style={{ fontSize: 12, width: 26 }}>{l.unit}</span>
                        </div>
                      ) : (l.counted == null ? <span className="text-muted">not counted</span> : qty(l.counted, l.unit))}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: l.diff < 0 ? 'var(--danger-text)' : l.diff > 0 ? 'var(--success-text)' : undefined }}>
                      {l.diff == null ? '' : l.diff === 0 ? '—' : `${l.diff > 0 ? '+' : ''}${qty(l.diff, l.unit)}`}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: l.diffValue < 0 ? 'var(--danger-text)' : undefined }}>{l.diffValue ? signedIDR(l.diffValue) : ''}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
      {confirming && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
            <div className="modal-header"><div className="modal-title">Finish {o.no_text}?</div><button className="btn btn-icon" onClick={() => setConfirming(false)}>✕</button></div>
            <div className="modal-body" style={{ fontSize: 14, lineHeight: 1.6 }}>
              <div>{counted.length} of {view.length} items counted{view.length - counted.length ? ` — the other ${view.length - counted.length} stay as they are` : ''}.</div>
              <div>Each counted item in {o.store_name || 'this store'} is set to what was counted. Difference: <b style={{ color: diffTotal < 0 ? 'var(--danger-text)' : undefined }}>{signedIDR(diffTotal)}</b>.</div>
              <div className="text-muted" style={{ marginTop: 8 }}>A finished stock opname can't be changed. The summary goes to Telegram and the full list by email.</div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setConfirming(false)}>Back</button><button className="btn btn-primary" disabled={!counted.length} onClick={finish}>Finish stock opname</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Usage ─────────────────────────────

function UsageTab() {
  const [opnames, setOpnames] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [u, setU] = useState(null);
  const [error, setError] = useState('');
  const [byItem, setByItem] = useState(false);
  useEffect(() => {
    api.get('/api/stock/opnames').then(r => {
      const f = r.data.filter(o => o.status === 'finished');
      setOpnames(f);
      // Start on the latest count and the one before it of the same store.
      const prev = f.length ? f.slice(1).find(o => o.store_id === f[0].store_id) : null;
      if (prev) { setFrom(prev.id); setTo(f[0].id); } else if (f.length) { setFrom(f[0].id); setTo(''); }
    }).catch(() => setOpnames([]));
  }, []);
  useEffect(() => {
    if (!from) return;
    setError('');
    api.get('/api/stock/usage', { params: { from, to: to || undefined } }).then(r => setU(r.data)).catch(err => { setU(null); setError(err.response?.data?.error || 'Could not load'); });
  }, [from, to]);
  if (opnames && !opnames.length) return <div className="card" style={{ padding: 24 }}>The usage report runs from one stock opname to the next. Finish the first stock opname to start it.</div>;
  const fromO = opnames?.find(o => o.id === from);
  // The end must be a later count of the same store.
  const laterOnes = (opnames || []).filter(o => fromO && o.store_id === fromO.store_id && o.opname_no > fromO.opname_no);
  const anyMoved = u?.rows.some(r => r.transfer);
  const COLS = [['used_total', 'Used in total'], ['sold', 'Sold'], ['used', 'Used (not sold)'], ['waste', 'Waste'], ['opname', 'Opname difference']];
  return (
    <div>
      <div className="page-toolbar">
        <label style={{ fontSize: 13 }}>From <select className="form-select" style={{ width: 'auto', display: 'inline-block' }} value={from} onChange={e => { setFrom(e.target.value); setTo(''); }}>
          {(opnames || []).map(o => <option key={o.id} value={o.id}>{o.no_text} · {o.store_name} · {fmtDay(o.count_date)}</option>)}</select></label>
        <label style={{ fontSize: 13 }}>to <select className="form-select" style={{ width: 'auto', display: 'inline-block' }} value={to} onChange={e => setTo(e.target.value)}>
          <option value="">Now</option>{laterOnes.map(o => <option key={o.id} value={o.id}>{o.no_text} · {fmtDay(o.count_date)}</option>)}</select></label>
        <div className="seg">
          <button type="button" className={!byItem ? 'active' : ''} onClick={() => setByItem(false)}>By category</button>
          <button type="button" className={byItem ? 'active' : ''} onClick={() => setByItem(true)}>By item</button>
        </div>
        <div className="page-toolbar-end">{u && <button className="btn btn-secondary" onClick={() => download(`/api/stock/usage/xlsx?from=${from}${to ? `&to=${to}` : ''}`, `stock-usage.xlsx`)}>⬇ Excel</button>}</div>
      </div>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      {u && (<>
        <p className="text-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          {u.store?.name ? <b>{u.store.name}. </b> : null}Used = opening + bought{anyMoved ? ' + moved in − moved out' : ''} − closing, valued at each item's average cost. <b>Opname difference</b> is what left without a record — keep it small by recording waste and use with Adjust.
          {!to && ' "Now" uses today\'s stock — the end is exact only at a finished stock opname.'}
          {u.uncosted ? ` ${u.uncosted} item(s) have no cost yet and show no value.` : ''}
        </p>
        <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
          {COLS.map(([k, l]) => <div key={k} className="stat-card"><div className="stat-label">{l}</div><div className="stat-value" style={{ color: k === 'opname' && u.totals.opname < 0 ? 'var(--danger-text)' : undefined }}>{k === 'opname' ? signedIDR(u.totals[k]) : fmtIDR(u.totals[k])}</div></div>)}
        </div>
        <div className="card">
          <div className="table-wrap">
            {!byItem ? (
              <table style={{ minWidth: 720 }}>
                <thead><tr><th>Category</th>{COLS.map(([k, l]) => <th key={k} style={{ textAlign: 'right' }}>{l}</th>)}<th style={{ textAlign: 'right' }}>Closing value</th></tr></thead>
                <tbody>{u.categories.map(c => (
                  <tr key={c.category_label}><td style={{ fontWeight: 600 }}>{c.category_label} <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>· {c.items} items</span></td>
                    {COLS.map(([k]) => <td key={k} style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: k === 'used_total' ? 700 : 400 }}>{k === 'opname' ? signedIDR(c[k]) : fmtIDR(c[k])}</td>)}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(c.closing)}</td></tr>))}</tbody>
              </table>
            ) : (
              <table style={{ minWidth: 980, fontSize: 13 }}>
                <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Opening</th><th style={{ textAlign: 'right' }}>Bought</th>{anyMoved && <th style={{ textAlign: 'right' }}>Moved in / out</th>}<th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Used</th><th style={{ textAlign: 'right' }}>Waste</th><th style={{ textAlign: 'right' }}>Corrections</th><th style={{ textAlign: 'right' }}>Opname diff.</th><th style={{ textAlign: 'right' }}>Closing</th><th style={{ textAlign: 'right' }}>Used in total</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                <tbody>{u.rows.map(r => (
                  <tr key={r.key}>
                    <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="text-muted" style={{ fontSize: 11 }}>{r.category_label}</div></td>
                    {['opening', 'bought', ...(anyMoved ? ['transfer'] : []), 'sold', 'used', 'waste', 'correction', 'opname', 'closing'].map(k =>
                      <td key={k} style={{ textAlign: 'right', whiteSpace: 'nowrap', color: k === 'opname' && r[k] < 0 ? 'var(--danger-text)' : undefined }}>{r[k] ? qty(r[k]) : <span className="text-muted">—</span>}</td>)}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{qty(r.used_total, r.unit)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.value.used_total != null ? fmtIDR(r.value.used_total) : '—'}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
        </div>
      </>)}
    </div>
  );
}

// ───────────────────────────── Restaurant (POS) ─────────────────────────────

const POS_KIND = { ingredient: 'Ingredient', packaging: 'Packaging & supplies' };
const posCost = i => (BIG_UNIT[i.unit] ? `${fmtIDR(i.avg_cost * BIG_UNIT[i.unit][1])} / ${BIG_UNIT[i.unit][0]}` : `${fmtIDR(i.avg_cost)} / ${i.unit || 'unit'}`);

function useRestaurantStock(on = true) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!on) return;
    api.get('/api/stock/restaurant').then(r => setPos(r.data)).catch(err => setPos({ linked: true, items: [], error: err.response?.data?.error || 'Could not read the restaurant stock' }));
  }, [on]);
  return pos;
}

function RestaurantTab() {
  const pos = useRestaurantStock();
  const [history, setHistory] = useState(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);
  if (!pos) return <div className="text-muted">Loading…</div>;
  if (!pos.linked) return <div className="alert alert-warn"><div>The restaurant app (POS) is not linked — Property Details → POS Integration → Room tablet orders.</div></div>;
  const q = search.trim().toLowerCase();
  const shown = pos.items.filter(i => (kind === 'all' || i.category === kind) && (!lowOnly || i.low) && (!q || i.name.toLowerCase().includes(q)));
  const total = pos.items.reduce((t, i) => t + (i.value || 0), 0);
  const low = pos.items.filter(i => i.low).length;
  return (
    <div>
      {pos.error && <div className="alert alert-error"><div>{pos.error}</div></div>}
      <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
        <div className="stat-card"><div className="stat-label">Value on hand</div><div className="stat-value">{fmtIDR(total)}</div></div>
        <div className="stat-card"><div className="stat-label">Items</div><div className="stat-value">{pos.items.length}</div></div>
        <div className="stat-card"><div className="stat-label">Low</div><div className="stat-value">{low}</div></div>
      </div>
      <div className="page-toolbar">
        <input className="form-input" style={{ maxWidth: 260 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="seg">
          {[['all', 'All'], ['ingredient', 'Ingredients'], ['packaging', 'Packaging & supplies']].map(([k, l]) =>
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <label className="flex gap-1" style={{ alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} /> Low only</label>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 640 }}>
            <thead><tr><th>Item</th><th>Kind</th><th style={{ textAlign: 'right' }}>On hand</th><th style={{ textAlign: 'right' }}>Average cost</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
            <tbody>{shown.map(i => (
              <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setHistory(i)}>
                <td>{i.name}{i.low && <span className="badge badge-red" style={{ marginLeft: 6 }}>Low</span>}{i.stock < 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>Below 0</span>}</td>
                <td className="text-muted" style={{ fontSize: 12 }}>{POS_KIND[i.category] || i.category}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title={`${i.stock} ${i.unit}`}>{fmtQty(i.stock, i.unit)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{i.avg_cost != null ? posCost(i) : '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{i.value != null ? fmtIDR(i.value) : '—'}</td>
              </tr>))}
              {!shown.length && <tr><td colSpan={5} className="text-muted">Nothing to show.</td></tr>}</tbody>
          </table>
        </div>
      </div>
      {history && <RestaurantHistoryModal item={history} onClose={() => setHistory(null)} />}
      <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
        Tap an item for its history. Read from the restaurant app (POS), where the chef counts and adjusts it (its stock opname) and its recipes take it off at each sale.
        To buy for the restaurant: a purchase request, a purchase order or Purchasing → Bought without a PO — received goods go into the POS stock by themselves.
      </p>
    </div>
  );
}

function RestaurantHistoryModal({ item, onClose }) {
  const [h, setH] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/api/stock/restaurant/${item.id}/history`).then(r => setH(r.data))
      .catch(err => { setError(err.response?.data?.error || 'Could not load the history'); setH({ lines: [] }); });
  }, [item.id]);
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 780, width: '100%' }}>
        <div className="modal-header"><div><div className="modal-title">{item.name}</div><div className="text-muted" style={{ fontSize: 12 }}>Restaurant · {POS_KIND[item.category] || item.category} · {fmtQty(item.stock, item.unit)} in stock{item.value != null ? ` · ${fmtIDR(item.value)}` : ''}</div></div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
          {!h ? <div className="text-muted">Loading…</div> : (
            <div className="table-wrap">
              <table style={{ fontSize: 13, minWidth: 620 }}>
                <thead><tr><th>When</th><th>What</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>After</th><th>Note</th></tr></thead>
                <tbody>
                  {h.lines.map(l => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.at)}</td>
                      <td>{l.reason_label}{l.what ? <span className="text-muted"> · {l.what}</span> : null}{l.by ? <div className="text-muted" style={{ fontSize: 11 }}>{l.by}</div> : null}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: l.change < 0 ? 'var(--danger-text)' : 'var(--success-text)' }}>{l.change > 0 ? '+' : ''}{fmtQty(l.change, item.unit)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: l.after < 0 ? 'var(--danger-text)' : undefined }}>{fmtQty(l.after, item.unit)}</td>
                      <td className="text-muted" style={{ maxWidth: 220 }}>{l.note || ''}</td>
                    </tr>
                  ))}
                  {h.lines.length === 0 && !error && <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: 16 }}>No movements yet</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Kept by the POS since its stock history began. Changes are made in the POS (stock opname) — purchases arrive from the hotel's purchase orders.</p>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

const HISTORY_START = '2000-01-01T00:00:00Z';

function RestaurantUsageTab() {
  const [opnames, setOpnames] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [u, setU] = useState(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('all');
  useEffect(() => {
    api.get('/api/stock/restaurant/opnames').then(r => {
      setOpnames(r.data);
      if (r.data.length >= 2) { setFrom(r.data[1].created_at); setTo(r.data[0].created_at); }
      else if (r.data.length === 1) setFrom(r.data[0].created_at);
      else setFrom(HISTORY_START);
    }).catch(err => { setOpnames([]); setFrom(HISTORY_START); setError(err.response?.data?.error || ''); });
  }, []);
  useEffect(() => {
    if (!from) return;
    setError('');
    api.get('/api/stock/restaurant/usage', { params: { from, to: to || undefined } }).then(r => setU(r.data))
      .catch(err => { setU(null); setError(err.response?.data?.error || 'Could not load'); });
  }, [from, to]);
  const label = o => `${fmtDay(o.date)} · stock opname${o.by ? ` (${o.by})` : ''}`;
  const later = (opnames || []).filter(o => from && o.created_at > from);
  const rows = (u?.items || []).filter(i => kind === 'all' || i.category === kind);
  const sum = k => rows.reduce((t, i) => t + i[k], 0);
  return (
    <div>
      <div className="page-toolbar">
        <label style={{ fontSize: 13 }}>From <select className="form-select" style={{ width: 'auto', display: 'inline-block' }} value={from} onChange={e => { setFrom(e.target.value); setTo(''); }}>
          <option value={HISTORY_START}>When the stock history began</option>
          {(opnames || []).map(o => <option key={o.id} value={o.created_at}>{label(o)}</option>)}</select></label>
        <label style={{ fontSize: 13 }}>to <select className="form-select" style={{ width: 'auto', display: 'inline-block' }} value={to} onChange={e => setTo(e.target.value)}>
          <option value="">Now</option>{later.map(o => <option key={o.id} value={o.created_at}>{label(o)}</option>)}</select></label>
        <div className="seg">
          {[['all', 'All'], ['ingredient', 'Ingredients'], ['packaging', 'Packaging & supplies']].map(([k, l]) =>
            <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
      </div>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      {u && (<>
        <p className="text-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          <b>By recipe</b> = what the dishes sold should have used. <b>Kitchen use</b> = what the kitchen typed on a sheet in the POS (the breakfast buffet). <b>Used</b> = opening + bought − closing. The <b>difference</b> is what the stock opname found missing (red) or extra — waste, portions, a recipe that is wrong.
          It only shows once a stock opname is inside the period; until then used = by recipe. Values at today's average cost.
        </p>
        <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">Used</div><div className="stat-value">{fmtIDR(sum('used_value'))}</div></div>
          <div className="stat-card"><div className="stat-label">By recipe</div><div className="stat-value">{fmtIDR(sum('by_recipe_value'))}</div></div>
          <div className="stat-card"><div className="stat-label">Difference</div><div className="stat-value" style={{ color: sum('difference_value') > 0.5 ? 'var(--danger-text)' : undefined }}>{signedIDR(sum('difference_value'))}</div></div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table style={{ minWidth: 1000, fontSize: 13 }}>
              <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Opening</th><th style={{ textAlign: 'right' }}>Bought</th><th style={{ textAlign: 'right' }}>By recipe</th><th style={{ textAlign: 'right' }}>Kitchen use</th><th style={{ textAlign: 'right' }}>Used</th><th style={{ textAlign: 'right' }}>Difference</th><th style={{ textAlign: 'right' }}>Closing</th><th style={{ textAlign: 'right' }}>Used value</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id}>
                  <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="text-muted" style={{ fontSize: 11 }}>{POS_KIND[r.category] || r.category}</div></td>
                  {['opening', 'bought', 'by_recipe', 'kitchen_use', 'used'].map(k => <td key={k} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r[k] ? fmtQty(r[k], r.unit) : <span className="text-muted">—</span>}</td>)}
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: r.difference > 0 ? 'var(--danger-text)' : undefined }}>{r.difference ? `${r.difference > 0 ? '+' : ''}${fmtQty(r.difference, r.unit)}` : <span className="text-muted">—</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: r.closing < 0 ? 'var(--danger-text)' : undefined }}>{fmtQty(r.closing, r.unit)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(r.used_value)}</td>
                </tr>))}
                {!rows.length && <tr><td colSpan={9} className="text-muted">Nothing in this period.</td></tr>}</tbody>
            </table>
          </div>
        </div>
      </>)}
    </div>
  );
}

// ───────────────────────────── Stock value ─────────────────────────────

function ValueTab({ withPos, stores }) {
  const [items, setItems] = useState([]);
  const pos = useRestaurantStock(withPos);
  useEffect(() => { api.get('/api/stock/items').then(r => setItems(r.data)).catch(() => {}); }, []);
  const cats = [];
  for (const i of items) {
    let c = cats.find(x => x.label === i.category_label);
    if (!c) cats.push(c = { label: i.category_label, items: 0, value: 0, uncosted: 0 });
    c.items++; c.value += i.value || 0; if (i.avg_cost == null && i.on_hand > 0) c.uncosted++;
  }
  cats.sort((a, b) => b.value - a.value);
  const hotel = cats.reduce((t, c) => t + c.value, 0);
  const posCats = [];
  for (const i of (pos?.linked ? pos.items : [])) {
    const label = `Restaurant — ${POS_KIND[i.category] || i.category}`;
    let c = posCats.find(x => x.label === label);
    if (!c) posCats.push(c = { label, items: 0, value: 0, pos: true });
    c.items++; c.value += i.value || 0;
  }
  const restaurant = posCats.reduce((t, c) => t + c.value, 0);
  const total = hotel + restaurant;
  const rows = [...cats, ...posCats];
  const uncosted = items.filter(i => i.avg_cost == null && i.on_hand > 0);
  // Hotel stock by store: each store's quantity at the item's average cost.
  const byStore = pmsStores(stores).map(st => ({
    ...st, value: items.reduce((t, i) => t + (i.avg_cost != null ? (i.stores?.[st.id] || 0) * i.avg_cost : 0), 0),
    items: items.filter(i => i.stores?.[st.id]).length,
  }));
  const transitValue = items.reduce((t, i) => t + (i.avg_cost != null ? (i.in_transit || 0) * i.avg_cost : 0), 0);
  return (
    <div>
      <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
        <div className="stat-card"><div className="stat-label">Value on hand</div><div className="stat-value">{fmtIDR(total)}</div></div>
        {posCats.length > 0 && <div className="stat-card"><div className="stat-label">Hotel (PMS)</div><div className="stat-value">{fmtIDR(hotel)}</div></div>}
        {posCats.length > 0 && <div className="stat-card"><div className="stat-label">Restaurant (POS)</div><div className="stat-value">{fmtIDR(restaurant)}</div></div>}
        {!posCats.length && <div className="stat-card"><div className="stat-label">Items</div><div className="stat-value">{items.length}</div></div>}
      </div>
      {pos?.error && <div className="alert alert-error"><div>{pos.error} — the total shows the hotel's stock only.</div></div>}
      {uncosted.length > 0 && <div className="alert alert-warn"><div>{uncosted.length} item(s) in stock have no cost yet and are left out of the value: {uncosted.map(i => i.name).join(', ')}. Their cost is set by the next purchase.</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Items</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
            <tbody>{rows.map(c => (
              <tr key={c.label}><td style={{ fontWeight: 600 }}>{c.label}</td><td style={{ textAlign: 'right' }}>{c.items}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(c.value)}</td><td style={{ textAlign: 'right' }}>{total ? Math.round(c.value / total * 100) : 0}%</td></tr>))}</tbody>
            <tfoot><tr><td style={{ fontWeight: 700 }}>Total</td><td></td><td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtIDR(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>
      {byStore.length > 1 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Hotel stock by store</th><th style={{ textAlign: 'right' }}>Items</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
              <tbody>{byStore.map(st => (
                <tr key={st.id}><td style={{ fontWeight: 600 }}>{st.name}</td><td style={{ textAlign: 'right' }}>{st.items}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(st.value)}</td></tr>))}
                {transitValue > 0 && <tr><td style={{ fontWeight: 600 }}>On the way between stores</td><td style={{ textAlign: 'right' }}>{items.filter(i => i.in_transit > 0).length}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(transitValue)}</td></tr>}</tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Each item at its average cost (what the stock on hand cost to buy){posCats.length ? ' — the restaurant\'s as the POS has it right now' : ''}. For the books: use the value of a finished stock opname as the closing stock.</p>
    </div>
  );
}

// ───────────────────────────── Stores (owner) ─────────────────────────────

function StoresModal({ stores, onClose, onChanged }) {
  const [names, setNames] = useState(() => Object.fromEntries(stores.map(s => [s.id, s.name])));
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNames(n => ({ ...Object.fromEntries(stores.map(s => [s.id, s.name])), ...n })); }, [stores]);
  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); await onChanged(); } catch (err) { setError(err.response?.data?.error || 'Could not save'); }
    setBusy(false);
  }
  const rename = s => run(() => api.put(`/api/stock/stores/${s.id}`, { name: names[s.id] }));
  const toggle = s => run(() => api.put(`/api/stock/stores/${s.id}`, { is_active: !s.is_active }));
  const add = () => run(async () => { await api.post('/api/stock/stores', { name: adding }); setAdding(''); });
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 560, width: '100%' }}>
        <div className="modal-header"><div><div className="modal-title">Stores</div><div className="text-muted" style={{ fontSize: 12 }}>Where stock is kept. Bought goods go into Main Store unless another store is picked.</div></div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
          <table style={{ fontSize: 14 }}>
            <thead><tr><th>Name</th><th>Kept in</th><th></th></tr></thead>
            <tbody>{stores.map(s => (
              <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                <td><input className="form-input" style={{ height: 32 }} value={names[s.id] ?? s.name} onChange={e => setNames(n => ({ ...n, [s.id]: e.target.value }))} /></td>
                <td style={{ fontSize: 12 }}>{s.kind === 'main' ? 'The PMS · main store' : s.kind === 'pos' ? 'The restaurant app (POS)' : 'The PMS'}
                  {s.kind !== 'pos' && s.items_held ? <div className="text-muted">{s.items_held} item{s.items_held > 1 ? 's' : ''} held</div> : null}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {(names[s.id] ?? s.name) !== s.name && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => rename(s)}>Save</button>}{' '}
                  {s.kind === 'pms' && <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => toggle(s)}>{s.is_active ? 'Stop using' : 'Use again'}</button>}
                </td>
              </tr>))}</tbody>
          </table>
          <div className="flex gap-2" style={{ marginTop: 12 }}>
            <input className="form-input" placeholder="New store, e.g. Spa" value={adding} onChange={e => setAdding(e.target.value)} />
            <button className="btn btn-secondary" disabled={busy || !adding.trim()} onClick={add}>+ Add store</button>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>Kitchen and Resto are the restaurant's stock, kept and counted in the POS. A store still holding stock can't be switched off.</p>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ───────────────────────────── Transfers ─────────────────────────────
// Moving stock between stores (migration 157): Main Store sends, the receiving
// store confirms what arrived; anything short goes back to the sender.

const trStatus = t => t.status === 'sent' ? <span className="badge badge-amber">Waiting for {t.to_store}</span>
  : t.status === 'confirmed' ? <span className={`badge ${t.short_lines ? 'badge-red' : 'badge-green'}`}>{t.short_lines ? 'Arrived — some short' : 'Arrived'}</span>
  : <span className="badge badge-gray">Cancelled</span>;

function TransfersTab({ stores, storeId, canSend, onCount }) {
  const [show, setShow] = useState('open');
  const [list, setList] = useState(null);
  const [sending, setSending] = useState(false);
  const [openT, setOpenT] = useState(null);
  const [toast, setToast] = useState('');
  const load = () => {
    api.get('/api/stock-transfers', { params: { status: show, store: storeId || undefined } }).then(r => setList(r.data)).catch(() => setList([]));
    api.get('/api/stock-transfers/count').then(r => onCount?.(r.data.open)).catch(() => {});
  };
  useEffect(() => { load(); }, [show, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  function flash(m) { setToast(m); setTimeout(() => setToast(''), 5000); }
  return (
    <div>
      <div className="page-toolbar">
        <div className="seg">
          {[['open', 'Waiting'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => <button key={k} type="button" className={show === k ? 'active' : ''} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <div className="page-toolbar-end">{canSend && <button className="btn btn-primary" onClick={() => setSending(true)}>+ Move stock</button>}</div>
      </div>
      <p className="text-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        Items sent to another store leave the sending store at once and wait <b>on the way</b> until the receiving store confirms what arrived.
        Anything that did not arrive goes back to the sending store.
      </p>
      {toast && <div className="alert alert-success"><div>{toast}</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 680 }}>
            <thead><tr><th>No.</th><th>From → to</th><th>Items</th><th>Sent</th><th>Status</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
            <tbody>
              {(list || []).map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setOpenT(t)}>
                  <td style={{ fontWeight: 600 }}>{t.no_text}</td>
                  <td>{t.from_store} → <b>{t.to_store}</b></td>
                  <td style={{ fontSize: 13 }}>{t.lines.slice(0, 3).map(l => `${l.description} ×${qty(l.sent)}`).join(', ')}{t.lines.length > 3 ? ` +${t.lines.length - 3} more` : ''}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDateTime(t.sent_at)}<div className="text-muted" style={{ fontSize: 11 }}>{t.sent_by_name}</div></td>
                  <td>{trStatus(t)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(t.value)}</td>
                </tr>
              ))}
              {list && !list.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>{show === 'open' ? 'Nothing waiting to be confirmed' : 'No transfers yet'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {sending && <SendTransferModal stores={stores} storeId={storeId} onClose={() => setSending(false)}
        onSent={t => { setSending(false); load(); flash(`${t.no_text} sent to ${t.to_store} — waiting for them to confirm`); }} />}
      {openT && <TransferModal t={openT} canSend={canSend} onClose={() => setOpenT(null)}
        onChanged={(t, m) => { setOpenT(null); load(); flash(m); }} />}
    </div>
  );
}

function SendTransferModal({ stores, storeId, onClose, onSent }) {
  const choices = pmsStores(stores);
  const main = choices.find(s => s.kind === 'main');
  const [from, setFrom] = useState(storeId || main?.id || '');
  const [to, setTo] = useState(() => choices.find(s => s.id !== (storeId || main?.id))?.id || '');
  const [items, setItems] = useState([]);
  const [lines, setLines] = useState([{ key: '', quantity: '' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!from) return;
    api.get('/api/stock/items', { params: { store: from } }).then(r => setItems(r.data.filter(i => i.on_hand > 0))).catch(() => setItems([]));
  }, [from]);
  const byKey = Object.fromEntries(items.map(i => [i.key, i]));
  const setLine = (n, patch) => setLines(ls => ls.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const over = l => byKey[l.key] && Number(l.quantity) > byKey[l.key].on_hand + 1e-9;
  const ready = from && to && from !== to && lines.some(l => l.key && Number(l.quantity) > 0) && !lines.some(over);
  async function send() {
    setBusy(true); setError('');
    try {
      const r = await api.post('/api/stock-transfers', { from_store_id: from, to_store_id: to, note,
        lines: lines.filter(l => l.key && Number(l.quantity) > 0).map(l => ({ key: l.key, quantity: Number(l.quantity) })) });
      onSent(r.data.transfer);
    } catch (err) { setError(err.response?.data?.error || 'Could not send'); setBusy(false); }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 720, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">Move stock to another store</div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">From</label>
              <select className="form-select" value={from} onChange={e => { setFrom(e.target.value); setLines([{ key: '', quantity: '' }]); }}>
                {choices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">To</label>
              <select className="form-select" value={to} onChange={e => setTo(e.target.value)}>
                {choices.filter(s => s.id !== from).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          </div>
          <div className="form-label">Items</div>
          {lines.map((l, n) => (
            <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ItemPicker value={l.key} onChange={v => setLine(n, { key: v })}
                  placeholder={items.length ? 'Type to find the item…' : `Nothing in ${storeName(stores, from)}`}
                  options={items.map(i => ({ value: i.key, label: i.name, hint: `${qty(i.on_hand, i.unit)} here` }))} />
                {over(l) && <div style={{ fontSize: 11, color: 'var(--danger-text)' }}>Only {qty(byKey[l.key].on_hand, byKey[l.key].unit)} in {storeName(stores, from)}</div>}
              </div>
              <input className="form-input" style={{ width: 100 }} type="number" min="0" step={byKey[l.key]?.kind === 'p' ? '1' : '0.001'} placeholder="Qty"
                value={l.quantity} onChange={e => setLine(n, { quantity: e.target.value })} />
              <span className="text-muted" style={{ width: 34, fontSize: 12 }}>{byKey[l.key]?.unit || ''}</span>
              <button className="btn btn-icon" title="Remove line" onClick={() => setLines(ls => (ls.length > 1 ? ls.filter((_, i) => i !== n) : [{ key: '', quantity: '' }]))}>✕</button>
            </div>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={() => setLines(ls => [...ls, { key: '', quantity: '' }])}>+ Add line</button>
          <div className="form-group" style={{ marginTop: 12 }}><label className="form-label">Note</label>
            <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="optional — e.g. for the 2nd floor pantry" /></div>
          <div className="text-muted" style={{ fontSize: 12 }}>The items leave {storeName(stores, from) || 'the store'} now and count in {storeName(stores, to) || 'the other store'} once it confirms what arrived.</div>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !ready} onClick={send}>Send to {storeName(stores, to) || '…'}</button></div>
      </div>
    </div>
  );
}

function TransferModal({ t, canSend, onClose, onChanged }) {
  const open = t.status === 'sent';
  const [got, setGot] = useState(() => Object.fromEntries(t.lines.map(l => [l.id, String(l.sent)])));
  const [notes, setNotes] = useState({});
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shortOf = l => Math.round((l.sent - Number(got[l.id] || 0)) * 1000) / 1000;
  const bad = t.lines.some(l => got[l.id] === '' || Number(got[l.id]) < 0 || Number(got[l.id]) > l.sent || (shortOf(l) > 0 && !String(notes[l.id] || '').trim()));
  async function confirm() {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/api/stock-transfers/${t.id}/confirm`, { lines: t.lines.map(l => ({ line_id: l.id, accepted: Number(got[l.id]), note: notes[l.id] || '' })) });
      onChanged(r.data.transfer, `${t.no_text} confirmed — in ${t.to_store}${r.data.transfer.short_lines ? '; what did not arrive is back in ' + t.from_store : ''}`);
    } catch (err) { setError(err.response?.data?.error || 'Could not confirm'); setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setError('');
    try { const r = await api.post(`/api/stock-transfers/${t.id}/cancel`, { reason }); onChanged(r.data.transfer, `${t.no_text} cancelled — the items are back in ${t.from_store}`); }
    catch (err) { setError(err.response?.data?.error || 'Could not cancel'); setBusy(false); }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 720, width: '100%' }}>
        <div className="modal-header"><div>
          <div className="modal-title">{t.no_text} · {t.from_store} → {t.to_store}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>Sent {fmtDateTime(t.sent_at)} by {t.sent_by_name || '—'}
            {t.confirmed_at ? ` · confirmed ${fmtDateTime(t.confirmed_at)} by ${t.confirmed_by_name || '—'}` : ''}
            {t.cancelled_at ? ` · cancelled ${fmtDateTime(t.cancelled_at)} by ${t.cancelled_by_name || '—'}: ${t.cancel_reason}` : ''}</div>
        </div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
          {t.note && <div style={{ fontSize: 14, marginBottom: 10 }}>Note: {t.note}</div>}
          {open && <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>{t.to_store}: count what arrived. If less came, type what came and why — the rest goes back to {t.from_store}.</div>}
          <div className="table-wrap">
            <table style={{ fontSize: 14, minWidth: 560 }}>
              <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Sent</th><th style={{ textAlign: 'right', width: 150 }}>Arrived</th><th>{open ? 'Why less (if less)' : 'Note'}</th></tr></thead>
              <tbody>{t.lines.map(l => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{qty(l.sent, l.unit)}</td>
                  <td style={{ textAlign: 'right' }}>{open ? (
                    <input className="form-input" type="number" min="0" max={l.sent} step={l.kind === 'p' ? '1' : '0.001'} style={{ width: 100, textAlign: 'right', height: 32 }}
                      value={got[l.id]} onChange={e => setGot(g => ({ ...g, [l.id]: e.target.value }))} />
                  ) : t.status === 'confirmed' ? <span style={{ color: l.short > 0 ? 'var(--danger-text)' : undefined }}>{qty(l.accepted, l.unit)}</span> : '—'}</td>
                  <td>{open ? (shortOf(l) > 0 && <input className="form-input" style={{ height: 32 }} placeholder={`${qty(shortOf(l), l.unit)} short — why?`}
                      value={notes[l.id] || ''} onChange={e => setNotes(nn => ({ ...nn, [l.id]: e.target.value }))} />)
                    : <span className="text-muted" style={{ fontSize: 13 }}>{l.note || ''}</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
          {cancelling && (
            <div className="form-group" style={{ marginTop: 12 }}><label className="form-label">Why cancel? (the items go back to {t.from_store})</label>
              <input className="form-input" autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. sent to the wrong store" /></div>
          )}
        </div>
        <div className="modal-footer">
          {open && canSend && !cancelling && <button className="btn btn-secondary" onClick={() => setCancelling(true)}>Cancel transfer…</button>}
          {cancelling && <button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={cancel}>Cancel {t.no_text}</button>}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {open && !cancelling && <button className="btn btn-primary" disabled={busy || bad} onClick={confirm}>Confirm what arrived</button>}
        </div>
      </div>
    </div>
  );
}
