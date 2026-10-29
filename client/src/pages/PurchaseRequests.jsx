import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import ReasonModal from '../components/ReasonModal';

// Operations → Purchase requests (migration 144): a department asks for what
// it needs, purchasing orders it on a normal PO. The restaurant asks from its
// own app (the POS) — its requests show here too, tagged Restaurant (POS).
// Progress is read from the PO lines that order each request line.

const fmtIDR = n => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const q = (n, unit) => `${+Number(n || 0).toFixed(3)}${unit ? ' ' + unit : ''}`;
const fmtDay = d => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
const fmtDateTime = s => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const PROGRESS_BADGE = {
  waiting: 'amber', partly_ordered: 'blue', ordered: 'blue', partly_received: 'purple',
  received: 'green', closed: 'gray', declined: 'red', cancelled: 'gray',
};
const KIND_TAG = { pos: ['orange', 'Restaurant'], text: ['gray', 'Not in stock list'] };

export default function PurchaseRequests() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [setup, setSetup] = useState(null);
  const [show, setShow] = useState('open');
  const [dept, setDept] = useState('');
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [newOpen, setNewOpen] = useState(null);       // null | { lowOnly }
  const [selected, setSelected] = useState({});       // request line id → true
  const [makePo, setMakePo] = useState(false);
  const [closing, setClosing] = useState(null);       // { req, kind }
  const [pos, setPos] = useState(null);               // { linked, items } — loaded when needed

  const canOrder = !!setup?.can_order;
  const canAsk = can('purchase_request') || can('purchasing');

  function load() {
    api.get('/api/purchase-requests', { params: { show, department: dept || undefined } })
      .then(r => setList(r.data)).catch(err => setError(err.response?.data?.error || 'Could not load the requests'));
  }
  useEffect(() => { api.get('/api/purchase-requests/setup').then(r => setSetup(r.data)).catch(() => {}); }, []);
  useEffect(load, [show, dept]); // eslint-disable-line react-hooks/exhaustive-deps
  // ?new=1[&low=1] — from Stock → Request to buy.
  useEffect(() => {
    if (params.get('new')) {
      setNewOpen({ lowOnly: params.get('low') === '1' });
      params.delete('new'); params.delete('low'); setParams(params, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function loadPos() {
    if (pos) return;
    api.get('/api/purchase-requests/pos-items').then(r => setPos(r.data)).catch(() => setPos({ linked: false, items: [] }));
  }
  function flash(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast(null), 5000); }

  const picked = useMemo(() => {
    const out = [];
    for (const r of list || []) for (const l of r.lines) if (selected[l.id]) out.push({ ...l, request: r });
    return out;
  }, [list, selected]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Purchase requests</div>
          <div className="page-subtitle">Departments ask for what they need — purchasing orders it on a purchase order</div>
        </div>
        <div className="flex gap-2">
          <Link className="btn btn-secondary" to="/guide/purchase-requests">📘 Guide</Link>
          {canAsk && <button className="btn btn-primary" onClick={() => setNewOpen({ lowOnly: false })}>+ New request</button>}
        </div>
      </div>

      <div className="page-toolbar">
        <div className="seg">
          {[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) =>
            <button key={k} className={show === k ? 'active' : ''} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <select className="form-select" style={{ width: 200 }} value={dept} onChange={e => setDept(e.target.value)}>
          <option value="">All departments</option>
          {(setup?.departments || []).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>

      {error && <div className="alert alert-error"><div>{error}</div></div>}
      {toast && <div className={`alert ${toast.type === 'error' ? 'alert-error' : 'alert-success'}`}><div>{toast.msg}</div></div>}

      {list && list.length === 0 && <div className="card text-muted" style={{ padding: 24, textAlign: 'center' }}>
        {show === 'open' ? 'No open requests.' : 'No requests.'}</div>}
      {(list || []).map(r => (
        <RequestCard key={r.id} r={r} canOrder={canOrder} selected={selected}
          onToggle={(id, on) => setSelected(s => ({ ...s, [id]: on }))}
          onClose={kind => setClosing({ req: r, kind })} />
      ))}

      {canOrder && picked.length > 0 && (
        <div className="card" style={{ position: 'sticky', bottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
          <div style={{ flex: 1 }}><b>{picked.length}</b> item{picked.length === 1 ? '' : 's'} selected
            {new Set(picked.map(p => p.request.id)).size > 1 && <span className="text-muted"> · from {new Set(picked.map(p => p.request.id)).size} requests</span>}</div>
          <button className="btn btn-secondary" onClick={() => setSelected({})}>Clear</button>
          <button className="btn btn-primary" onClick={() => { if (picked.some(p => p.kind === 'text')) loadPos(); setMakePo(true); }}>Make purchase order</button>
        </div>
      )}

      {newOpen && setup && (
        <NewRequestModal setup={setup} lowOnly={newOpen.lowOnly} pos={pos} loadPos={loadPos}
          onClose={() => setNewOpen(null)}
          onDone={r => { setNewOpen(null); flash(`${r.request_no_text} sent to purchasing`); setShow('open'); load(); }} />
      )}
      {makePo && (
        <MakePoModal lines={picked} items={setup?.items || []} pos={pos}
          onClose={() => setMakePo(false)}
          onDone={po => { setMakePo(false); setSelected({}); load(); flash(<>Purchase order <Link to={`/purchasing?po=${po.id}`}><b>{po.po_number}</b></Link> made as a draft — submit it for approval in Purchasing.</>); }} />
      )}
      {closing && (
        <ReasonModal
          title={{ cancelled: `Cancel ${closing.req.request_no_text}?`, declined: `Decline ${closing.req.request_no_text}?`, done: `Close ${closing.req.request_no_text}?` }[closing.kind]}
          confirmLabel={{ cancelled: 'Cancel request', declined: 'Decline', done: 'Close request' }[closing.kind]}
          danger={closing.kind !== 'done'}
          placeholder={closing.kind === 'done' ? 'e.g. the rest is not available' : closing.kind === 'declined' ? 'e.g. we still have enough' : 'Why (optional)'}
          onClose={() => setClosing(null)}
          onConfirm={async reason => {
            const path = { cancelled: 'cancel', declined: 'decline', done: 'close' }[closing.kind];
            await api.post(`/api/purchase-requests/${closing.req.id}/${path}`, { reason });
            setClosing(null); load();
          }}>
          {closing.kind === 'done' && <p className="text-muted" style={{ fontSize: 13 }}>Closes the request although not everything was bought. The department sees it as Closed with your reason.</p>}
          {closing.kind === 'declined' && <p className="text-muted" style={{ fontSize: 13 }}>Nothing will be bought. The department sees it as Declined with your reason.</p>}
        </ReasonModal>
      )}
    </div>
  );
}

function RequestCard({ r, canOrder, selected, onToggle, onClose }) {
  const { user } = useAuth();
  const open = r.status === 'open';
  const late = open && r.needed_by && String(r.needed_by).slice(0, 10) < today();
  const nothingOrdered = r.lines.every(l => l.ordered_qty === 0);
  const mine = user?.id && r.requested_by === user.id;
  const selectable = l => canOrder && open && l.left_to_order > 0;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {r.request_no_text} · {r.department_label}
            <span className={`badge badge-${PROGRESS_BADGE[r.progress]}`} style={{ marginLeft: 8 }}>{r.progress_label}</span>
            {r.source === 'pos' && <span className="badge badge-orange" style={{ marginLeft: 6 }}>Restaurant app</span>}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {r.requested_by_name} · {fmtDateTime(r.created_at)}
            {r.needed_by && <span style={late ? { color: 'var(--danger-text)', fontWeight: 600 } : undefined}> · needed by {fmtDay(r.needed_by)}</span>}
          </div>
          {r.note && <div style={{ fontSize: 13, marginTop: 4 }}>📝 {r.note}</div>}
          {r.close_reason && <div style={{ fontSize: 12, marginTop: 4 }} className="text-muted">{r.progress_label}{r.closed_by_name ? ` by ${r.closed_by_name}` : ''}: {r.close_reason}</div>}
        </div>
        {open && (
          <div className="flex gap-2">
            {nothingOrdered && (canOrder || mine) && <button className="btn btn-sm btn-secondary" onClick={() => onClose('cancelled')}>Cancel</button>}
            {canOrder && nothingOrdered && <button className="btn btn-sm btn-secondary" onClick={() => onClose('declined')}>Decline</button>}
            {canOrder && !nothingOrdered && <button className="btn btn-sm btn-secondary" onClick={() => onClose('done')} title="Done although not everything was bought">Close</button>}
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table style={{ minWidth: 560 }}>
          <thead><tr>
            {canOrder && open && <th style={{ width: 28 }}></th>}
            <th>Item</th><th style={{ textAlign: 'right' }}>Asked</th><th style={{ textAlign: 'right' }}>Left when asked</th>
            <th>Ordered</th><th style={{ textAlign: 'right' }}>Received</th>
          </tr></thead>
          <tbody>
            {r.lines.map(l => (
              <tr key={l.id}>
                {canOrder && open && <td>{selectable(l) && <input type="checkbox" checked={!!selected[l.id]} onChange={e => onToggle(l.id, e.target.checked)} />}</td>}
                <td>
                  {l.description}
                  {KIND_TAG[l.kind] && <span className={`badge badge-${KIND_TAG[l.kind][0]}`} style={{ marginLeft: 6 }}>{KIND_TAG[l.kind][1]}</span>}
                  {l.note && <div className="text-muted" style={{ fontSize: 11 }}>{l.note}</div>}
                </td>
                <td style={{ textAlign: 'right' }}>{q(l.quantity, l.unit)}</td>
                <td style={{ textAlign: 'right' }} className="text-muted">{l.stock_when_asked != null ? q(l.stock_when_asked, l.unit) : '—'}</td>
                <td style={{ fontSize: 12 }}>
                  {l.orders.length === 0 ? <span className="text-muted">—</span> : l.orders.map(o => (
                    <div key={o.po_id + o.quantity}>
                      {canOrder ? <Link to={`/purchasing?po=${o.po_id}`}>{o.po_number}</Link> : o.po_number} · {q(o.quantity, l.unit)}
                    </div>))}
                  {open && l.ordered_qty > 0 && l.left_to_order > 0 && <div className="text-muted">{q(l.left_to_order, l.unit)} not ordered yet</div>}
                </td>
                <td style={{ textAlign: 'right', color: l.received_qty >= l.quantity ? '#16A34A' : undefined }}>{l.received_qty > 0 ? q(l.received_qty, l.unit) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── New request ──
const blankLine = () => ({ ref: '', description: '', unit: '', quantity: '', note: '' });

function NewRequestModal({ setup, lowOnly, pos, loadPos, onClose, onDone }) {
  const [department, setDepartment] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState(() => {
    const low = setup.items.filter(i => i.low || i.out);
    return lowOnly && low.length ? low.map(i => ({ ...blankLine(), ref: `pms|${i.key}` })) : [blankLine()];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pmsBy = useMemo(() => new Map(setup.items.map(i => [i.key, i])), [setup]);
  const posBy = useMemo(() => new Map((pos?.items || []).map(i => [i.id, i])), [pos]);
  useEffect(() => { if (department === 'fnb') loadPos(); }, [department]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i, patch) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  function itemOf(l) {
    const [src, id] = l.ref.split('|');
    if (src === 'pms') { const it = pmsBy.get(id); return it && { name: it.name, unit: it.unit, stock: it.on_hand, low: it.low || it.out }; }
    if (src === 'pos') { const it = posBy.get(id); return it && { name: it.name, unit: it.unit, stock: it.stock, low: it.low }; }
    return null;
  }

  async function save() {
    setError('');
    if (!department) return setError('Choose the department');
    const out = [];
    for (const l of lines) {
      if (!l.ref && !l.description.trim() && !l.quantity) continue;
      const qty = Number(l.quantity);
      if (!(qty > 0)) return setError('Every item needs a quantity');
      const [src, id] = l.ref.split('|');
      if (src === 'pms') out.push({ item_key: id, quantity: qty, note: l.note });
      else if (src === 'pos') { const it = posBy.get(id); out.push({ pos_item_id: id, description: it?.name, unit: it?.unit, quantity: qty, note: l.note }); }
      else if (src === 'text') {
        if (!l.description.trim()) return setError('Type the name of each item that is not in the list');
        out.push({ description: l.description, unit: l.unit, quantity: qty, note: l.note });
      } else return setError('Choose the item on every line');
    }
    if (!out.length) return setError('Add at least one item');
    setBusy(true);
    try {
      const r = await api.post('/api/purchase-requests', { department, needed_by: neededBy || null, note, lines: out });
      onDone(r.data);
    } catch (err) { setError(err.response?.data?.error || 'Could not send'); setBusy(false); }
  }

  const showPos = department === 'fnb' && pos?.linked && pos.items.length > 0;
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 760, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">New purchase request</div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Department</label>
              <select className="form-select" value={department} onChange={e => setDepartment(e.target.value)}>
                <option value="">Choose…</option>
                {setup.departments.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Needed by (optional)</label>
              <input className="form-input" type="date" min={today()} value={neededBy} onChange={e => setNeededBy(e.target.value)} /></div>
          </div>
          {department === 'fnb' && <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            The kitchen's ingredients are kept in the restaurant app — the chef can also ask from there (Inventory → Request to buy).</div>}
          <div className="table-wrap">
            <table style={{ minWidth: 600 }}>
              <thead><tr><th>Item</th><th style={{ width: 110 }}>How many</th><th style={{ width: 160 }}>Note</th><th style={{ width: 30 }}></th></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const it = itemOf(l);
                  return (
                    <tr key={i}>
                      <td>
                        <select className="form-select" value={l.ref} onChange={e => set(i, { ref: e.target.value })}>
                          <option value="">Choose an item…</option>
                          <optgroup label="Stock (PMS)">
                            {setup.items.map(x => <option key={x.key} value={`pms|${x.key}`}>{x.name} — {q(x.on_hand, x.unit)} left{x.out ? ' (out)' : x.low ? ' (low)' : ''}</option>)}
                          </optgroup>
                          {showPos && <optgroup label="Restaurant (POS)">
                            {pos.items.map(x => <option key={x.id} value={`pos|${x.id}`}>{x.name} — {q(x.stock, x.unit)} left{x.low ? ' (low)' : ''}</option>)}
                          </optgroup>}
                          <option value="text|">Something else — type it</option>
                        </select>
                        {l.ref === 'text|' && (
                          <div className="flex gap-2" style={{ marginTop: 4 }}>
                            <input className="form-input" placeholder="What (e.g. pump seal 2 inch)" value={l.description} onChange={e => set(i, { description: e.target.value })} />
                            <input className="form-input" style={{ width: 90 }} placeholder="unit" value={l.unit} onChange={e => set(i, { unit: e.target.value })} />
                          </div>
                        )}
                        {it && <div className="text-muted" style={{ fontSize: 11 }}>{q(it.stock, it.unit)} left now{it.low ? ' · low' : ''}</div>}
                      </td>
                      <td><input className="form-input" type="number" min="0" step="0.001" placeholder={it?.unit || l.unit || ''} value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} /></td>
                      <td><input className="form-input" value={l.note} onChange={e => set(i, { note: e.target.value })} placeholder="brand, size…" /></td>
                      <td>{lines.length > 1 && <button className="btn btn-icon" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))}>✕</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => setLines(ls => [...ls, blankLine()])}>+ Add item</button>
          <div className="form-group" style={{ marginTop: 12 }}><label className="form-label">Note for purchasing (optional)</label>
            <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. for the group arriving Friday" /></div>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Sending…' : 'Send to purchasing'}</button></div>
      </div>
    </div>
  );
}

// ── Make a purchase order from the selected request lines ──
function MakePoModal({ lines, items, pos, onClose, onDone }) {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState(() => [...new Set(lines.map(l => l.request.request_no_text))].join(', '));
  const [rows, setRows] = useState(() => lines.map(l => ({
    line: l, target: l.kind === 'text' ? 'text|' : '', quantity: String(l.left_to_order), unit_cost: '' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/api/purchasing/suppliers').then(r => setSuppliers(r.data.filter(s => s.is_active))).catch(() => {}); }, []);
  const set = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0);
  const pmsItems = items.filter(x => x.key.startsWith('rm:') || x.key.startsWith('p:'));

  async function save() {
    setError('');
    if (!supplierId) return setError('Choose the supplier');
    const out = [];
    for (const r of rows) {
      const l = r.line;
      const quantity = Number(r.quantity), unit_cost = Number(r.unit_cost);
      if (!(quantity > 0)) return setError(`How many of ${l.description}?`);
      if (!(unit_cost >= 0) || r.unit_cost === '') return setError(`The price of ${l.description}`);
      const base = { quantity, unit_cost, request_line_id: l.id };
      if (l.raw_material_id) out.push({ ...base, raw_material_id: l.raw_material_id });
      else if (l.product_id) out.push({ ...base, product_id: l.product_id });
      else if (l.pos_item_id) out.push({ ...base, pos_item_id: l.pos_item_id, description: l.description, unit: l.unit });
      else {
        // free text: keep it, or buy it as a stock item purchasing picked
        const [src, id] = r.target.split('|');
        if (src === 'pms') out.push({ ...base, [id.startsWith('rm:') ? 'raw_material_id' : 'product_id']: id.slice(id.indexOf(':') + 1) });
        else if (src === 'pos') { const it = pos?.items.find(x => x.id === id); out.push({ ...base, pos_item_id: id, description: it?.name || l.description, unit: it?.unit || l.unit }); }
        else out.push({ ...base, description: l.description, unit: l.unit });
      }
    }
    setBusy(true);
    try {
      const r = await api.post('/api/purchasing/purchase-orders', { supplier_id: supplierId, notes, items: out });
      onDone(r.data);
    } catch (err) { setError(err.response?.data?.error || 'Could not make the purchase order'); setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 820, width: '100%' }}>
        <div className="modal-header"><div className="modal-title">Make purchase order</div><button className="btn btn-icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><div>{error}</div></div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Supplier</label>
              <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">Choose…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {suppliers.length === 0 && <div className="text-muted" style={{ fontSize: 11 }}>Add suppliers in Purchasing → Suppliers.</div>}</div>
            <div className="form-group"><label className="form-label">Notes</label>
              <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
          <div className="table-wrap">
            <table style={{ minWidth: 680 }}>
              <thead><tr><th>Item</th><th>Request</th><th style={{ width: 110 }}>Order</th><th style={{ width: 140 }}>Price per unit</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const l = r.line;
                  return (
                    <tr key={l.id}>
                      <td>
                        {l.description}
                        {KIND_TAG[l.kind] && <span className={`badge badge-${KIND_TAG[l.kind][0]}`} style={{ marginLeft: 6 }}>{KIND_TAG[l.kind][1]}</span>}
                        {l.kind === 'text' && (
                          <select className="form-select" style={{ marginTop: 4 }} value={r.target} onChange={e => set(i, { target: e.target.value })}>
                            <option value="text|">Buy as typed — not kept in stock</option>
                            <optgroup label="Add to a PMS stock item">
                              {pmsItems.map(x => <option key={x.key} value={`pms|${x.key}`}>{x.name} ({x.unit})</option>)}
                            </optgroup>
                            {pos?.linked && pos.items.length > 0 && <optgroup label="Add to a restaurant (POS) item">
                              {pos.items.map(x => <option key={x.id} value={`pos|${x.id}`}>{x.name} ({x.unit})</option>)}
                            </optgroup>}
                          </select>
                        )}
                      </td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{l.request.request_no_text}<br />{l.request.department_label}</td>
                      <td><input className="form-input" type="number" min="0" step={l.product_id ? '1' : '0.001'} value={r.quantity} onChange={e => set(i, { quantity: e.target.value })} />
                        <div className="text-muted" style={{ fontSize: 11 }}>asked {q(l.left_to_order, l.unit)}</div></td>
                      <td><input className="form-input" type="number" min="0" value={r.unit_cost} placeholder={l.unit ? `per ${l.unit}` : 'per unit'} onChange={e => set(i, { unit_cost: e.target.value })} /></td>
                      <td style={{ textAlign: 'right' }}>{fmtIDR((Number(r.quantity) || 0) * (Number(r.unit_cost) || 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ textAlign: 'right', fontWeight: 700, marginTop: 8 }}>Total {fmtIDR(total)}</div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            The PO is made as a draft in Purchasing — submit and approve it there as usual. Restaurant items go to the POS stock when you receive them.
          </div>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Make draft PO'}</button></div>
      </div>
    </div>
  );
}
