import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { canRestart } from '../idle';

// A room tablet stays open for weeks and nobody presses "Refresh" on it, so:
//  - it looks for a new version every 30 minutes (a browser only checks when a
//    page is opened), and
//  - it installs one by itself once the tablet is idle (no touch for a couple
//    of minutes, no call / alarm in progress — see idle.js).
// The bar with the button stays for staff who want it now.
const UPDATE_CHECK_MS = 30 * 60 * 1000;
const IDLE_CHECK_MS = 15_000;
const RELOAD_FALLBACK_MS = 4_000;

export default function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => { registration.update().catch(() => {}); }, UPDATE_CHECK_MS);
    },
  });
  const updating = useRef(false);

  function update() {
    if (updating.current) return;
    updating.current = true;
    updateServiceWorker(true).catch(() => {});
    // If the new version never takes over, load the page again anyway.
    setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
  }

  useEffect(() => {
    if (!needRefresh) return;
    const id = setInterval(() => { if (canRestart() && navigator.onLine !== false) update(); }, IDLE_CHECK_MS);
    return () => clearInterval(id);
  }, [needRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!needRefresh) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 32,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      background: 'var(--pane)',
      border: '1px solid rgb(var(--accent-rgb) / 0.35)',
      borderRadius: 16,
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      whiteSpace: 'nowrap',
    }}>
      <span className="material-symbols-outlined" style={{ color: 'var(--accent)', fontSize: 22 }}>system_update</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Update available</span>
      <button
        onClick={update}
        style={{
          background: 'var(--accent)',
          color: 'var(--accent-contrast)',
          border: 'none',
          borderRadius: 10,
          padding: '7px 18px',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Refresh
      </button>
    </div>
  );
}
