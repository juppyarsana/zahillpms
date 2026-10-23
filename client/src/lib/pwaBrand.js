// The property this device belongs to, remembered so the login screen and the
// installed app carry its name and logo. The app is one deployment for every
// property: the built-in manifest can only say "Zahill PMS", so once the slug
// is known the page's manifest link is pointed at the property's own
// (server/routes/public.js) — that is what a phone reads when the app is
// added to the home screen. Device-local on purpose (like Room Display's room
// id): it is about this phone, not about the user.
const SLUG_KEY = 'lastPropertySlug';
const NAME_KEY = 'lastPropertyName';
const COLOR_KEY = 'lastPropertyAppColor';

function headTag(selector, make) {
  let el = document.head.querySelector(selector);
  if (!el) { el = make(); document.head.appendChild(el); }
  return el;
}
const link = rel => headTag(`link[rel="${rel}"]`, () => Object.assign(document.createElement('link'), { rel }));
const meta = name => headTag(`meta[name="${name}"]`, () => Object.assign(document.createElement('meta'), { name }));

// The logo to show for a property: its own, or (none uploaded yet) its letter
// icon — never another property's. No property known: the platform's.
export function propertyLogo(branding, slug) {
  if (branding?.logo_url) return branding.logo_url;
  const s = slug || branding?.slug;
  return branding && s ? `/api/public/properties/${encodeURIComponent(s)}/icon/192.png` : '/logo.png';
}

export function rememberedSlug() {
  try { return localStorage.getItem(SLUG_KEY) || ''; } catch { return ''; }
}

// The staff app's main colour (property_settings.app_color, Superadmin →
// Branding): the --green-dark / -mid / -light tokens every screen reads.
// null / '' = the app's own maroon (tokens.css).
const HEX = /^#[0-9a-f]{6}$/i;
const mix = (hex, to, t) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const d = [1, 3, 5].map(i => parseInt(to.slice(i, i + 2), 16));
  return '#' + c.map((v, i) => Math.round(v + (d[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
export function applyAppColor(color) {
  const root = document.documentElement.style;
  const names = ['--green-dark', '--green-mid', '--green-light', '--ch-direct'];
  if (!HEX.test(color || '')) { names.forEach(n => root.removeProperty(n)); return; }
  root.setProperty('--green-dark', color);
  root.setProperty('--green-mid', mix(color, '#ffffff', 0.14));
  root.setProperty('--green-light', mix(color, '#ffffff', 0.89));
  root.setProperty('--ch-direct', color);
  meta('theme-color').setAttribute('content', color);
}

// Points the manifest, the iPhone home-screen icon / name, the tab icon, the
// tab title and the app colour at the property. Everything but the slug is
// optional: what isn't given is the last known value on this device.
// opts: { color: app_color (null = the app's own) }
export function applyPropertyBrand(slug, name, opts) {
  slug = String(slug || '').trim();
  if (!slug) return;
  let color;
  try {
    // another property than last time: don't carry the old one's colour
    if (localStorage.getItem(SLUG_KEY) !== slug && !opts) localStorage.removeItem(COLOR_KEY);
    localStorage.setItem(SLUG_KEY, slug);
    if (name) localStorage.setItem(NAME_KEY, name);
    else name = localStorage.getItem(NAME_KEY) || '';
    if (opts) {
      if (opts.color) localStorage.setItem(COLOR_KEY, opts.color); else localStorage.removeItem(COLOR_KEY);
    }
    color = localStorage.getItem(COLOR_KEY) || null;
  } catch {
    color = opts?.color || null;
  }
  applyAppColor(color);
  const base = `/api/public/properties/${encodeURIComponent(slug)}`;
  const manifest = `${base}/manifest.webmanifest`;
  const m = link('manifest');
  if (m.getAttribute('href') !== manifest) m.setAttribute('href', manifest);
  // iPhone reads these (not the manifest) when "Add to Home Screen" is tapped.
  link('apple-touch-icon').setAttribute('href', `${base}/icon/apple.png`);
  // The browser tab's icon: the property's logo, or its first letter when it has none.
  const icon = link('icon');
  icon.setAttribute('type', 'image/png');
  icon.setAttribute('href', `${base}/icon/192.png${color ? `?c=${color.slice(1)}` : ''}`);
  if (name) {
    meta('apple-mobile-web-app-title').setAttribute('content', name);
    document.title = name;
  }
}
