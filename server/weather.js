const https = require('https');

const API_KEY  = process.env.OPENWEATHER_API_KEY || '';
const LAT      = process.env.WEATHER_LAT  || '-8.2386';  // Kintamani default
const LON      = process.env.WEATHER_LON  || '115.3697';
const CACHE_MS = 30 * 60 * 1000; // 30 minutes

const TIMEOUT_MS = 8000;
const RETRY_MS = 5 * 60 * 1000; // after a failed fetch, don't ask again for 5 minutes

let cache = null;
let cacheTime = 0;
let refreshing = false;
let lastTryAt = 0;

function fetchFromAPI() {
  return new Promise((resolve, reject) => {
    if (!API_KEY) return resolve(null);
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${LAT}&lon=${LON}&units=metric&cnt=16&appid=${API_KEY}`;
    const req = https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(TIMEOUT_MS, () => req.destroy());   // → 'error' → null
  });
}

function pickIcon(main) {
  const m = (main || '').toLowerCase();
  if (m.includes('thunderstorm')) return 'thunderstorm';
  if (m.includes('drizzle'))      return 'rainy';
  if (m.includes('rain'))         return 'rainy';
  if (m.includes('snow'))         return 'weather_snowy';
  if (m.includes('clear'))        return 'clear_day';
  if (m.includes('cloud'))        return 'partly_cloudy_day';
  return 'partly_cloudy_day';
}

// Never waits for the weather service: every room tablet asks for its state
// every 10 seconds and this is part of the answer, so a slow or dead weather
// API used to hold up every tablet at once (and each of them started its own
// fetch when the cache ran out). Answers with what is cached — possibly a
// little old, or nothing yet — and refreshes in the background, one fetch at
// a time.
async function getWeather() {
  if (!API_KEY) return null;
  if (!(cache && Date.now() - cacheTime < CACHE_MS) && !refreshing && Date.now() - lastTryAt > RETRY_MS) {
    refreshing = true;
    lastTryAt = Date.now();
    refresh().catch(() => {}).finally(() => { refreshing = false; });
  }
  return cache;
}

async function refresh() {
  const data = await fetchFromAPI();
  if (!data || !data.list || data.list.length === 0) return; // keep what we have

  const now       = data.list[0];
  // Find first entry roughly 24h ahead for tomorrow
  const tomorrow  = data.list.find(item => item.dt * 1000 > Date.now() + 20 * 3600 * 1000) || data.list[7];

  cache = {
    today: {
      temp:      Math.round(now.main.temp),
      feels_like: Math.round(now.main.feels_like),
      humidity:  now.main.humidity,
      wind:      Math.round(now.wind.speed * 3.6), // m/s → km/h
      desc:      now.weather[0].description.replace(/\b\w/g, c => c.toUpperCase()),
      icon:      pickIcon(now.weather[0].main),
    },
    tomorrow: {
      temp:     Math.round(tomorrow.main.temp),
      humidity: tomorrow.main.humidity,
      wind:     Math.round(tomorrow.wind.speed * 3.6),
      desc:     tomorrow.weather[0].description.replace(/\b\w/g, c => c.toUpperCase()),
      icon:     pickIcon(tomorrow.weather[0].main),
    },
  };
  cacheTime = Date.now();
  return cache;
}

module.exports = { getWeather };
