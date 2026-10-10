// "Is anyone using this tablet right now?" — so the app only restarts itself
// (a new version, the nightly refresh) when nobody would notice. Idle = no
// touch for a while AND nothing in progress (a call, a ringing alarm, the
// housekeeping check — App.jsx reports those with setBusy).
const IDLE_MS = 2 * 60 * 1000;
const startedAt = Date.now();
let lastTouchAt = Date.now();
let busy = false;

const touched = () => { lastTouchAt = Date.now(); };
for (const type of ['pointerdown', 'touchstart', 'keydown']) {
  window.addEventListener(type, touched, { passive: true, capture: true });
}

export function setBusy(value) { busy = !!value; }
export function canRestart() { return !busy && Date.now() - lastTouchAt > IDLE_MS; }
export function runningFor() { return Date.now() - startedAt; }
