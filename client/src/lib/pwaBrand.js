// The property this device belongs to, remembered so the login screen and the
// installed app carry its name and logo. The app is one deployment for every
// property: the built-in manifest can only say "Zahill PMS", so once the slug
// is known the page's manifest link is pointed at the property's own
// (server/routes/public.js) — that is what a phone reads when the app is
// added to the home screen. Device-local on purpose (like Room Display's room
// id): it is about this phone, not about the user.
const SLUG_KEY = 'lastPropertySlug';
const NAME_KEY = 'lastPropertyName';

function headTag(selector, make) {
  let el = document.head.querySelector(selector);
  if (!el) { el = make(); document.head.appendChild(el); }
  return el;
}
const link = rel => headTag(`link[rel="${rel}"]`, () => Object.assign(document.createElement('link'), { rel }));
const meta = name => headTag(`meta[name="${name}"]`, () => Object.assign(document.createElement('meta'), { name }));

export function rememberedSlug() {
  try { return localStorage.getItem(SLUG_KEY) || ''; } catch { return ''; }
}

// Points the manifest, the iPhone home-screen icon / name and the tab title
// at the property. `name` is optional (the last known one is used).
export function applyPropertyBrand(slug, name) {
  slug = String(slug || '').trim();
  if (!slug) return;
  try {
    localStorage.setItem(SLUG_KEY, slug);
    if (name) localStorage.setItem(NAME_KEY, name);
    else name = localStorage.getItem(NAME_KEY) || '';
  } catch { /* private mode: still brand this page */ }
  const base = `/api/public/properties/${encodeURIComponent(slug)}`;
  const manifest = `${base}/manifest.webmanifest`;
  const m = link('manifest');
  if (m.getAttribute('href') !== manifest) m.setAttribute('href', manifest);
  // iPhone reads these (not the manifest) when "Add to Home Screen" is tapped.
  link('apple-touch-icon').setAttribute('href', `${base}/icon/apple.png`);
  if (name) {
    meta('apple-mobile-web-app-title').setAttribute('content', name);
    document.title = name;
  }
}
