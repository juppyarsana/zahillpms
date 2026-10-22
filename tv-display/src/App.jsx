import { useEffect, useMemo, useRef, useState } from 'react';
import api from './api.js';
import BoardCarousel from './components/BoardCarousel.jsx';
import NoticeTicker from './components/NoticeTicker.jsx';
import { hotelHM, hotelDate } from './hotelTime';
import { precacheVideos, playableUrl, release, MUSIC_CACHE } from './videoCache';

const POLL_MS = 15_000;
const VERSION_CHECK_MS = 10 * 60 * 1000;

// Auto-update. Nobody can press "refresh" on a TV, and a screen left on for
// days never loads the page again by itself — so every 10 minutes ask the
// server which build it has (dist/version.json, written at build) and load
// the page again when it is not this one. The new address carries the build
// (?v=…) so the TV can't answer from its own cache; tried once per build, so
// a server that is mid-deploy can't make the screen reload in a loop.
function useAutoUpdate() {
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { commit } = await res.json();
        if (!commit || commit === __APP_COMMIT__) return;
        if (sessionStorage.getItem('updateTried') === commit) return;
        sessionStorage.setItem('updateTried', commit);
        const url = new URL(window.location.href);
        url.searchParams.set('v', commit);
        window.location.replace(url.toString());
      } catch { /* offline, or not a build (dev server): try again later */ }
    }
    const id = setInterval(check, VERSION_CHECK_MS);
    return () => clearInterval(id);
  }, []);
}

function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// getHours() is 24-hour (0-23) — convert to 12-hour before pairing with an
// AM/PM suffix, otherwise afternoon/evening shows e.g. "13:44 PM".
function formatClock(time) {
  const { hours: hours24, minutes } = hotelHM(time);
  const hour12 = hours24 % 12 || 12;
  return {
    h: hour12.toString().padStart(2, '0'),
    m: minutes.toString().padStart(2, '0'),
    ampm: hours24 >= 12 ? 'PM' : 'AM',
  };
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

// Drives the board-content rotation index — shared by the background image
// and the caption panel so both change in lockstep.
function useCardRotation(count, duration = 8000) {
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [count]);
  useEffect(() => {
    if (count < 2) return;
    const id = setInterval(() => setIndex(i => (i + 1) % count), duration);
    return () => clearInterval(id);
  }, [count, duration]);
  return index;
}

// ─── Shared background ──────────────────────────────────────────────────────

// Stacks a new <img> layer on top whenever `src` changes, fading it in over the
// previous one (which stays put underneath) — a true crossfade with no flash of
// the base color showing through, and no image preloading needed.
function useImageLayers(src) {
  const [layers, setLayers] = useState(() => [{ id: 0, url: src }]);
  const nextId = useRef(1);

  useEffect(() => {
    setLayers(prev => {
      if (prev[prev.length - 1]?.url === src) return prev;
      const id = nextId.current++;
      return [...prev, { id, url: src }].slice(-2);
    });
  }, [src]);

  return layers;
}

function TVBackground({ imageUrl, light = false }) {
  const layers = useImageLayers(imageUrl || '/hero.png');
  return (
    <>
      {layers.map((layer, i) => (
        <img
          key={layer.id}
          src={layer.url}
          alt=""
          className={i === layers.length - 1 ? 'tv-bg-fade-in' : ''}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
            zIndex: i,
          }}
        />
      ))}
      {/* gradient: transparent top → near-black bottom (light: only a thin
          shade along the edges, so the lobby's picture keeps its colours) */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 10,
        background: light
          ? 'linear-gradient(to bottom, rgba(5,7,10,0.35) 0%, rgba(5,7,10,0) 18%, rgba(5,7,10,0) 75%, rgba(5,7,10,0.6) 100%)'
          : 'linear-gradient(to top, #05070a 30%, rgba(5,7,10,0.65) 55%, rgba(5,7,10,0.25) 100%)',
      }} />
    </>
  );
}

// ─── Vacant screen ──────────────────────────────────────────────────────────

