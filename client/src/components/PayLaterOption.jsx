import { useState } from 'react';

// "Check in anyway, pay later" — shown under the "payment not received" block
// on Check-in/out and Quick Check-in. Front desk can let a guest in without
// full payment (EDC down, etc.); a reason is required, the server logs it to
// Edit History, and the unpaid amount stays as a balance due (Balance Due,
// checkout warning, folio). `lang` matches the page: 'en' or 'id'.
const TEXT = {
  en: {
    or: 'Or, if the guest can’t pay right now:',
    placeholder: 'Reason — e.g. EDC error, will pay before check-out',
    button: 'Check in anyway — pay later',
    note: 'The unpaid amount stays as balance due and is recorded in Edit History.',
  },
  id: {
    or: 'Atau, jika tamu belum bisa bayar sekarang:',
    placeholder: 'Alasan — mis. EDC error, bayar sebelum check-out',
    button: 'Check-in dulu, bayar nanti',
    note: 'Sisa pembayaran tetap tercatat sebagai tagihan dan masuk Riwayat Perubahan.',
  },
};

export default function PayLaterOption({ lang = 'en', onConfirm, busy = false }) {
  const t = TEXT[lang] || TEXT.en;
  const [reason, setReason] = useState('');
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>{t.or}</div>
      <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder={t.placeholder} style={{ marginBottom: 8 }} />
      <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>
        {t.button}
      </button>
      <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>{t.note}</div>
    </div>
  );
}
