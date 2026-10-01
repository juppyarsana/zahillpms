// Room check from a phone (migration 091) — opened from the link in the
// Telegram message front desk's request sends to housekeeping. No login: the
// link is the credential, and it stops working once the check is sent.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

export default function RoomCheckPublic() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [gone, setGone] = useState('');
  const [qty, setQty] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch(`/api/public/room-check/${token}`)
      .then(async r => (r.ok ? setData(await r.json()) : setGone((await r.json().catch(() => ({}))).error || 'This link no longer works')))
      .catch(() => setGone('No connection — try again'));
  }, [token]);

  const step = (id, d) => setQty(q => ({ ...q, [id]: Math.max(0, Math.min(99, (q[id] || 0) + d)) }));
  const picked = (data?.items || []).filter(i => qty[i.id] > 0);
  const total = picked.reduce((s, i) => s + i.price * qty[i.id], 0);

  async function send() {
    setBusy(true);
    try {
      const r = await fetch(`/api/public/room-check/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: picked.map(i => ({ product_id: i.id, quantity: qty[i.id] })), note }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setGone(body.error || 'Could not send'); return; }
      setSent(body);
    } catch { alert('No connection — nothing was sent. Try again.'); }
    finally { setBusy(false); setConfirming(false); }
  }

  const wrap = { maxWidth: 520, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif', color: '#1f2937' };
  const btn = { border: 'none', borderRadius: 12, padding: '14px 16px', fontSize: 16, fontWeight: 600, width: '100%', cursor: 'pointer' };
  const round = { width: 44, height: 44, borderRadius: 22, border: '1px solid #d1d5db', background: '#fff', fontSize: 22, cursor: 'pointer' };

  if (gone) return <div style={wrap}><h2>Room check</h2><p>{gone}</p></div>;
  if (!data) return <div style={wrap}>Loading…</div>;
  if (sent) {
    return (
      <div style={wrap}>
        <h2>✓ Sent to front desk</h2>
        <p>Room {sent.room} — {sent.items ? `${sent.items} item${sent.items === 1 ? '' : 's'}, ${fmtIDR(sent.total)}` : 'nothing taken from the minibar'}.</p>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <div style={{ fontSize: 13, color: '#6b7280' }}>{data.property_name}</div>
      <h2 style={{ margin: '4px 0 2px' }}>Room {data.room} — room check</h2>
      <p style={{ fontSize: 14, color: '#6b7280', marginTop: 0 }}>Tap + for everything taken from the minibar.</p>
      {data.items.length === 0 && <p>No minibar items are set up — write what you found in the note.</p>}
      {data.items.map(i => (
        <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{i.name}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{fmtIDR(i.price)}</div>
          </div>
          <button style={round} onClick={() => step(i.id, -1)} disabled={!qty[i.id]}>−</button>
          <div style={{ width: 28, textAlign: 'center', fontSize: 18, fontWeight: 700 }}>{qty[i.id] || 0}</div>
          <button style={round} onClick={() => step(i.id, 1)}>+</button>
        </div>
      ))}
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note for front desk (damage, missing item…)" rows={2}
        style={{ width: '100%', marginTop: 14, padding: 10, borderRadius: 10, border: '1px solid #d1d5db', fontSize: 15, boxSizing: 'border-box' }} />
      <div style={{ margin: '14px 0', fontSize: 16 }}>
        {picked.length ? <><b>{picked.reduce((s, i) => s + qty[i.id], 0)}</b> item(s) · <b>{fmtIDR(total)}</b></> : 'Nothing taken'}
      </div>
      {!confirming ? (
        <button style={{ ...btn, background: '#5C1A2E', color: '#fff' }} onClick={() => setConfirming(true)}>
          {picked.length ? 'Send to front desk' : 'Nothing taken — send'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ ...btn, background: '#e5e7eb' }} onClick={() => setConfirming(false)} disabled={busy}>Back</button>
          <button style={{ ...btn, background: '#15803D', color: '#fff' }} onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Yes, send'}</button>
        </div>
      )}
    </div>
  );
}
