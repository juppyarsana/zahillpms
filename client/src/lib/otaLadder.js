// Filling an OTA price ladder grid: a % on the row above, or a copy of another
// ladder + n%. Only fills the grid; what is saved is the prices themselves.

// "1,511,250" / "1.511.250" / "1511250.5" → a number; '' → null; bad → NaN.
export function parsePrice(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const n = Number(t.replace(/[.,\s](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

// "5" / "7,5" / "-3" → a number; '' → null; bad → NaN.
export function parsePct(v) {
  const t = String(v ?? '').trim().replace(/%$/, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export const fmtPrice = n => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });

// to = 0 means no rounding (kept to 2 decimals, the most a price can have).
export function roundPrice(n, to) {
  return to > 0 ? Math.round(n / to) * to : Math.round(n * 100) / 100;
}

// Each row with a % = the row above + that %, per room type, rounded; the next
// row builds on the rounded price. The first row, and a row with no %, stay as
// typed. A room type empty on the row above stays empty.
// rows: [{ prices: [text], increase: text }] → the same rows with new prices.
export function workOutPrices(rows, roundTo) {
  const out = rows.map(r => ({ ...r, prices: [...r.prices] }));
  for (let i = 1; i < out.length; i++) {
    const pct = parsePct(out[i].increase);
    if (pct === null || Number.isNaN(pct)) continue;
    out[i].prices = out[i].prices.map((_, c) => {
      const above = parsePrice(out[i - 1].prices[c]);
      if (above === null || Number.isNaN(above)) return '';
      return fmtPrice(roundPrice(above * (1 + pct / 100), roundTo));
    });
  }
  return out;
}

// A saved ladder as grid rows for `roomTypes`, each price + pct and rounded.
// A room type the source doesn't have stays empty.
export function copyLadder(ladder, roomTypes, pct, roundTo) {
  return ladder.tiers.map((t, i) => ({
    up_to: String(t),
    increase: ladder.increases?.[i] != null ? String(ladder.increases[i]) : '',
    prices: roomTypes.map(rt => {
      const p = ladder.prices[rt.id]?.[t];
      return p != null ? fmtPrice(pct ? roundPrice(p * (1 + pct / 100), roundTo) : p) : '';
    }),
  }));
}
