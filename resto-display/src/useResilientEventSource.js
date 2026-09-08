import { useEffect, useRef } from 'react';

// Verbatim copy of room-display/src/useResilientEventSource.js — no shared
// package between the standalone kiosk/guest apps in this monorepo, each
// vendors its own copy (see CLAUDE.md). A plain EventSource leans entirely on
// the browser's own retry behavior, which can miss a connection that died
// silently (mobile network handoff, a router dropping an idle NAT mapping);
// this wraps EventSource with a heartbeat watchdog (server sends a real
// `data: {"type":"heartbeat"}` event every 25s — not an SSE comment, those
// are invisible to onmessage), explicit onerror handling with capped
// exponential backoff, and forced reconnect on tab-visible / browser `online`.
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
        backoff = BASE_BACKOFF_MS;
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
