import { Component } from 'react';

// A tablet nobody is watching must not sit on a blank page: if any screen
// throws while drawing, say so and load the app again by itself. Reloads that
// keep failing slow down (a crash on every start would otherwise spin).
const KEY = 'crashReloads';
const QUICK_MS = 5_000;
const SLOW_MS = 60_000;
const WINDOW_MS = 5 * 60 * 1000;

function recentCrashes() {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) || '[]').filter(t => Date.now() - t < WINDOW_MS);
    list.push(Date.now());
    sessionStorage.setItem(KEY, JSON.stringify(list));
    return list.length;
  } catch { return 1; }
}

export default class ErrorBoundary extends Component {
  state = { crashed: false };

  static getDerivedStateFromError() { return { crashed: true }; }

  componentDidCatch(error) {
    console.error('[Display] screen crashed, reloading:', error);
    this.timer = setTimeout(() => window.location.reload(), recentCrashes() > 3 ? SLOW_MS : QUICK_MS);
  }

  componentWillUnmount() { clearTimeout(this.timer); }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="w-screen h-dvh flex flex-col items-center justify-center bg-app-deep gap-4" onClick={() => window.location.reload()}>
        <img src="/logo.png" alt="" style={{ width: 64, height: 64, objectFit: 'contain', opacity: 0.3 }} />
        <p className="text-xs uppercase tracking-[0.3em] text-faint">One moment — restarting</p>
      </div>
    );
  }
}
