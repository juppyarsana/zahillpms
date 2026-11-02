// A phone number as wa.me wants it: digits only, Indonesian numbers from 62.
// A number typed with its own + country code stays as it is.
export function waNumber(raw) {
  const typed = String(raw || '').trim();
  let n = typed.replace(/\D/g, '');
  if (!n) return '';
  if (!typed.startsWith('+')) {
    if (n.startsWith('0')) n = '62' + n.slice(1);
    else if (!n.startsWith('62')) n = '62' + n;
  }
  return n;
}
