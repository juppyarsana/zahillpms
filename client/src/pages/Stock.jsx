import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { COST_CATEGORIES } from '../lib/costLists';

// Operations → Stock (migration 136): everything kept in stock — stock items
// and Sales items with Track stock — with Adjust (one item, a known event),
// Stock opname (every item counted on one day), Usage between two opnames and
// Stock value. Buying is on Purchasing.

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

const TABS = [
  { key: 'items', label: 'Stock items' },
  { key: 'opname', label: 'Stock opname' },
  { key: 'usage', label: 'Usage' },
  { key: 'value', label: 'Stock value' },
];

export default function Stock() {
  const [tab, setTab] = useState('items');
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Stock</div>
          <div className="page-subtitle">What is in stock, what was used, and the stock opname — buying is on Purchasing</div>
        </div>
        <div><Link className="btn btn-secondary" to="/guide/stock">📘 Guide</Link></div>
      </div>
      <div className="tab-bar">
        {TABS.map(t => <button key={t.key} className={`tab-bar-item${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {tab === 'items' && <ItemsTab />}
      {tab === 'opname' && <OpnameTab />}
      {tab === 'usage' && <UsageTab />}
      {tab === 'value' && <ValueTab />}
    </div>
  );
}

// ───────────────────────────── Stock items ─────────────────────────────

function stockBadge(i) {
  if (i.out) return <span className="badge badge-red">{qty(i.on_hand, i.unit)}</span>;
  if (i.low) return <span className="badge badge-amber">Low · {qty(i.on_hand, i.unit)}</span>;
  return <span>{qty(i.on_hand, i.unit)}</span>;
}

function ItemsTab() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('all');           // all | low
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState(null);       // {} new | item
  const [adjusting, setAdjusting] = useState(null);
  const [history, setHistory] = useState(null);
  const [toast, setToast] = useState('');

  const load = () => api.get('/api/stock/items', { params: { inactive: inactive ? 1 : undefined } }).then(r => setItems(r.data)).catch(() => setItems([]));
  useEffect(() => { load(); }, [inactive]); // eslint-disable-line react-hooks/exhaustive-deps
  function flash(m) { setToast(m); setTimeout(() => setToast(''), 4000); }

  const q = search.trim().toLowerCase();
  const rows = items.filter(i => (!q || i.name.toLowerCase().includes(q) || i.category_label.toLowerCase().includes(q)) && (show === 'all' || i.low || i.out));
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
        Stock items (used by the hotel) and Sales items with Track stock on (sold as they are). Stock goes up when bought on Purchasing,
        down when sold, and with <b>Adjust</b> for waste, use or a correction. Click an item for its history.
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
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{stockBadge(i)}</td>
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
      {adjusting && <AdjustModal item={adjusting} onClose={() => setAdjusting(null)} onDone={r => { setAdjusting(null); load(); flash(`${r.item.name}: ${qty(r.item.on_hand, r.item.unit)} left`); }} />}
      {history && <HistoryModal item={history} onClose={() => setHistory(null)} onAdjust={() => { setAdjusting(history); setHistory(null); }} />}
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

function AdjustModal({ item, onClose, onDone }) {
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
      const r = await api.post(`/api/stock/items/${item.key}/adjust`, { reason, quantity: n, direction, note });
      onDone(r.data);
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
        <div className="modal-header"><div><div className="modal-title">Adjust · {item.name}</div><div className="text-muted" style={{ fontSize: 12 }}>{qty(item.on_hand, item.unit)} in stock</div></div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><div>{error}</div></div>}
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
          {n > 0 && <div style={{ fontSize: 14 }}>After: <b>{qty(item.on_hand + change, item.unit)}</b>{item.avg_cost != null ? <span className="text-muted"> · {signedIDR(change * item.avg_cost)}</span> : ''}</div>}
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !(n > 0) || (reason === 'correction' && !note.trim())} onClick={save}>Save</button></div>
      </div>
    </div>
  );
}

function HistoryModal({ item, onClose, onAdjust }) {
  const [h, setH] = useState(null);
  useEffect(() => { api.get(`/api/stock/items/${item.key}/history`).then(r => setH(r.data)).catch(() => setH({ lines: [] })); }, [item.key]);
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 760, width: '100%' }}>
        <div className="modal-header"><div><div className="modal-title">{item.name}</div><div className="text-muted" style={{ fontSize: 12 }}>{item.kind_label} · {item.category_label} · {qty(item.on_hand, item.unit)} in stock{item.value != null ? ` · ${fmtIDR(item.value)}` : ''}</div></div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {!h ? <div className="text-muted">Loading…</div> : (
            <div className="table-wrap">
              <table style={{ fontSize: 13, minWidth: 600 }}>
                <thead><tr><th>When</th><th>What</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>After</th><th>Note</th></tr></thead>
                <tbody>
                  {h.lines.map(l => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                      <td>{l.reason_label}{l.by_name ? <div className="text-muted" style={{ fontSize: 11 }}>{l.by_name}</div> : null}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: l.change_qty < 0 ? 'var(--danger-text)' : 'var(--success-text)' }}>{l.change_qty > 0 ? '+' : ''}{qty(l.change_qty, item.unit)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{qty(l.after, item.unit)}</td>
                      <td className="text-muted" style={{ maxWidth: 220 }}>{l.note || ''}</td>
                    </tr>
                  ))}
                  {h.lines.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: 16 }}>No movements yet</td></tr>}
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

function OpnameTab() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);       // the opname shown
  const [error, setError] = useState('');
  const load = () => api.get('/api/stock/opnames').then(r => setList(r.data)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const draft = list?.find(o => o.status === 'draft');

  async function start() {
    setError('');
    try { const r = await api.post('/api/stock/opnames', {}); setOpen(r.data.opname); load(); }
    catch (err) { setError(err.response?.data?.error || 'Could not start'); }
  }
  const show = id => api.get(`/api/stock/opnames/${id}`).then(r => setOpen(r.data)).catch(() => setError('Could not open it'));

  if (open) return <OpnameSheet o={open} onBack={() => { setOpen(null); load(); }} onChanged={setOpen} />;
  return (
    <div>
      <div className="page-toolbar">
        <div className="text-muted" style={{ fontSize: 13, maxWidth: 640 }}>
          Count everything on the shelf on one day — weekly or monthly. The difference against what the PMS expects is the stock that left without a record.
        </div>
        <div className="page-toolbar-end">
          {draft ? <button className="btn btn-primary" onClick={() => show(draft.id)}>Continue {draft.no_text}</button>
            : <button className="btn btn-primary" onClick={start}>+ Start stock opname</button>}
        </div>
      </div>
      {error && <div className="alert alert-error"><div>{error}</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table style={{ minWidth: 700 }}>
            <thead><tr><th>No.</th><th>Date</th><th>Status</th><th style={{ textAlign: 'right' }}>Counted</th><th style={{ textAlign: 'right' }}>Value on hand</th><th style={{ textAlign: 'right' }}>Difference</th><th>By</th></tr></thead>
            <tbody>
              {(list || []).map(o => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => show(o.id)}>
                  <td style={{ fontWeight: 600 }}>{o.no_text}</td>
                  <td>{fmtDay(o.count_date)}</td>
                  <td>{o.status === 'draft' ? <span className="badge badge-amber">Being counted</span> : <span className="badge badge-green">Finished</span>}</td>
                  <td style={{ textAlign: 'right' }}>{o.counted} of {o.items}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{o.status === 'finished' ? fmtIDR(o.counted_value) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: o.difference_value < 0 ? 'var(--danger-text)' : undefined }}>{o.status === 'finished' ? signedIDR(o.difference_value) : '—'}</td>
                  <td>{o.finished_by_name || o.created_by_name}</td>
                </tr>
              ))}
              {list && list.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No stock opname yet — start the first one</td></tr>}
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
        <div style={{ fontWeight: 700 }}>{o.no_text} · {fmtDay(o.count_date)}</div>
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
              <div>Each counted item is set to what was counted. Difference: <b style={{ color: diffTotal < 0 ? 'var(--danger-text)' : undefined }}>{signedIDR(diffTotal)}</b>.</div>
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
      if (f.length >= 2) { setFrom(f[1].id); setTo(f[0].id); } else if (f.length === 1) { setFrom(f[0].id); setTo(''); }
    }).catch(() => setOpnames([]));
  }, []);
  useEffect(() => {
    if (!from) return;
    setError('');
    api.get('/api/stock/usage', { params: { from, to: to || undefined } }).then(r => setU(r.data)).catch(err => { setU(null); setError(err.response?.data?.error || 'Could not load'); });
  }, [from, to]);
  if (opnames && !opnames.length) return <div className="card" style={{ padding: 24 }}>The usage report runs from one stock opname to the next. Finish the first stock opname to start it.</div>;
  const fromO = opnames?.find(o => o.id === from);
  const laterOnes = (opnames || []).filter(o => fromO && o.opname_no > fromO.opname_no);
  const COLS = [['used_total', 'Used in total'], ['sold', 'Sold'], ['used', 'Used (not sold)'], ['waste', 'Waste'], ['opname', 'Opname difference']];
  return (
    <div>
      <div className="page-toolbar">
        <label style={{ fontSize: 13 }}>From <select className="form-select" style={{ width: 'auto', display: 'inline-block' }} value={from} onChange={e => { setFrom(e.target.value); setTo(''); }}>
          {(opnames || []).map(o => <option key={o.id} value={o.id}>{o.no_text} · {fmtDay(o.count_date)}</option>)}</select></label>
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
          Used = opening + bought − closing, valued at each item's average cost. <b>Opname difference</b> is what left without a record — keep it small by recording waste and use with Adjust.
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
                <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Opening</th><th style={{ textAlign: 'right' }}>Bought</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Used</th><th style={{ textAlign: 'right' }}>Waste</th><th style={{ textAlign: 'right' }}>Corrections</th><th style={{ textAlign: 'right' }}>Opname diff.</th><th style={{ textAlign: 'right' }}>Closing</th><th style={{ textAlign: 'right' }}>Used in total</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                <tbody>{u.rows.map(r => (
                  <tr key={r.key}>
                    <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="text-muted" style={{ fontSize: 11 }}>{r.category_label}</div></td>
                    {['opening', 'bought', 'sold', 'used', 'waste', 'correction', 'opname', 'closing'].map(k =>
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

// ───────────────────────────── Stock value ─────────────────────────────

function ValueTab() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get('/api/stock/items').then(r => setItems(r.data)).catch(() => {}); }, []);
  const cats = [];
  for (const i of items) {
    let c = cats.find(x => x.label === i.category_label);
    if (!c) cats.push(c = { label: i.category_label, items: 0, value: 0, uncosted: 0 });
    c.items++; c.value += i.value || 0; if (i.avg_cost == null && i.on_hand > 0) c.uncosted++;
  }
  cats.sort((a, b) => b.value - a.value);
  const total = cats.reduce((t, c) => t + c.value, 0);
  const uncosted = items.filter(i => i.avg_cost == null && i.on_hand > 0);
  return (
    <div>
      <div className="stat-grid stat-grid-money" style={{ marginBottom: 12 }}>
        <div className="stat-card"><div className="stat-label">Value on hand</div><div className="stat-value">{fmtIDR(total)}</div></div>
        <div className="stat-card"><div className="stat-label">Items</div><div className="stat-value">{items.length}</div></div>
      </div>
      {uncosted.length > 0 && <div className="alert alert-warn"><div>{uncosted.length} item(s) in stock have no cost yet and are left out of the value: {uncosted.map(i => i.name).join(', ')}. Their cost is set by the next purchase.</div></div>}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Items</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
            <tbody>{cats.map(c => (
              <tr key={c.label}><td style={{ fontWeight: 600 }}>{c.label}</td><td style={{ textAlign: 'right' }}>{c.items}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtIDR(c.value)}</td><td style={{ textAlign: 'right' }}>{total ? Math.round(c.value / total * 100) : 0}%</td></tr>))}</tbody>
            <tfoot><tr><td style={{ fontWeight: 700 }}>Total</td><td></td><td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtIDR(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Each item at its average cost (what the stock on hand cost to buy). For the books: use the value of a finished stock opname as the closing stock.</p>
    </div>
  );
}
