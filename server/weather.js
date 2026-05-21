const https = require('https');

const API_KEY  = process.env.OPENWEATHER_API_KEY || '';
const LAT      = process.env.WEATHER_LAT  || '-8.2386';  // Kintamani default
const LON      = process.env.WEATHER_LON  || '115.3697';
const CACHE_MS = 30 * 60 * 1000; // 30 minutes

let cache = null;
let cacheTime = 0;

function fetchFromAPI() {
  return new Promise((resolve, reject) => {
    if (!API_KEY) return resolve(null);
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${LAT}&lon=${LON}&units=metric&cnt=16&appid=${API_KEY}`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
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

async function getWeather() {
  if (!API_KEY) return null;
  if (cache && Date.now() - cacheTime < CACHE_MS) return cache;

  const data = await fetchFromAPI();
  if (!data || !data.list || data.list.length === 0) return cache; // return stale on error

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