function VacantScreen({ unitName, cards = [], property }) {
  const time = useClock();
  const { h, m, ampm } = formatClock(time);
  const dateStr = hotelDate(time, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const hasNotices = cards.some(c => c.category === 'notice');

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
          <span className="font-bold" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.5rem)', color: '#c9a227', marginBottom: '0.25em' }}>
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
          bottom: hasNotices ? 'clamp(4.5rem, 11vh, 8rem)' : 'clamp(3rem, 8vh, 6rem)',
          padding: 'clamp(2rem, 4vh, 3.5rem) clamp(3rem, 7vw, 6rem)',
          minWidth: 'clamp(280px, 38vw, 560px)',
        }}>
        <img
          src={property?.logo_url || '/logo.png'}
          alt={property?.name || 'ZHP PMS'}
          style={{ width: 'clamp(160px, 20vw, 300px)', marginBottom: 'clamp(0.5rem, 1.2vh, 1rem)' }}
        />
        {property?.location && (
          <p className="font-bold uppercase tracking-[0.45em]"
            style={{ fontSize: 'clamp(0.55rem, 1vw, 0.75rem)', color: '#c9a227',
              marginBottom: 'clamp(0.75rem, 1.5vh, 1.25rem)' }}>
            {property.location}
          </p>
        )}
        <div className="w-12 h-px" style={{ background: 'rgba(201,162,39,0.35)',
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

      <NoticeTicker cards={cards} />
    </div>
  );
}

// ─── Guest screen ────────────────────────────────────────────────────────────

