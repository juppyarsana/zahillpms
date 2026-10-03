// What the guest still owes at checkout (server: services/checkoutBalance.js —
// whole stay; 0 for a stay billed to its agent; extras only for an OTA stay).
//
//   <BalanceLine b={row} />       one line for the Check-in / out lists
//   <CheckoutBalanceBlock … />    in the checkout window: green "no balance due",
//                                 or red "still owes Rp X" + Record payment +
//                                 "check out anyway" reason (the server refuses
//                                 checkout without it — BALANCE_DUE).
import { Link } from 'react-router-dom';

const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

const TEXT = {
  en: {
    none: '✓ No balance due', due: amount => `⚠ Balance due ${amount}`,
    billed: name => `room & extras billed to ${name}`, ota: 'room paid via the OTA',
    owes: amount => <>The guest still owes <strong>{amount}</strong> (whole stay incl. extras, service &amp; tax).</>,
    take: 'Record payment →',
    or: 'Or, if it really can’t be paid now (e.g. the company pays later):',
    placeholder: 'Reason to check out with a balance due',
    note: 'The amount stays owed on the folio and Balance Due, is written to Edit History, and the owner is told.',
    agentNote: name => `The room and extras go on ${name}’s bill — the agent pays the hotel.`,
    groupNote: amount => `The room is on the group’s bill — the group still owes ${amount} (collected from the group, not this guest).`,
    groupPaid: 'The room is on the group’s bill.',
  },
  id: {
    none: '✓ Tidak ada tagihan', due: amount => `⚠ Tagihan ${amount}`,
    billed: name => `kamar & tambahan ditagih ke ${name}`, ota: 'kamar dibayar lewat OTA',
    owes: amount => <>Tamu masih harus membayar <strong>{amount}</strong> (seluruh menginap termasuk tambahan, service &amp; pajak).</>,
    take: 'Catat pembayaran →',
    or: 'Atau, jika memang belum bisa dibayar sekarang (mis. perusahaan bayar nanti):',
    placeholder: 'Alasan check-out dengan tagihan',
    note: 'Sisa tagihan tetap tercatat di folio dan Balance Due, masuk Riwayat Perubahan, dan owner diberi tahu.',
    agentNote: name => `Kamar dan tambahan masuk tagihan ${name} — agen yang membayar hotel.`,
    groupNote: amount => `Kamar masuk tagihan grup — grup masih harus membayar ${amount} (ditagih ke grup, bukan tamu ini).`,
    groupPaid: 'Kamar masuk tagihan grup.',
  },
};

const owedOf = b => (b.guest_balance_due == null ? null : Number(b.guest_balance_due) || 0);

export function BalanceLine({ b, lang = 'en' }) {
  const t = TEXT[lang] || TEXT.en;
  const owed = owedOf(b);
  if (owed == null) return null;
  const hint = b.agent_billed ? t.billed(b.agent_name || 'the agent') : null;
  return (
    <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600, color: owed > 0 ? '#DC2626' : 'var(--green)' }}>
      {owed > 0 ? t.due(fmtIDR(owed)) : t.none}
      {hint && <div style={{ fontWeight: 400, color: 'var(--text-muted, #6b7280)' }}>{hint}</div>}
    </div>
  );
}

export function CheckoutBalanceBlock({ booking, lang = 'en', reason, setReason, onRecordPayment }) {
  const t = TEXT[lang] || TEXT.en;
  const owed = owedOf(booking);
  if (owed == null) return null;
  // A room of a group billed as a whole (migration 097): the guest owes only
  // the room's own extras; the group's balance is the group's.
  const groupLine = booking.group_owed == null ? null : (
    <div style={{ fontSize: 12, fontWeight: 400, marginTop: 4 }}>
      {booking.group_owed > 0 ? t.groupNote(fmtIDR(booking.group_owed)) : t.groupPaid}
      {booking.reservation_group_id && <> <Link to={`/reservations/group/${booking.reservation_group_id}`}>→</Link></>}
    </div>
  );
  if (owed <= 0) {
    return (
      <div className="alert alert-success" style={{ marginTop: 0, marginBottom: 12 }}>
        <div>
          {t.none}
          {booking.agent_billed && <div style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>{t.agentNote(booking.agent_name || 'the agent')}</div>}
          {groupLine}
        </div>
      </div>
    );
  }
  return (
    <div className="alert alert-error" style={{ marginTop: 0, marginBottom: 12 }}>
      <div style={{ width: '100%' }}>
        <div>{t.owes(fmtIDR(owed))}{' '}
          <Link to={`/reservations/${booking.id}#record-payment`} onClick={onRecordPayment} style={{ fontWeight: 700 }}>{t.take}</Link>
        </div>
        {groupLine}
        <div style={{ fontSize: 12, marginTop: 10 }}>{t.or}</div>
        <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder={t.placeholder}
          style={{ marginTop: 6, background: '#fff' }} />
        <div style={{ fontSize: 11, marginTop: 6 }}>{t.note}</div>
      </div>
    </div>
  );
}

// Checkout blocked until paid, unless a reason is given.
export const checkoutBlocked = (booking, reason) => (owedOf(booking) || 0) > 0 && !String(reason || '').trim();
