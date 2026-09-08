// Per-property accent color — same mechanism as room-display/tv-display
// (src/theme.js there), minus the day/night switching, which doesn't apply
// to a staff work tool. Called with property.brand_color once fetched from
// GET /api/resto/context (staff) or /api/resto/guest/:qrToken/context (guest).

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// No-op on a missing/malformed value so the CSS defaults stand.
export function applyAccent(brandColor) {
  const rgb = hexToRgb(brandColor);
  if (!rgb) return;
  const root = document.documentElement.style;
  root.setProperty('--accent', `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`);
  root.setProperty('--accent-rgb', `${rgb[0]} ${rgb[1]} ${rgb[2]}`);
  root.setProperty('--accent-contrast', luminance(rgb) > 0.45 ? '#0a0d12' : '#ffffff');
}
