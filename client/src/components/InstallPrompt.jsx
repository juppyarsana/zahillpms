import { useEffect, useState } from 'react';
import { installEvent, onInstallEvent, promptInstall } from '../lib/pwaInstall';

// "Install this app" on a phone or tablet browser. Android / Chrome: a button
// that opens the phone's own install window. iPhone / iPad: Apple gives a
// page no way to install itself, so it says where to tap. Never shown inside
// the installed app, and "Not now" keeps it away for a month.
const DISMISS_KEY = 'installPromptDismissedAt';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches;
// iPadOS says it is a Mac — a Mac with a touch screen is an iPad.
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Chrome / Firefox / Edge on iPhone can't add to the home screen the same way.
const isIosSafari = () => isIos() && !/crios|fxios|edgios/i.test(navigator.userAgent);
function recentlyDismissed() {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS; } catch { return false; }
}

export default function InstallPrompt({ name }) {
  const [event, setEvent] = useState(installEvent());
  const [hidden, setHidden] = useState(() => isStandalone() || !isTouchDevice() || recentlyDismissed());

  useEffect(() => onInstallEvent(setEvent), []);

  if (hidden) return null;
  const ios = isIosSafari();
  if (!event && !ios) return null;

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setHidden(true);
  }
  async function install() {
    if (await promptInstall()) setHidden(true);
  }

  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, zIndex: 999,   // under "New version available"
      bottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + 12px)',
      background: '#5C1A2E', color: 'white', borderRadius: 12, padding: '12px 14px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)', fontSize: 13, maxWidth: 460, margin: '0 auto',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Install {name || 'this app'} on this device</div>
      <div style={{ opacity: 0.85, lineHeight: 1.4 }}>
        {ios
          ? <>Tap <b>Share</b> (the square with an arrow) at the bottom of Safari, then <b>Add to Home Screen</b>.</>
          : 'Opens from the home screen like any app, full screen.'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={dismiss} style={{ background: 'transparent', color: 'rgba(255,255,255,0.8)', border: 'none', padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
          {ios ? 'Got it' : 'Not now'}
        </button>
        {!ios && (
          <button onClick={install} style={{ background: 'white', color: '#5C1A2E', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
            Install
          </button>
        )}
      </div>
    </div>
  );
}