function GuestScreen({ unit, booking, cards = [], weather, property }) {
  const time = useClock();
  const { h, m, ampm } = formatClock(time);
  const hasNotices = cards.some(c => c.category === 'notice');
  const carouselCards = cards.filter(c => c.category !== 'notice');
  const activeIndex = useCardRotation(carouselCards.length);
  const activeCard = carouselCards[activeIndex] ?? null;
  const dateStr = hotelDate(time, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-bg-dark">
      <TVBackground imageUrl={activeCard?.image_url} />

      {/* Identity card — top left */}
      <div className="absolute z-10 glass-card rounded-xl flex flex-col items-center text-center"
        style={{
          top: 'clamp(1.5rem, 3vh, 2.5rem)',
          left: 'clamp(1.5rem, 3vw, 2.5rem)',
          padding: 'clamp(1rem, 2vh, 1.75rem) clamp(1.25rem, 2.5vw, 2rem)',
          gap: 'clamp(0.3rem, 0.8vh, 0.6rem)',
        }}>
        <img
          src={property?.logo_url || '/logo.png'}
          alt={property?.name || 'ZHP PMS'}
          style={{ width: 'clamp(90px, 10vw, 160px)' }}
        />
        {property?.location && (
          <p className="font-bold uppercase tracking-[0.4em]"
            style={{ fontSize: 'clamp(0.5rem, 0.85vw, 0.65rem)', color: '#c9a227' }}>
            {property.location}
          </p>
        )}
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
          <span className="font-bold" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.5rem)', color: '#c9a227', marginBottom: '0.25em' }}>
            {ampm}
          </span>
        </div>
        <p className="font-bold uppercase text-slate-500"
          style={{ fontSize: 'clamp(0.55rem, 1vw, 0.75rem)', letterSpacing: '0.35em', marginTop: '0.25rem', color: '#e2e8f0' }}>
          {dateStr}
        </p>
      </div>

      {/* Bottom bar — board carousel (rotating, left) + stay info (fixed, right) */}
      <div className="absolute z-10 flex"
        style={{
          bottom: hasNotices ? 'clamp(3.5rem, 8vh, 6rem)' : 'clamp(2rem, 5vh, 4rem)',
          left: 'clamp(1.5rem, 3vw, 2.5rem)',
          right: 'clamp(1.5rem, 3vw, 2.5rem)',
          gap: 'clamp(1rem, 2vw, 1.5rem)',
          alignItems: 'stretch',
        }}>
        <BoardCarousel card={activeCard} cards={carouselCards} index={activeIndex} />

        {/* Welcome card */}
        <div className="glass-card rounded-2xl"
          style={{
            flex: 1,
            padding: 'clamp(1.25rem, 3vh, 2.25rem) clamp(1.5rem, 3vw, 2.5rem)',
          }}>
          {/* Welcome label */}
          <p className="font-bold uppercase"
            style={{ color: 'rgba(201,162,39,0.75)', fontSize: 'clamp(0.5rem, 0.85vw, 0.7rem)',
              letterSpacing: '0.4em', marginBottom: 'clamp(0.35rem, 0.9vh, 0.65rem)' }}>
            Welcome to your stay
          </p>

          {/* Guest name */}
          <h1 className="text-white leading-none"
            style={{ fontFamily: 'var(--font-brand)', fontWeight: 700, fontSize: 'clamp(1.4rem, 3.4vw, 3rem)', marginBottom: 'clamp(0.6rem, 1.6vh, 1.25rem)' }}>
            {booking.guest_name}
          </h1>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(201,162,39,0.25)',
            marginBottom: 'clamp(0.6rem, 1.6vh, 1.25rem)' }} />

          {/* Stay details */}
          <div className="grid grid-cols-3" style={{ gap: 'clamp(0.6rem, 1.6vw, 1.25rem)' }}>
            <DetailCell label="Check-in" value={formatDate(booking.check_in_date)} />
            <DetailCell label="Check-out" value={formatDate(booking.check_out_date)} />
            <DetailCell label="Guests" value={booking.num_guests ?? '1'} />
          </div>

          {weather?.today && (
            <>
              <div style={{ height: 1, background: 'rgba(201,162,39,0.25)',
                margin: 'clamp(0.6rem, 1.6vh, 1.25rem) 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(0.6rem, 1.2vw, 1rem)' }}>
                <span className="material-symbols-outlined"
                  style={{ fontSize: 'clamp(1.6rem, 3.2vw, 2.4rem)', color: '#c9a227' }}>
                  {weather.today.icon}
                </span>
                <div>
                  <div className="flex items-baseline" style={{ gap: 6 }}>
                    <span className="text-white font-extralight"
                      style={{ fontSize: 'clamp(1.1rem, 2vw, 1.6rem)' }}>{weather.today.temp}&deg;C</span>
                    <span className="text-slate-400"
                      style={{ fontSize: 'clamp(0.65rem, 1.1vw, 0.9rem)' }}>{weather.today.desc}</span>
                  </div>
                  <div className="text-slate-500 uppercase"
                    style={{ fontSize: 'clamp(0.5rem, 0.8vw, 0.65rem)', letterSpacing: '0.08em', marginTop: 2 }}>
                    Feels {weather.today.feels_like}&deg; &middot; Humidity {weather.today.humidity}% &middot; Wind {weather.today.wind}km/h
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <NoticeTicker cards={cards} />
    </div>
  );
}


// ─── Lobby music (migration 119) ────────────────────────────────────────────
// The songs uploaded on the Guest Board page, played one after the other in a
// loop at the volume set there. While a lobby video plays with sound the music
// fades out and pauses, then fades back in. Songs are kept on the TV like the
// videos. A TV app that blocks sound until a button is pressed (older than
// 0.2.0) is retried every 30 s.

