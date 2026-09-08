import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import api from '../api';
import { getToken, getUser } from '../auth';
import useResilientEventSource from '../useResilientEventSource';

const POLL_MS = 30_000;

function fmtIDR(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function fmtAge(openedAt) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function TablesScreen() {
  const [tables, setTables] = useState([]);
  const [billModal, setBillModal] = useState(null); // { table, session, orders, total } | null
  const [qrModal, setQrModal] = useState(null); // { table_id, name, url, dataUrl } | null
  const [addModal, setAddModal] = useState(false);
  const [newTable, setNewTable] = useState({ name: '', capacity: '' });
  const [addError, setAddError] = useState('');
  const isOwner = getUser()?.role === 'owner';

  const fetchTables = useCallback(async () => {
    const { data } = await api.get('/resto/tables');
    setTables(data);
  }, []);

  useEffect(() => {
    fetchTables();
    const id = setInterval(fetchTables, POLL_MS);
    return () => clearInterval(id);
  }, [fetchTables]);

  const token = getToken();
  useResilientEventSource(
    token ? `/api/resto/stream?token=${encodeURIComponent(token)}` : null,
    () => fetchTables()
  );

  async function seatParty(table) {
    await api.post(`/resto/tables/${table.id}/session`);
    fetchTables();
  }

  async function viewBill(table) {
    const { data } = await api.get(`/resto/tables/${table.id}/session`);
    setBillModal({ table, ...data });
  }

  async function closeTable(table) {
    if (!window.confirm(`Close ${table.name}? This clears the table for the next party.`)) return;
    await api.post(`/resto/tables/${table.id}/close`);
    setBillModal(null);
    fetchTables();
  }

  async function showQr(table) {
    const { data } = await api.get(`/resto/tables/${table.id}/qr`);
    const dataUrl = await QRCode.toDataURL(data.url, { width: 240, margin: 1 });
    setQrModal({ ...data, dataUrl });
  }

  async function addTable() {
    if (!newTable.name.trim()) { setAddError('Name is required'); return; }
    try {
      // /api/tables (not /api/resto/tables) — the shared table CRUD endpoint
      // also used by the PMS Sales page's Products/Tables tab; POST is
      // gated server-side by requireOwnerOrMenu('resto_tables'), so a
      // resto_tables-permitted login can create tables from here directly.
      await api.post('/tables', { name: newTable.name.trim(), capacity: newTable.capacity ? parseInt(newTable.capacity) : null });
      setAddModal(false);
      setNewTable({ name: '', capacity: '' });
      setAddError('');
      fetchTables();
    } catch (err) {
      setAddError(err.response?.data?.error || 'Could not add this table.');
    }
  }

  async function resetQr(table) {
    if (!window.confirm(`Reset ${table.name}'s QR code? The old printed sticker will stop working immediately.`)) return;
    const { data } = await api.post(`/resto/tables/${table.id}/qr/reset`);
    const dataUrl = await QRCode.toDataURL(data.url, { width: 240, margin: 1 });
    setQrModal({ table_id: table.id, name: table.name, ...data, dataUrl });
  }

  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-xl font-light text-ink">Tables</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => setAddModal(true)} className="rounded-lg bg-accent text-[color:var(--accent-contrast)] text-xs font-bold px-3.5 py-2">
            + Add Table
          </button>
          <Link to="/staff/tables/qr" className="text-xs text-accent font-semibold">Print QR sheet →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {tables.map(t => (
          <div key={t.id} className="rounded-2xl border border-app bg-surface p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-ink">{t.name}</span>
              <span className={
                'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ' +
                (t.session ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')
              }>
                {t.session ? 'Occupied' : 'Available'}
              </span>
            </div>

            {t.session && (
              <div className="text-xs text-dim">
                Open {fmtAge(t.session.opened_at)} · {t.order_count} order{t.order_count === 1 ? '' : 's'} · {fmtIDR(t.session_total)}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-1">
              {!t.session && (
                <button onClick={() => seatParty(t)} className="rounded-lg bg-surface-2 border border-app text-ink text-[11px] font-bold px-2.5 py-1.5">Seat Party</button>
              )}
              {t.session && (
                <>
                  <button onClick={() => viewBill(t)} className="rounded-lg bg-surface-2 border border-app text-ink text-[11px] font-bold px-2.5 py-1.5">View Bill</button>
                  <button onClick={() => closeTable(t)} className="rounded-lg bg-surface-2 border border-app text-ink text-[11px] font-bold px-2.5 py-1.5">Close Table</button>
                </>
              )}
              <button onClick={() => showQr(t)} className="rounded-lg bg-surface-2 border border-app text-ink text-[11px] font-bold px-2.5 py-1.5">Show QR</button>
              {isOwner && <button onClick={() => resetQr(t)} className="rounded-lg bg-surface-2 border border-app text-danger text-[11px] font-bold px-2.5 py-1.5">Reset QR</button>}
            </div>
          </div>
        ))}
        {tables.length === 0 && <p className="text-dim text-sm col-span-full">No tables yet — add your first one above.</p>}
      </div>

      {addModal && (
        <Modal onClose={() => setAddModal(false)} title="Add Table">
          <div className="flex flex-col gap-3">
            <input
              placeholder="Table name (e.g. T4)"
              value={newTable.name}
              onChange={e => setNewTable(t => ({ ...t, name: e.target.value }))}
              className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none"
            />
            <input
              type="number"
              placeholder="Capacity (optional)"
              value={newTable.capacity}
              onChange={e => setNewTable(t => ({ ...t, capacity: e.target.value }))}
              className="bg-surface-2 border border-app rounded-lg px-3 py-2.5 text-sm text-ink outline-none"
            />
            {addError && <p className="text-danger text-xs">{addError}</p>}
            <button onClick={addTable} className="w-full rounded-lg bg-accent text-[color:var(--accent-contrast)] text-sm font-bold py-3">
              Add Table
            </button>
          </div>
        </Modal>
      )}

      {billModal && (
        <Modal onClose={() => setBillModal(null)} title={`${billModal.table.name} — Bill`}>
          {billModal.orders.length === 0 && <p className="text-dim text-sm">No orders yet.</p>}
          <div className="flex flex-col gap-2.5">
            {billModal.orders.map(o => (
              <div key={o.id} className="text-sm flex justify-between gap-3">
                <span className="text-ink">{(o.items || []).map(i => `${i.quantity}× ${i.name}`).join(', ')}</span>
                <span className="text-muted flex-shrink-0">{fmtIDR(o.total_amount)}</span>
              </div>
            ))}
          </div>
          <div className="h-px bg-app-soft my-3" />
          <div className="flex justify-between font-bold">
            <span className="text-ink">Total</span><span className="text-accent">{fmtIDR(billModal.total)}</span>
          </div>
          <button onClick={() => closeTable(billModal.table)} className="w-full rounded-lg bg-surface-2 border border-app text-ink text-sm font-bold py-3 mt-4">
            Close Table
          </button>
        </Modal>
      )}

      {qrModal && (
        <Modal onClose={() => setQrModal(null)} title={qrModal.name}>
          <div className="text-center">
            <img src={qrModal.dataUrl} alt="QR code" className="w-[200px] h-[200px] bg-white rounded-lg p-2 mx-auto" />
            <p className="text-xs text-dim mt-3 break-all">{qrModal.url}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-5" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface border border-app rounded-2xl p-6 w-[360px] max-h-[80vh] overflow-y-auto shadow-card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-bold text-ink">{title}</h3>
          <button onClick={onClose} className="text-dim text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
