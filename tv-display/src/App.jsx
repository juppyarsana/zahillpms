import { useEffect, useMemo, useRef, useState } from 'react';
import api from './api.js';
import NoticeTicker from './components/NoticeTicker.jsx';
import { hotelHM, hotelDate } from './hotelTime';
import { precacheVideos, playableUrl, release, MUSIC_CACHE } from './videoCache';
import InfoApp from './info/InfoApp.jsx';

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

function getQueryValue(key) {
  return new URLSearchParams(window.location.search).get(key)?.trim() || '';
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

// zoom: each picture moves in slowly while it shows (index.css tv-bg-zoom).
function TVBackground({ imageUrl, light = false, zoom = false }) {
  const layers = useImageLayers(imageUrl || '/hero.png');
  return (
    <>
      {layers.map((layer, i) => (
        <img
          key={layer.id}
          src={layer.url}
          alt=""
          className={[i === layers.length - 1 && 'tv-bg-fade-in', zoom && 'tv-bg-zoom'].filter(Boolean).join(' ')}
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

// ─── Slideshow (room TVs and the lobby TV) ──────────────────────────────────
// The Guest Board cards one after the other: a picture stays 8 s; a video
// plays full screen to its end, then the slideshow carries on. Videos are
// downloaded once and kept on the TV (videoCache.js); until a video is on the
// TV its card shows its picture instead.

const PICTURE_MS = 8000;
const VIDEO_MAX_MS = 3 * 60 * 1000;   // a stuck video never holds the screen longer
const VIDEO_WAIT_MS = 15 * 1000;      // still loading → show the picture, move on
// 30+ room TVs come on together after a power cut or a deploy: each waits a
// random while before downloading the videos, so they don't all at once.
const ROOM_DOWNLOAD_SPREAD_MS = 10 * 60 * 1000;

// A clear 1×1 picture: without a poster the TV's web view draws its own grey
// "play" placeholder until the first frame is ready.
const NO_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function useSlideshow(cards, { sound = false, spreadDownloads = false } = {}) {
  const slides = useMemo(() => cards.filter(c => c.category !== 'notice'), [cards]);
  const videoKey = cards.map(c => c.video_url || '').join('|');

  const [index, setIndex] = useState(0);
  const [turn, setTurn] = useState(0);            // bumps on every advance (replays a lone video)
  const [loaded, setLoaded] = useState(null);     // { url, src } — the video in the player
  const [failedTurn, setFailedTurn] = useState(-1); // the turn whose video would not play
  const [playing, setPlaying] = useState(false);  // this slide's video is on screen → fade it in
  const [progress, setProgress] = useState(0);
  const videoRef = useRef(null);
  const lastPicture = useRef(null);
  const firstDownload = useRef(true);

  const card = slides.length ? slides[index % slides.length] : null;
  const nextCard = slides.length ? slides[(index + 1) % slides.length] : null;
  // ONE player only — a TV has a single hardware video decoder, and a second
  // <video> holding it makes the next one fail. It holds this slide's video,
  // or, while a picture shows, the next slide's (loaded and waiting, so it
  // starts at once when its turn comes).
  const target = card?.video_url ? card : nextCard?.video_url ? nextCard : null;
  const isCurrent = !!target && target === card;
  const ready = !!(target && loaded?.url === target.video_url);
  const videoFailed = !!card?.video_url && failedTurn === turn;
  const showVideo = isCurrent && ready && !videoFailed;

  // A video card with no picture of its own keeps the last picture on screen
  // until its video is playing (rather than a black screen).
  if (card?.image_url) lastPicture.current = card.image_url;
  const picture = card?.image_url || lastPicture.current;

  const next = () => { setIndex(i => (slides.length ? (i + 1) % slides.length : 0)); setTurn(t => t + 1); };

  // Keep every video on the TV (downloads new ones, drops removed ones).
  useEffect(() => {
    const urls = cards.map(c => c.video_url);
    if (!urls.some(Boolean)) { precacheVideos(urls); return undefined; }
    const wait = spreadDownloads && firstDownload.current ? Math.random() * ROOM_DOWNLOAD_SPREAD_MS : 0;
    firstDownload.current = false;
    const id = setTimeout(() => precacheVideos(urls), wait);
    return () => clearTimeout(id);
  }, [videoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (index >= slides.length) setIndex(0); }, [slides.length, index]);

  // Load the target video into the player (from the TV's copy once it has one).
  useEffect(() => {
    const url = target?.video_url;
    if (!url || loaded?.url === url) return undefined;
    let off = false;
    playableUrl(url).then(src => {
      if (off) { release(src); return; }
      setLoaded(prev => { release(prev?.src); return { url, src }; });
    });
    return () => { off = true; };
  }, [target?.video_url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => release(loaded?.src), []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Its turn: play from the start. The lobby plays sound when the card says so
  // (a browser that refuses sound without a click still plays it muted); rooms
  // never do. Not its turn yet: wait paused on the first frame.
  useEffect(() => {
    const v = videoRef.current;
    setPlaying(false); setProgress(0);
    if (!v || !ready) return;
    try { v.currentTime = 0; } catch { /* not ready yet */ }
    if (!isCurrent) { v.muted = true; v.pause(); return; }
    const t = turn;
    v.muted = !sound || card.video_sound === false;
    v.play().catch(() => { v.muted = true; v.play().catch(() => setFailedTurn(t)); });
  }, [isCurrent, ready, loaded?.src, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // The picture shows underneath; this slide's video fades in over it once it
  // is really playing.
  const media = (
    <>
      <TVBackground imageUrl={picture} light zoom />
      {ready && (
        <video ref={videoRef} src={loaded.src} poster={NO_POSTER} playsInline muted preload="auto"
          onPlaying={() => { if (isCurrent) setPlaying(true); }}
          onEnded={() => { if (isCurrent) next(); }}
          onError={() => { if (isCurrent) setFailedTurn(turn); }}
          onTimeUpdate={e => { const v = e.currentTarget; if (isCurrent && v.duration) setProgress(v.currentTime / v.duration); }}
          style={{ position: 'absolute', inset: 0, zIndex: 5, width: '100%', height: '100%', objectFit: 'cover',
            background: 'transparent', opacity: showVideo && playing ? 1 : 0, transition: 'opacity 700ms ease' }} />
      )}
    </>
  );

  return { card, showVideo, progress, media };
}

// ─── Room screen (guest or empty room) ──────────────────────────────────────
// The picture / video fills the screen; everything sits along the bottom:
// the card's title + the welcome bottom left, the logo in the middle, the
// clock, date and weather bottom right. Videos play without sound — a room
// TV's screensaver also comes on at night with the guest asleep.

const GOLD = '#e3c27a';
const SHADOW = '0 2px 14px rgba(0,0,0,0.7)';

function shortDate(value) {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function RoomScreen({ unit, booking, cards = [], weather, property }) {
  const time = useClock();
  const { h, m, ampm } = formatClock(time);
  const dateStr = hotelDate(time, { weekday: 'long', day: 'numeric', month: 'long' });
  const hasNotices = cards.some(c => c.category === 'notice');
  const { card, showVideo, progress, media } = useSlideshow(cards, { spreadDownloads: true });

  const edge = 'clamp(1.5rem, 3.1vw, 3.75rem)';
  const bottom = hasNotices ? 'clamp(3.75rem, 9vh, 6.5rem)' : 'clamp(1.5rem, 5vh, 3.5rem)';
  const room = unit?.name ? `Room ${unit.name}` : '';

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-bg-dark">
      {media}
      {/* A little more shade along the bottom, so the text stays readable on a bright picture */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none',
        background: 'linear-gradient(to bottom, rgba(5,7,10,0) 55%, rgba(5,7,10,0.5) 100%)' }} />

      {/* Caption + welcome — bottom left */}
      <div className="absolute z-20 flex flex-col"
        style={{ left: edge, bottom, maxWidth: '42vw', gap: '0.4vw', textShadow: SHADOW }}>
        {card?.title && (
          <div className="flex items-center" style={{ gap: '0.5vw', marginBottom: '0.5vw' }}>
            {showVideo && (
              <span className="material-symbols-outlined" style={{ fontSize: 'clamp(0.9rem, 1.3vw, 1.6rem)', color: 'rgba(255,255,255,0.8)' }}>volume_off</span>
            )}
            <p style={{ fontSize: 'clamp(0.75rem, 1.05vw, 1.25rem)', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.85)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {card.title}
            </p>
          </div>
        )}
        <p className="font-bold uppercase"
          style={{ fontSize: 'clamp(0.65rem, 0.95vw, 1.15rem)', letterSpacing: '0.35em', color: GOLD }}>
          {booking ? 'Welcome' : 'Welcome to'}
        </p>
        <h1 className="text-white" style={{ fontFamily: 'var(--font-brand)', fontWeight: 700, fontSize: 'clamp(2rem, 4.1vw, 5rem)', lineHeight: 1.05 }}>
          {booking ? booking.guest_name : (property?.name || 'Welcome')}
        </h1>
        {(room || booking) && (
          <p style={{ fontSize: 'clamp(0.85rem, 1.2vw, 1.45rem)', color: 'rgba(255,255,255,0.88)' }}>
            {[room, booking?.check_out_date && `until ${shortDate(booking.check_out_date)}`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {/* Logo — bottom centre */}
      <img src={property?.logo_url || '/logo.png'} alt={property?.name || ''}
        className="absolute z-20"
        style={{ left: '50%', transform: 'translateX(-50%)', bottom: `calc(${bottom} - 0.5vw)`,
          width: 'clamp(140px, 14vw, 280px)', height: 'auto', filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.6))' }} />

      {/* Clock, date, weather — bottom right */}
      <div className="absolute z-20 flex flex-col items-end text-right"
        style={{ right: edge, bottom, gap: '0.5vw', textShadow: SHADOW }}>
        <p className="text-white font-light leading-none" style={{ fontSize: 'clamp(2.25rem, 4.4vw, 5.25rem)', letterSpacing: '-0.02em' }}>
          {h}:{m}<span className="font-bold" style={{ fontSize: '0.32em', color: GOLD, marginLeft: '0.3em', letterSpacing: 0 }}>{ampm}</span>
        </p>
        <p style={{ fontSize: 'clamp(0.75rem, 1.05vw, 1.25rem)', color: 'rgba(255,255,255,0.88)' }}>
          {dateStr}
          {weather?.today && <> &middot; {weather.today.temp}&deg; {weather.today.desc}</>}
        </p>
      </div>

      {/* How far the video is */}
      {showVideo && (
        <div className="absolute z-20" style={{ left: 0, right: 0, bottom: hasNotices ? 'clamp(2.25rem, 4.2vh, 3.25rem)' : 0, height: 3, background: 'rgba(255,255,255,0.15)' }}>
          <div style={{ width: `${Math.round(progress * 1000) / 10}%`, height: '100%', background: GOLD, transition: 'width 0.25s linear' }} />
        </div>
      )}

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
// The Guest Board cards set to show in the lobby as a slideshow (useSlideshow,
// with sound when the card says so). No room, no guest.

function LobbyScreen({ cards = [], weather, property, music }) {
  const time = useClock();
  const { h, m, ampm } = formatClock(time);
  const dateStr = hotelDate(time, { weekday: 'long', day: 'numeric', month: 'long' });
  const hasNotices = cards.some(c => c.category === 'notice');
  const { card, showVideo, media } = useSlideshow(cards, { sound: true });

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
      {media}

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
  // /info/* = a hotel info page opened from the room TV's Home (tv-launcher).
  if (window.location.pathname.startsWith('/info/')) return <InfoApp />;
  return <WelcomeApp />;
}

function WelcomeApp() {
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

  return (
    <>
      <RoomScreen unit={state.unit} booking={state.booking} cards={state.cards} weather={state.weather} property={state.property} />
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
