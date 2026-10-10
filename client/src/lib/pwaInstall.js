// Android / Chrome tells a page it can be installed with `beforeinstallprompt`
// — once, and often before React has mounted. Kept here from the moment the
// app starts (imported by main.jsx) so components/InstallPrompt.jsx can offer
// it whenever it shows.
let deferred = null;
const listeners = new Set();
const tell = () => listeners.forEach(fn => fn(deferred));

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();   // no browser mini-bar: the app shows its own banner
  deferred = e;
  tell();
});
window.addEventListener('appinstalled', () => { deferred = null; tell(); });

export const installEvent = () => deferred;
export function onInstallEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
// Opens the phone's own install window. Resolves true when the user accepted.
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;   // an event can be used once
  tell();
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}