const FADE_MS = 1500;

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function LobbyMusic({ music, quiet }) {
  const audioRef = useRef(null);
  const fadeRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [pos, setPos] = useState(0);
  const [src, setSrc] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const tracks = music?.tracks || [];
  const key = tracks.map(t => t.url).join('|') + (music?.shuffle ? '|s' : '');
  const target = Math.max(0, Math.min(1, (music?.volume ?? 40) / 100));

  useEffect(() => { precacheVideos(tracks.map(t => t.url), MUSIC_CACHE); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQueue(music?.shuffle ? shuffled(tracks) : tracks); setPos(0); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = queue.length ? queue[pos % queue.length] : null;

  useEffect(() => {
    let off = false, got = null;
    setSrc(null);
    if (track) playableUrl(track.url, MUSIC_CACHE).then(u => { got = u; if (!off) setSrc(u); else release(u); });
    return () => { off = true; release(got); };
  }, [track?.url, pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => {
    // One song: "the next one" is the same song at the same place, which
    // changes nothing and would leave the lobby silent — play it again.
    if (queue.length <= 1) {
      const a = audioRef.current;
      if (a) { a.currentTime = 0; a.play().catch(() => setBlocked(true)); }
      return;
    }
    if (pos + 1 >= queue.length && music?.shuffle && queue.length > 1) { setQueue(shuffled(tracks)); setPos(0); }
    else setPos(p => (queue.length ? (p + 1) % queue.length : 0));
  };

  // Fade to the wanted level (volume, or silent while a video speaks).
  function fadeTo(level, done) {
    const a = audioRef.current;
    if (!a) return;
    clearInterval(fadeRef.current);
    const from = a.volume, steps = 15;
    let i = 0;
    fadeRef.current = setInterval(() => {
      i++;
      a.volume = Math.max(0, Math.min(1, from + (level - from) * (i / steps)));
      if (i >= steps) { clearInterval(fadeRef.current); done?.(); }
    }, FADE_MS / steps);
  }

  function start() {
    const a = audioRef.current;
    if (!a || !src) return;
    a.play().then(() => { setBlocked(false); fadeTo(target); }).catch(() => setBlocked(true));
  }

  // Start / fade in: fade only at the very start and after a video; the next
  // song in the list just carries on at the set level.
  const fadeInRef = useRef(true);
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !src) return;
    if (quiet) { fadeInRef.current = true; fadeTo(0, () => a.pause()); return; }
    if (a.paused) {
      a.volume = fadeInRef.current ? 0 : target;
      fadeInRef.current = false;
      start();
    } else fadeTo(target);
  }, [src, quiet, target]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sound blocked by the TV: try again now and then.
  useEffect(() => {
    if (!blocked || quiet) return undefined;
    // A browser (a laptop, not the TV app) allows sound after a click / key:
    // start straight away on the first one.
    const id = setInterval(start, 30_000);
    const now = () => start();
    window.addEventListener('pointerdown', now);
    window.addEventListener('keydown', now);
    return () => {
      clearInterval(id);
      window.removeEventListener('pointerdown', now);
      window.removeEventListener('keydown', now);
    };
  }, [blocked, quiet, src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearInterval(fadeRef.current), []);

  if (!track) return null;
  return (
    <audio ref={audioRef} src={src || undefined} preload="auto"
      onEnded={next}
      onError={() => { if (queue.length > 1) setTimeout(next, 2000); }} />
  );
}

// ─── Lobby screen (Room ID "lobby", migration 116) ──────────────────────────
// The Guest Board cards set to show in the lobby, one after the other: a
// picture stays 8 s with its caption; a video plays full screen to its end
// (with sound when the card says so), then the slideshow carries on. Videos
// are downloaded once and kept on the TV (videoCache.js); until a video is on
// the TV its card shows its picture instead. No room, no guest.

const PICTURE_MS = 8000;
const VIDEO_MAX_MS = 3 * 60 * 1000;   // a stuck video never holds the screen longer
const VIDEO_WAIT_MS = 15 * 1000;      // still loading → show the picture, move on

function LobbyScreen({ cards = [], weather, property, music }) {
  const time = useClock();
  const { h, m, ampm } = formatClock(time);
  const dateStr = hotelDate(time, { weekday: 'long', day: 'numeric', month: 'long' });
  const hasNotices = cards.some(c => c.category === 'notice');
  const slides = useMemo(() => cards.filter(c => c.category !== 'notice'), [cards]);
  const videoKey = cards.map(c => c.video_url || '').join('|');

  const [index, setIndex] = useState(0);
  const [turn, setTurn] = useState(0);            // bumps on every advance (replays a lone video)
  const [videoSrc, setVideoSrc] = useState(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef(null);

  const card = slides.length ? slides[index % slides.length] : null;
  const showVideo = !!(card?.video_url && videoSrc && !videoFailed);

  const next = () => { setIndex(i => (slides.length ? (i + 1) % slides.length : 0)); setTurn(t => t + 1); };

  // Keep every lobby video on the TV (downloads new ones, drops removed ones).
  useEffect(() => { precacheVideos(cards.map(c => c.video_url)); }, [videoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (index >= slides.length) setIndex(0); }, [slides.length, index]);

  // Load this slide's video from the TV's copy.
  useEffect(() => {
    let off = false, src = null;
    setVideoSrc(null); setVideoFailed(false);
    if (card?.video_url) {
      playableUrl(card.video_url).then(u => { src = u; if (!off) setVideoSrc(u); else release(u); });
    }
    return () => { off = true; release(src); };
  }, [card?.video_url, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // How long this slide stays: a picture 8 s; a video until it ends.
  useEffect(() => {
    if (!card) return undefined;
    const ms = card.video_url
      ? (showVideo ? VIDEO_MAX_MS : videoFailed ? PICTURE_MS : VIDEO_WAIT_MS)
      : PICTURE_MS;
    if (!card.video_url && slides.length < 2) return undefined;
    const id = setTimeout(next, ms);
    return () => clearTimeout(id);
  }, [card?.id, turn, showVideo, videoFailed, slides.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start the video — with sound when allowed; a browser that refuses sound
  // without a click still plays it muted.
  useEffect(() => {
    const v = videoRef.current;
    if (!showVideo || !v) return;
    v.muted = card.video_sound === false;
    v.play().catch(() => { v.muted = true; v.play().catch(() => setVideoFailed(true)); });
  }, [showVideo, videoSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everything sits small in the bottom corners so the picture / video fills
  // the screen: logo + hotel name bottom left, time · weather bottom right,
  // the card's title small top left. Above the notice ticker when it shows.
  const edge = 'clamp(1.5rem, 3vw, 2.5rem)';
  const bottom = hasNotices ? 'clamp(3.5rem, 8vh, 6rem)' : 'clamp(1.5rem, 4vh, 3rem)';
  const shadow = '0 2px 12px rgba(0,0,0,0.65)';
  const corner = {
    background: 'rgba(5,7,10,0.38)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16,
    padding: 'clamp(0.6rem, 1.4vh, 1rem) clamp(0.9rem, 1.6vw, 1.4rem)',
  };

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-bg-dark">
      {showVideo ? (
        <video key={`${card.id}-${turn}`} ref={videoRef} src={videoSrc} playsInline
          onEnded={next} onError={() => setVideoFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
      ) : (
        <TVBackground imageUrl={card?.image_url} light />
      )}
      {showVideo && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, rgba(5,7,10,0.35) 0%, rgba(5,7,10,0) 18%, rgba(5,7,10,0) 75%, rgba(5,7,10,0.6) 100%)' }} />
      )}

      {/* The card's title — small, top left */}
      {card?.title && (
        <div className="absolute z-20" style={{ top: edge, left: edge, maxWidth: '60vw' }}>
          <p className="text-white"
            style={{ fontFamily: 'var(--font-brand)', fontWeight: 700, fontSize: 'clamp(1rem, 2vw, 1.6rem)', textShadow: shadow, lineHeight: 1.2 }}>
            {card.title}
          </p>
        </div>
      )}

      {/* Logo + hotel name — bottom left */}
      <div className="absolute z-20 flex items-center" style={{ ...corner, left: edge, bottom, gap: 'clamp(0.6rem, 1.2vw, 1rem)' }}>
        <img src={property?.logo_url || '/logo.png'} alt=""
          style={{ height: 'clamp(36px, 5vh, 56px)', width: 'auto', objectFit: 'contain' }} />
        {property?.name && (
          <div>
            <p className="text-white leading-none"
              style={{ fontFamily: 'var(--font-brand)', fontWeight: 700, fontSize: 'clamp(1rem, 1.8vw, 1.5rem)' }}>{property.name}</p>
            {property.location && (
              <p className="font-bold uppercase"
                style={{ fontSize: 'clamp(0.45rem, 0.75vw, 0.6rem)', letterSpacing: '0.35em', color: '#c9a227', marginTop: '0.35em' }}>{property.location}</p>
            )}
          </div>
        )}
      </div>

      {/* Time · weather + date — bottom right */}
      <div className="absolute z-20 text-right" style={{ ...corner, right: edge, bottom }}>
        <div className="flex items-center justify-end leading-none" style={{ gap: 'clamp(0.5rem, 1vw, 0.9rem)' }}>
          <span className="text-white font-light" style={{ fontSize: 'clamp(1.3rem, 2.4vw, 2rem)' }}>
            {h}:{m}<span className="font-bold" style={{ fontSize: '0.55em', color: '#c9a227', marginLeft: '0.25em' }}>{ampm}</span>
          </span>
          {weather?.today && (
            <>
              <span style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.2)' }} />
              <span className="flex items-center" style={{ gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.8rem)', color: '#c9a227' }}>{weather.today.icon}</span>
                <span className="text-white font-light" style={{ fontSize: 'clamp(1.1rem, 2vw, 1.7rem)' }}>{weather.today.temp}&deg;C</span>
              </span>
            </>
          )}
        </div>
        <p className="font-bold uppercase"
          style={{ fontSize: 'clamp(0.45rem, 0.75vw, 0.6rem)', letterSpacing: '0.3em', marginTop: '0.45rem', color: '#e2e8f0' }}>
          {dateStr}
        </p>
      </div>

      <NoticeTicker cards={cards} />
      <LobbyMusic music={music} quiet={showVideo && card?.video_sound !== false} />
    </div>
  );
}

function DetailCell({ label, value }) {
  return (
    <div className="flex flex-col" style={{ gap: 'clamp(0.2rem, 0.6vh, 0.5rem)' }}>
      <p className="font-bold uppercase text-slate-600"
        style={{ fontSize: 'clamp(0.45rem, 0.7vw, 0.6rem)', letterSpacing: '0.3em' }}>{label}</p>
      <p className="font-light text-white"
        style={{ fontSize: 'clamp(0.7rem, 1.35vw, 1.1rem)' }}>{value}</p>
    </div>
  );
}

// ─── Error / unconfigured screens ────────────────────────────────────────────

function UnconfiguredScreen() {
  return (
    <div className="w-screen h-screen bg-bg-dark flex flex-col items-center justify-center gap-6 text-center">
      <span className="material-symbols-outlined text-6xl" style={{ color: 'rgba(201,162,39,0.3)' }}>tv_off</span>
      <p className="text-lg font-extralight tracking-[0.2em] text-slate-500 uppercase">Display not configured</p>
      <p className="text-xs uppercase tracking-widest text-slate-700">
        Open the Zahill TV Settings app to set Room ID and token
      </p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div className="w-screen h-screen bg-bg-dark flex flex-col items-center justify-center gap-6 text-center">
      <span className="material-symbols-outlined text-6xl" style={{ color: 'rgba(201,162,39,0.3)' }}>wifi_off</span>
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

  useAutoUpdate();

  useEffect(() => {
    if (queryRoom) localStorage.setItem('roomId', queryRoom);
    if (queryToken) localStorage.setItem('displayToken', queryToken);
  }, [queryRoom, queryToken]);

  // Room ID "lobby" = the lobby TV: no room, the cards set to show in the lobby.
  const isLobby = roomId.trim().toLowerCase() === 'lobby';

  const fetchState = useMemo(() => async () => {
    if (!roomId || !displayToken) return;
    try {
      const { data } = await api.get(isLobby ? '/lobby/state' : `/room/${encodeURIComponent(roomId)}/state`);
      setState(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to reach server');
    }
  }, [roomId, displayToken, isLobby]);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  if (!roomId || !displayToken) return <UnconfiguredScreen />;
  if (error && !state) return <ErrorScreen message={error} onRetry={fetchState} />;
  if (!state) return null;

  if (isLobby) return (
    <>
      <LobbyScreen cards={state.cards} weather={state.weather} property={state.property} music={state.music} />
      <BuildBadge />
    </>
  );

  if (!state.booking) return (
    <>
      <VacantScreen unitName={state.unit?.name} cards={state.cards} property={state.property} />
      <BuildBadge />
    </>
  );

  return (
    <>
      <GuestScreen unit={state.unit} booking={state.booking} cards={state.cards} weather={state.weather} property={state.property} />
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
