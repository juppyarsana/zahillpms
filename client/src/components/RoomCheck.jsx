// Room check / minibar (migration 091) — the front desk side.
//
//   <RoomCheckPanel bookingId … />  on the booking page and in the checkout
//   windows: "Ask housekeeping" → waits (the page refreshes itself) → shows
//   what housekeeping found → "Add to bill" (a Sales sale charged to the room)
//   or set it aside. Housekeeping answers on the room tablet or from the link
//   in the Telegram message; they can also send a check without being asked.
//   Checkout is never blocked — a check that isn't back yet is only a warning.
import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

const TEXT = {
  en: {
    title: 'Room check (minibar)',
    ask: '🧺 Ask housekeeping to check the room', asking: 'Asking…',
    waiting: at => `Waiting for housekeeping — asked ${at}`, waitNote: 'You can check out without it; the answer still arrives here.',
    again: 'Ask again', cancel: 'Cancel request',
    found: at => `Housekeeping checked the room${at ? ` at ${at}` : ''}`, nothing: 'Nothing taken from the minibar.',
    add: total => `Add ${total} to the bill`, ok: 'OK — nothing to charge', aside: 'Don’t charge',
    done: 'Added to the bill', doneNothing: 'Checked — nothing taken', note: 'Note',
    asideConfirm: 'Set this room check aside without charging it?',
  },
  id: {
    title: 'Cek kamar (minibar)',
    ask: '🧺 Minta housekeeping cek kamar', asking: 'Meminta…',
    waiting: at => `Menunggu housekeeping — diminta ${at}`, waitNote: 'Check-out tetap bisa dilakukan; hasilnya tetap muncul di sini.',
    again: 'Minta lagi', cancel: 'Batalkan permintaan',
    found: at => `Housekeeping sudah cek kamar${at ? ` pukul ${at}` : ''}`, nothing: 'Tidak ada yang diambil dari minibar.',
    add: total => `Tambahkan ${total} ke tagihan`, ok: 'OK — tidak ada tagihan', aside: 'Jangan tagih',
    done: 'Sudah masuk tagihan', doneNothing: 'Sudah dicek — tidak ada yang diambil', note: 'Catatan',
    asideConfirm: 'Kesampingkan hasil cek kamar ini tanpa menagih?',
  },
};

export default function RoomCheckPanel({ bookingId, lang = 'en', card = false, onCharged }) {
  const t = TEXT[lang] || TEXT.en;
  const [checks, setChecks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qty, setQty] = useState({});   // front desk's corrected quantities, by product

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/room-checks', { params: { booking_id: bookingId } });
      setChecks(r.data);
    } catch { setChecks(c => c || []); }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);
  const open = (checks || []).find(c => c.status === 'requested' || c.status === 'submitted');
  // While something is open, look again every few seconds: the answer comes
  // from another device.
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [open?.id, open?.status, load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Something went wrong'); }
    finally { setBusy(false); }
  }
  const ask = () => run(() => api.post('/api/room-checks', { booking_id: bookingId }));
  const dismiss = c => { if (c.status === 'submitted' && !confirm(t.asideConfirm)) return; run(() => api.post(`/api/room-checks/${c.id}/dismiss`)); };
  const charge = c => run(async () => {
    const items = c.items.map(i => ({ product_id: i.product_id, quantity: qty[i.product_id] ?? i.quantity }));
    await api.post(`/api/room-checks/${c.id}/charge`, { items });
    setQty({});
    onCharged?.();
  });

  if (checks === null) return null;
  const closed = checks.filter(c => c.status === 'charged').slice(0, 3);
  const lineQty = i => { const v = qty[i.product_id]; return v === undefined ? i.quantity : v; };
  const total = c => c.items.reduce((s, i) => s + i.unit_price * (parseInt(lineQty(i), 10) || 0), 0);

  const body = (
    <>
      {!open && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={ask} disabled={busy}>{busy ? t.asking : t.ask}</button>
      )}

      {open?.status === 'requested' && (
        <div className="alert alert-warn" style={{ margin: 0 }}>
          <div>
            ⏳ {t.waiting(fmtTime(open.requested_at))}
            <div style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>{t.waitNote}</div>
            <div className="flex gap-2" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={ask} disabled={busy}>{t.again}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => dismiss(open)} disabled={busy}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {open?.status === 'submitted' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>🧺 {t.found(fmtTime(open.submitted_at))}</div>
          {open.items.length === 0 && <div style={{ fontSize: 13 }}>✅ {t.nothing}</div>}
          {open.items.map(i => (
            <div key={i.product_id} className="flex-between" style={{ gap: 10, padding: '4px 0', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{i.name} <span className="text-muted">× {fmtIDR(i.unit_price)}</span></span>
              <input className="form-input" type="number" min="0" max="99" value={lineQty(i)} style={{ width: 64, textAlign: 'center', padding: '4px 6px' }}
                onChange={e => setQty(q => ({ ...q, [i.product_id]: e.target.value }))} />
              <span style={{ width: 96, textAlign: 'right', fontWeight: 600 }}>{fmtIDR(i.unit_price * (parseInt(lineQty(i), 10) || 0))}</span>
            </div>
          ))}
          {open.note && <div style={{ fontSize: 12, marginTop: 6 }}>📝 <b>{t.note}:</b> {open.note}</div>}
          <div className="flex gap-2" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => charge(open)} disabled={busy}>
              {total(open) > 0 ? t.add(fmtIDR(total(open))) : t.ok}
            </button>
            {open.items.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => dismiss(open)} disabled={busy}>{t.aside}</button>
            )}
          </div>
        </div>
      )}

      {closed.map(c => (
        <div key={c.id} className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          ✓ {fmtTime(c.closed_at)} — {c.sale_id ? `${t.done}: ${c.items.map(i => `${i.quantity} × ${i.name}`).join(', ')}` : t.doneNothing}
        </div>
      ))}
      {error && <div className="alert alert-error" style={{ marginTop: 8, marginBottom: 0 }}>{error}</div>}
    </>
  );

  if (card) return <div className="card mt-3"><div className="card-title">{t.title}</div>{body}</div>;
  return <div style={{ marginBottom: 12 }}>{body}</div>;
}
