import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Check for a new deploy every 30 min while the tab stays open.
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;
// If the normal skipWaiting -> controllerchange -> reload path stalls, bail out.
const RELOAD_FALLBACK_MS = 3500;

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        registration.update().catch(() => {});
      }, UPDATE_CHECK_INTERVAL);
    },
  });

  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fallbackTimer = useRef(null);

  useEffect(() => {
    // A fresh update showing up re-opens the prompt even if a previous one was dismissed.
    if (needRefresh) setDismissed(false);
  }, [needRefresh]);

  useEffect(() => () => clearTimeout(fallbackTimer.current), []);

  async function handleRefresh() {
    setRefreshing(true);

    // Normal path: tell the waiting SW to take over; it reloads on controllerchange.
    try {
      await updateServiceWorker(true);
    } catch {
      /* fall through to the hard reload below */
    }

    // If controllerchange never fires (no waiting worker, stuck SW, stale cache),
    // force a clean reload ourselves.
    fallbackTimer.current = setTimeout(async () => {
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      } catch {
        /* ignore */
      }
      try {
        const keys = await caches?.keys?.() ?? [];
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* ignore */
      }
      window.location.reload();
    }, RELOAD_FALLBACK_MS);
  }

  if (!needRefresh || dismissed) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + 12px)',
      left: 16,
      zIndex: 1000,
      background: '#5C1A2E',
      color: 'white',
      borderRadius: 10,
      padding: '8px 10px 8px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      maxWidth: 'calc(100vw - 32px)',
      fontSize: 13,
    }}>
      <span style={{ fontWeight: 600 }}>New version available</span>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        style={{
          background: 'white',
          color: '#5C1A2E',
          border: 'none',
          borderRadius: 8,
          padding: '5px 12px',
          fontWeight: 700,
          fontSize: 13,
          cursor: refreshing ? 'default' : 'pointer',
          fontFamily: 'inherit',
          opacity: refreshing ? 0.7 : 1,
        }}
      >
        {refreshing ? 'Updating…' : 'Refresh'}
      </button>
      <button
        onClick={() => { setDismissed(true); setNeedRefresh(false); }}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          color: 'rgba(255,255,255,0.7)',
          border: 'none',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          padding: '0 2px',
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  );
}
