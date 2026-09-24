import { useState, useEffect } from 'react';
import api from '../services/api';

// Shown in the checkout forms when the guest is leaving BEFORE the booked
// check-out date (e.g. checked in today, has to leave tonight). Front desk
// chooses what to charge; the server re-prices the booking to the stay
// actually charged, releases the room and logs the reason
// (PUT /api/checkin/checkout/:id/complete, early_departure).
//   stayed — the nights used (a same-day departure counts as 1 night)
//   full   — the whole booking (no refund)
//   custom — another total for the stay
// Reports { early, valid, early_departure } to the parent through onChange.
// lang: 'en' | 'id' (Quick Check-in is Indonesian).

const TEXT = {
  en: {
    title: 'Leaving early',
    booked: (n, d) => `Booked ${n} night${n === 1 ? '' : 's'}, until ${d}.`,
    stayed: (n, amt, same) => `Charge the ${n} night${n === 1 ? '' : 's'} used — ${amt}${same ? ' (same-day departure counts as 1 night)' : ''}`,
    full: amt => `Charge the full booking — ${amt} (no refund)`,
    custom: 'Other amount for the stay',
    reason: 'Reason — e.g. family emergency',
    note: 'The booking is changed to the stay charged and the room is released for the remaining nights.',
    owes: (paid, owe) => <>Guest has paid {paid} → <b>still owes {owe}</b> — collect before they leave.</>,
    refund: (paid, back) => <>Guest has paid {paid} → <b>refund {back}</b> to the guest.</>,
    settled: paid => <>Guest has paid {paid} → nothing left to pay.</>,
  },
  id: {
    title: 'Check-out lebih awal',
    booked: (n, d) => `Booking ${n} malam, sampai ${d}.`,
    stayed: (n, amt, same) => `Tagih ${n} malam yang dipakai — ${amt}${same ? ' (check-out di hari yang sama dihitung 1 malam)' : ''}`,
    full: amt => `Tagih penuh sesuai booking — ${amt} (tidak ada refund)`,
    custom: 'Jumlah lain untuk menginap ini',
    reason: 'Alasan — mis. urusan keluarga mendadak',
    note: 'Booking diubah sesuai malam yang ditagih dan kamar dilepas untuk malam sisanya.',
    owes: (paid, owe) => <>Tamu sudah bayar {paid} → <b>masih kurang {owe}</b> — tagih sebelum tamu pergi.</>,
    refund: (paid, back) => <>Tamu sudah bayar {paid} → <b>kembalikan {back}</b> ke tamu.</>,
    settled: paid => <>Tamu sudah bayar {paid} → tidak ada sisa tagihan.</>,
  },
};

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayMs = s => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');
const fmtIDR = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const fmtDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

export default function EarlyDepartureOption({ booking, onChange, lang = 'en' }) {
  const t = TEXT[lang] || TEXT.en;
  const today = localToday();
  const ci = String(booking?.check_in_date || '').slice(0, 10);
  const co = String(booking?.check_out_date || '').slice(0, 10);
  const early = !!booking && booking.status === 'checked_in' && !!co && today < co;
  const bookedNights = early ? Math.round((dayMs(co) - dayMs(ci)) / 86400000) : 0;
  const stayedNights = early ? Math.max(1, Math.round((dayMs(today) - dayMs(ci)) / 86400000)) : 0;
  const payable = (parseFloat(booking?.total_amount) || 0) - (parseFloat(booking?.discount_amount) || 0);
  const stayedAmount = bookedNights ? payable * stayedNights / bookedNights : 0;

  const [charge, setCharge] = useState('stayed');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // What the guest has paid and currently owes for the whole stay (incl.
  // extras charged to the room) — to show what's left after this choice.
  const [estimate, setEstimate] = useState(null);
  useEffect(() => {
    if (!early || !booking?.id) return;
    let cancelled = false;
    api.get(`/api/folio/${booking.id}/estimate`)
      .then(r => { if (!cancelled) setEstimate(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [early, booking?.id]);

  useEffect(() => {
    const amt = parseFloat(amount);
    const valid = !early || (!!reason.trim() && (charge !== 'custom' || (Number.isFinite(amt) && amt >= 0)));
    onChange?.({
      early,
      valid,
      early_departure: early ? { charge, reason: reason.trim(), ...(charge === 'custom' ? { amount: amt } : {}) } : null,
    });
  }, [early, charge, amount, reason]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!early) return null;
  return (
    <div style={{ border: '1px solid #FCD34D', background: '#FFFBEB', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>⚠ {t.title}</div>
      <div style={{ fontSize: 12, color: '#92400E', marginBottom: 8 }}>{t.booked(bookedNights, fmtDate(co))}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <label className="flex gap-2" style={{ cursor: 'pointer', alignItems: 'center' }}>
          <input type="radio" name="earlyCharge" checked={charge === 'stayed'} onChange={() => setCharge('stayed')} />
          {t.stayed(stayedNights, fmtIDR(stayedAmount), ci === today)}
        </label>
        <label className="flex gap-2" style={{ cursor: 'pointer', alignItems: 'center' }}>
          <input type="radio" name="earlyCharge" checked={charge === 'full'} onChange={() => setCharge('full')} />
          {t.full(fmtIDR(payable))}
        </label>
        <label className="flex gap-2" style={{ cursor: 'pointer', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="radio" name="earlyCharge" checked={charge === 'custom'} onChange={() => setCharge('custom')} />
          {t.custom}
          {charge === 'custom' && (
            <input className="form-input" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)}
              style={{ maxWidth: 160, padding: '4px 8px' }} aria-label="Amount" />
          )}
        </label>
      </div>
      {estimate && (() => {
        // Balance for the whole booked stay, minus the part of the room price
        // that won't be charged any more (extras and payments are unchanged).
        const newCharge = charge === 'stayed' ? stayedAmount
          : charge === 'full' ? payable
          : (Number.isFinite(parseFloat(amount)) ? parseFloat(amount) : null);
        if (newCharge == null) return null;
        const paid = (estimate.payments || []).filter(p => p.status === 'received').reduce((s, p) => s + parseFloat(p.amount), 0);
        const after = Math.round(parseFloat(estimate.balance_due) - (payable - newCharge));
        return (
          <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, fontSize: 13,
            background: after > 0 ? '#FEE2E2' : after < 0 ? '#DBEAFE' : '#DCFCE7',
            color: after > 0 ? '#991B1B' : after < 0 ? '#1E3A8A' : '#166534' }}>
            {after > 0 ? t.owes(fmtIDR(paid), fmtIDR(after)) : after < 0 ? t.refund(fmtIDR(paid), fmtIDR(-after)) : t.settled(fmtIDR(paid))}
          </div>
        );
      })()}
      <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder={t.reason} style={{ marginTop: 8 }} />
      <div style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>{t.note}</div>
    </div>
  );
}
