import { useEffect, useMemo, useState } from 'react';
import api from './api.js';

const POLL_MS = 15_000;

function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatDate(value) {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function getQueryValue(key) {
  return new URLSearchParams(window.location.search).get(key)?.trim() || '';
}

// ─── Shared background ──────────────────────────────────────────────────────

function TVBackground() {
  return (
    <>
      <img
        src="/hero.png"
        alt=""
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center',
          zIndex: 0,
        }}
      />
      {/* gradient: transparent top → near-black bottom */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1,
        background: 'linear-gradient(to top, #05070a 30%, rgba(5,7,10,0.65) 55%, rgba(5,7,10,0.25) 100%)',
      }} />
    </>
  );
}

// ─── Vacant screen ──────────────────────────────────────────────────────────

function VacantScreen({ unitName }) {
  const time = useClock();
  const h = time.getHours().toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');
  const ampm = time.getHours() >= 12 ? 'PM' : 'AM';
  const dateStr = time.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-bg-dark">
      <TVBackground />

      {/* Clock — top right */}
      <div className="absolute z-10 text-right"
        style={{ top: 'clamp(1.5rem, 3vh, 2.5rem)', right: 'clamp(1.5rem, 3vw, 2.5rem)' }}>
        <div className="flex items-end justify-end leading-none"
          style={{ gap: 'clamp(0.3rem, 0.6vw, 0.6rem)' }}>
          <span className="font-extralight text-white tracking-tighter"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', lineHeight: 1 }}>{h}:{m}</span>
          <span className="font-bold" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.5rem)', color: '#c5a358', marginBottom: '0.25em' }}>
            {ampm}
          </span>
        </div>
        <p className="font-bold uppercase text-slate-500"
          style={{ fontSize: 'clamp(0.55rem, 1vw, 0.75rem)', letterSpacing: '0.35em', marginTop: '0.25rem', color: '#e2e8f0' }}>
          {dateStr}
        </p>
      </div>

      {/* Center branding card */}
      <div className="absolute z-10 left-1/2 -translate-x-1/2 glass-card rounded-2xl flex flex-col items-center text-center"
        style={{
          bottom: 'clamp(3rem, 8vh, 6rem)',
          padding: 'clamp(2rem, 4vh, 3.5rem) clamp(3rem, 7vw, 6rem)',
          minWidth: 'clamp(280px, 38vw, 560px)',
        }}>
        <img
          src="/logo.png"
          alt="Birdnest Glamping"
          style={{ width: 'clamp(160px, 20vw, 300px)', marginBottom: 'clamp(0.5rem, 1.2vh, 1rem)' }}
        />
        <p className="font-bold uppercase tracking-[0.45em]"
          style={{ fontSize: 'clamp(0.55rem, 1vw, 0.75rem)', color: '#c5a358',
            marginBottom: 'clamp(0.75rem, 1.5vh, 1.25rem)' }}>
          Kintamani &middot; Bali
        </p>
        <div className="w-12 h-px" style={{ background: 'rgba(197,163,88,0.35)',
          marginBottom: 'clamp(0.75rem, 1.5vh, 1.25rem)' }} />
        {unitName && (
          <p className="font-light uppercase tracking-widest text-slate-400"
            style={{ fontSize: 'clamp(0.7rem, 1.3vw, 1rem)' }}>{unitName}</p>
        )}
        <div className="flex items-center gap-2" style={{ marginTop: 'clamp(1rem, 2vh, 1.75rem)' }}>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-bold uppercase text-slate-500"
            style={{ fontSize: 'clamp(0.55rem, 1vw, 0.7rem)', letterSpacing: '0.3em' }}>
            Ready for Guests
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Guest screen ────────────────────────────────────────────────────────────

