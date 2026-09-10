// Room Display kiosk bridge — the hooks that light up only when this PWA is
// running inside the native Android wrapper (room-display-kiosk/), which
// injects `window.AndroidKiosk` via addJavascriptInterface.
//
// In a plain browser none of this does anything: isKiosk() is false, the
// chip and the debug "Device" section hide themselves, and bootstrapKiosk()
// still handles ?room=&token= so a wrapper launch URL is also pasteable for
// testing.

const bridge = () => (typeof window !== 'undefined' ? window.AndroidKiosk : null);

export function isKiosk() {
  return !!bridge();
}

function parse(fn) {
  try {
    const raw = bridge()?.[fn]?.();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// { roomId, baseUrl, appVersion, platform } — deliberately NOT the token
// (the wrapper passes that in the launch URL instead; see bootstrapKiosk).
export function getKioskConfig() {
  return parse('getConfig');
}

// Opens the APK's own Settings screen (Room ID / token / URL).
export function openKioskSettings() {
  try {
    bridge()?.openSettings?.();
    return true;
  } catch {
    return false;
  }
}

// Live device health snapshot — same snake_case keys the backend
// /telemetry endpoint accepts. Null in a browser.
export function getKioskStats() {
  return parse('getDeviceStats');
}

// Seed roomId / displayToken from ?room=&token= (the wrapper's launch URL,
// also handy for browser testing), then strip them from the address bar.
// Inside the kiosk wrapper, the APK's stored config is the single source of
// truth — force localStorage to match it so the PWA can't drift from what
// the APK posts telemetry for (e.g. after someone used the PWA debug
// menu's "Change Room ID"). Change the room from the APK Settings screen.
// MUST run before App.jsx's useState initialisers read localStorage.
export function bootstrapKiosk() {
  try {
    const q = new URLSearchParams(window.location.search);
    const room = q.get('room');
    const token = q.get('token');
    if (room) localStorage.setItem('roomId', room);
    if (token) localStorage.setItem('displayToken', token);
    if (room || token) {
      q.delete('room');
      q.delete('token');
      const qs = q.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }

    const cfg = getKioskConfig();
    if (cfg?.roomId) localStorage.setItem('roomId', String(cfg.roomId));
  } catch {
    /* storage disabled / weird URL — App.jsx's SetupScreen still covers it */
  }
}

// Poll the native stats every `intervalMs` and hand each snapshot to `cb`.
// No-op (returns a noop cleanup) outside the wrapper. Returns a cleanup fn.
export function startKioskStatsWatcher(cb, intervalMs = 30_000) {
  if (!isKiosk()) return () => {};
  const tick = () => {
    const s = getKioskStats();
    if (s) cb(s);
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
