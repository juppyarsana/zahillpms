// Room Display theming — day/night + per-property accent.
//
// Day/night is automatic by local time (light 06:00–18:00, dark
// otherwise), re-checked every minute so a tablet left on flips at
// dawn/dusk without a reload. A debug override (set from DebugMenu)
// forces one theme — device-local, same spirit as the stored room
// id/token. A per-property config override can layer on later.

const OVERRIDE_KEY = 'themeOverride'; // '', 'light', 'dark'
const DAY_START = 6;   // inclusive
const DAY_END = 18;    // exclusive

function autoThemeForNow(date = new Date()) {
  const h = date.getHours();
  return h >= DAY_START && h < DAY_END ? 'light' : 'dark';
}

export function getThemeOverride() {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return v === 'light' || v === 'dark' ? v : '';
  } catch {
    return '';
  }
}

export function setThemeOverride(value) {
  try {
    if (value === 'light' || value === 'dark') localStorage.setItem(OVERRIDE_KEY, value);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* private mode / disabled storage — override just won't persist */ }
  applyTheme();
}

export function resolveTheme() {
  return getThemeOverride() || autoThemeForNow();
}

export function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolveTheme());
}

// Call once at boot. Applies immediately, then keeps the auto
// schedule honest. Returns a cleanup fn.
export function startThemeWatcher() {
  applyTheme();
  const id = setInterval(applyTheme, 60_000);
  return () => clearInterval(id);
}

// --- Accent (brand_color) -------------------------------------------------

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// Relative luminance (sRGB) — decides whether text sitting on an
// accent-filled surface should be dark or light.
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// Applies the property's brand color as the accent. No-op on a
// missing/malformed value so the CSS defaults stand.
export function applyAccent(brandColor) {
  const rgb = hexToRgb(brandColor);
  if (!rgb) return;
  const root = document.documentElement.style;
  root.setProperty('--accent', `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`);
  root.setProperty('--accent-rgb', `${rgb[0]} ${rgb[1]} ${rgb[2]}`);
  root.setProperty('--accent-contrast', luminance(rgb) > 0.45 ? '#12100c' : '#ffffff');
}
