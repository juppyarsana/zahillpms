import { useEffect, useRef } from 'react';

// A plain EventSource leans entirely on the browser's own retry behavior,
// which can miss a connection that died silently (mobile network handoff, a
// router dropping an idle NAT mapping, a long WiFi hiccup) — the socket
// never gets a clean error, so onerror never fires and the app just stops
// receiving pushes with no indication anything is wrong. This wraps
// EventSource with:
//   - a heartbeat watchdog: the server sends a real `data: {"type":
//     "heartbeat"}` event every 25s (not an SSE comment — those are
//     invisible to onmessage) on every stream this hook is used for; if
//     nothing arrives for STALE_MS, the connection is presumed dead and
//     force-reconnected rather than trusted to recover on its own
//   - explicit onerror handling with capped exponential backoff, instead of
//     a no-op that hopes the browser's native retry is enough
//   - forced reconnect on tab-visible and on the browser's `online` event,
//     so a tablet that slept/lost network doesn't have to wait for the next
//     watchdog tick to notice it's back
const STALE_MS = 40_000; // > 25s server heartbeat + margin for jitter/latency
const WATCHDOG_MS = 5_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15_000;

export default function useResilientEventSource(url, onMessage) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!url) return;
    let es = null;
    let watchdogId = null;
    let reconnectTimer = null;
    let backoff = BASE_BACKOFF_MS;
    let closed = false;
    let lastEventAt = Date.now();

    function teardown() {
      if (es) { es.close(); es = null; }
    }

    function scheduleReconnect() {
      teardown();
      if (closed) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        connect();
      }, backoff);
    }

    function connect() {
      if (closed) return;
      lastEventAt = Date.now();
      es = new EventSource(url);

      es.onmessage = (e) => {
        lastEventAt = Date.now();
        backoff = BASE_BACKOFF_MS; // any successful traffic resets backoff
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'heartbeat') return;
        onMessageRef.current(msg);
      };

      es.onerror = () => scheduleReconnect();
    }

    function forceReconnect() {
      backoff = BASE_BACKOFF_MS;
      scheduleReconnect();
    }

    watchdogId = setInterval(() => {
      if (Date.now() - lastEventAt > STALE_MS) forceReconnect();
    }, WATCHDOG_MS);

    // Only reconnect on wake if the connection has actually gone stale (same
    // check the watchdog uses) — reconnecting unconditionally on every tab/
    // screen wake tears down a perfectly healthy connection, which silently
    // drops anything in flight on it (e.g. a call's offer/ICE candidates
    // arriving right as a tablet's screen wakes from sleep to answer).
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastEventAt > STALE_MS) forceReconnect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', forceReconnect);

    connect();

    return () => {
      closed = true;
      clearInterval(watchdogId);
      clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', forceReconnect);
      teardown();
    };
  }, [url]);
}