function GuestScreen({ unit, booking }) {
  const time = useClock();
  const h = time.getHours().toString().padStart(2, '0');
  const m = time.getMinutes().toString().padStart(2, '0');
  const ampm = time.getHours() >= 12 ? 'PM' : 'AM';
  const dateStr = time.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-bg-dark">
      <TVBackground />

      {/* Identity card — top left */}
      <div className="absolute z-10 glass-card rounded-xl flex flex-col items-center text-center"
        style={{
          top: 'clamp(1.5rem, 3vh, 2.5rem)',
          left: 'clamp(1.5rem, 3vw, 2.5rem)',
          padding: 'clamp(1rem, 2vh, 1.75rem) clamp(1.25rem, 2.5vw, 2rem)',
          gap: 'clamp(0.3rem, 0.8vh, 0.6rem)',
        }}>
        <img
          src="/logo.png"
          alt="Birdnest Glamping"
          style={{ width: 'clamp(90px, 10vw, 160px)' }}
        />
        <p className="font-bold uppercase tracking-[0.4em]"
          style={{ fontSize: 'clamp(0.5rem, 0.85vw, 0.65rem)', color: '#c5a358' }}>
          Kintamani &middot; Bali
        </p>
        {unit?.name && (
          <p className="font-light uppercase tracking-widest text-white"
            style={{ fontSize: 'clamp(0.6rem, 1.1vw, 0.85rem)' }}>{unit.name}</p>
        )}
      </div>

      {/* Clock — top right */}
      <div className="absolute z-10 text-right"
        style={{ top: 'clamp(1.5rem, 3vh, 2.5rem)', right: 'clamp(1.5rem, 3vw, 2.5rem)' }}>
        <div className="flex items-end justify-end leading-none"
          style={{ gap: 'clamp(0.3rem, 0.6vw, 0.6rem)' }}>
          <span className="font-extralight text-white tracking-tighter"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', lineHeight: 1 }}>{h}:{m}</span>
          <span className="font-bold" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.5rem)', color: '#c5a358', marginBottom: '0.25em' }}>
            {ampm}
          </span>
        </div>
        <p className="font-bold uppercase text-slate-500"
          style={{ fontSize: 'clamp(0.55rem, 1vw, 0.75rem)', letterSpacing: '0.35em', marginTop: '0.25rem', color: '#e2e8f0' }}>
          {dateStr}
        </p>
      </div>

      {/* Welcome card — bottom */}
      <div className="absolute z-10 glass-card rounded-2xl"
        style={{
          bottom: 'clamp(2rem, 5vh, 4rem)',
          left: 'clamp(1.5rem, 3vw, 2.5rem)',
          right: 'clamp(1.5rem, 3vw, 2.5rem)',
          padding: 'clamp(1.5rem, 3.5vh, 3rem) clamp(2rem, 4vw, 4rem)',
        }}>
        {/* Welcome label */}
        <p className="font-bold uppercase"
          style={{ color: 'rgba(197,163,88,0.75)', fontSize: 'clamp(0.55rem, 1vw, 0.8rem)',
            letterSpacing: '0.5em', marginBottom: 'clamp(0.4rem, 1vh, 0.75rem)' }}>
          Welcome to your stay
        </p>

        {/* Guest name */}
        <h1 className="font-extralight text-white leading-none"
          style={{ fontSize: 'clamp(2rem, 5.5vw, 5rem)', marginBottom: 'clamp(0.75rem, 2vh, 1.5rem)' }}>
          {booking.guest_name}
        </h1>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(197,163,88,0.25)',
          marginBottom: 'clamp(0.75rem, 2vh, 1.5rem)' }} />

        {/* Stay details */}
        <div className="grid grid-cols-3" style={{ gap: 'clamp(1rem, 3vw, 3rem)' }}>
          <DetailCell label="Check-in" value={formatDate(booking.check_in_date)} />
          <DetailCell label="Check-out" value={formatDate(booking.check_out_date)} />
          <DetailCell label="Guests" value={booking.num_guests ?? '1'} />
        </div>
      </div>
    </div>
  );
}

function DetailCell({ label, value }) {
  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.2rem, 0.6vh, 0.5rem)' }}>
      <p className="font-bold uppercase text-slate-600"
        style={{ fontSize: 'clamp(0.5rem, 0.9vw, 0.7rem)', letterSpacing: '0.4em' }}>{label}</p>
      <p className="font-light text-white"
        style={{ fontSize: 'clamp(0.9rem, 2.2vw, 1.8rem)' }}>{value}</p>
    </div>
  );
}

// ─── Error / unconfigured screens ────────────────────────────────────────────

function UnconfiguredScreen() {
  return (
    <div className="w-screen h-screen bg-bg-dark flex flex-col items-center justify-center gap-6 text-center">
      <span className="material-symbols-outlined text-6xl" style={{ color: 'rgba(197,163,88,0.3)' }}>tv_off</span>
      <p className="text-lg font-extralight tracking-[0.2em] text-slate-500 uppercase">Display not configured</p>
      <p className="text-xs uppercase tracking-widest text-slate-700">
        Open the Birdnest TV Settings app to set Room ID and token
      </p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div className="w-screen h-screen bg-bg-dark flex flex-col items-center justify-center gap-6 text-center">
      <span className="material-symbols-outlined text-6xl" style={{ color: 'rgba(197,163,88,0.3)' }}>wifi_off</span>
      <p className="text-lg font-extralight tracking-[0.2em] text-slate-500 uppercase">Connection error</p>
      <p className="text-xs uppercase tracking-widest text-slate-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry}
          className="mt-4 text-xs uppercase tracking-widest text-slate-600 border border-white/10 rounded-xl px-6 py-3 hover:border-white/20 transition-colors">
          Retry
        </button>
      )}
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const queryRoom = useMemo(() => getQueryValue('room'), []);
  const queryToken = useMemo(() => getQueryValue('token'), []);

  const [roomId] = useState(() => queryRoom || localStorage.getItem('roomId') || '');
  const [displayToken] = useState(() => queryToken || localStorage.getItem('displayToken') || '');

  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (queryRoom) localStorage.setItem('roomId', queryRoom);
    if (queryToken) localStorage.setItem('displayToken', queryToken);
  }, [queryRoom, queryToken]);

  const fetchState = useMemo(() => async () => {
    if (!roomId || !displayToken) return;
    try {
      const { data } = await api.get(`/room/${encodeURIComponent(roomId)}/state`);
      setState(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to reach server');
    }
  }, [roomId, displayToken]);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  if (!roomId || !displayToken) return <UnconfiguredScreen />;
  if (error && !state) return <ErrorScreen message={error} onRetry={fetchState} />;
  if (!state) return null;

  if (!state.booking) return (
    <>
      <VacantScreen unitName={state.unit?.name} />
      <BuildBadge />
    </>
  );

  return (
    <>
      <GuestScreen unit={state.unit} booking={state.booking} />
      <BuildBadge />
    </>
  );
}

function BuildBadge() {
  return (
    <div style={{
      position: 'fixed', bottom: 8, right: 12,
      fontSize: 9, fontFamily: 'monospace',
      color: 'rgba(255,255,255,0.15)',
      pointerEvents: 'none', zIndex: 9999,
    }}>
      {__APP_COMMIT__}
    </div>
  );
}
