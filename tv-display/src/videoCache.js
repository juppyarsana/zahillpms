// Lobby videos are downloaded ONCE and kept on the TV (the browser's Cache
// Storage), then played from there — a 50 MB clip is not fetched over the
// hotel's internet every time the slideshow loops. A video no longer on the
// Guest Board is dropped from the TV's copy. Where Cache Storage is missing
// (old WebView, plain http), the video simply streams from the server.
const CACHE = 'lobby-videos-v1';
export const MUSIC_CACHE = 'lobby-music-v1';   // the lobby's songs (migration 119), kept apart
const hasCache = () => typeof window !== 'undefined' && 'caches' in window;

let running = null;

// Fetch every video not yet on the TV, one at a time; forget removed ones.
export function precacheVideos(urls, cacheName = CACHE) {
  if (!hasCache()) return Promise.resolve();
  const wanted = [...new Set(urls.filter(Boolean))];
  const job = (async () => {
    if (running) await running.catch(() => {});
    if (!(await caches.open(cacheName).then(() => true, () => false))) return; // storage not working: stream instead
    const cache = await caches.open(cacheName);
    for (const req of await cache.keys()) {
      if (!wanted.includes(new URL(req.url).pathname)) await cache.delete(req);
    }
    for (const url of wanted) {
      if (await cache.match(url)) continue;
      try {
        const res = await fetch(url);
        if (res.ok && res.status === 200) await cache.put(url, res);
      } catch { /* try again on the next round */ }
    }
  })();
  running = job.catch(() => {});
  return running;
}

// A playable URL for the video: from the TV's copy when it has one, otherwise
// straight from the server (the first time round, while the copy is still
// downloading, or when the TV's storage doesn't work). Call release() with the
// result when done.
export async function playableUrl(url, cacheName = CACHE) {
  if (!url) return null;
  if (!hasCache()) return url;
  try {
    const res = await (await caches.open(cacheName)).match(url);
    if (!res) return url;
    return URL.createObjectURL(await res.blob());
  } catch {
    return url;
  }
}

export function release(src) {
  if (src && src.startsWith('blob:')) URL.revokeObjectURL(src);
}
