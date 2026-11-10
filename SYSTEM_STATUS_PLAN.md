# System status — Superadmin monitoring page

Written 2026-11-02 with the owner. Touches **zahillpms** (most of it) and **zahillpos** (one health endpoint,
section 7). The same file is in both repo roots. Follow each repo's CLAUDE.md conventions.

## Decisions (made with the owner — do not change)

- **Client performance = both**: per hotel (server side) **and** real speed in the browser (small anonymous
  timing beacons from the apps).
- **The POS is included** (it runs on another server): it exposes a health endpoint the PMS reads.
- **Alerts go to the superadmin only** (Telegram).
- **No live stream**: the page refreshes every 30 s while open.

## Constraints

Production is a **1 vCPU / 1 GB RAM** VPS. Everything here must be near-free:
- Count in memory, write **one summary row per minute** — never a row per request.
- Sample the host once a minute from Node (`os`, `/proc/meminfo`, `/proc/loadavg`, `fs.statfs` for disk).
- Retention: minute rows 7 days, hourly roll-up 90 days (nightly job), then deleted. Target < 50 MB in total.
- No new heavy dependencies (no Grafana / Netdata / Prometheus). Charts are small inline-SVG components
  (the client has no chart library — add a tiny `components/charts/` with Line / Bars / Sparkline, no new package).
- A crash of the metrics code must never affect a request: every collector wrapped in try / catch.

## 1. Data (migration — next free number)

```
sys_minute (ts TIMESTAMPTZ PK,                          -- one row per minute
  cpu_load1, cpu_pct, mem_used_mb, mem_total_mb, swap_used_mb, disk_used_gb, disk_total_gb,
  proc_rss_mb, proc_heap_mb, event_loop_p99_ms, db_conns, db_conns_idle,
  req_count, req_5xx, req_4xx, req_p50_ms, req_p95_ms)
sys_hourly (same columns, ts = hour start; values = averages / max / sums as fits)
req_minute (ts, property_id NULL, route VARCHAR(120), count, errors_5xx, p50_ms, p95_ms, max_ms,
  PRIMARY KEY (ts, property_id, route))                  -- route = method + Express route pattern, never raw URLs
req_hourly (same shape)
app_errors (id, first_seen, last_seen, count, fingerprint VARCHAR(64) UNIQUE, route, property_id,
  message TEXT, stack TEXT)                              -- grouped: same error + route = one row with a count
job_runs (id, job VARCHAR(80), started_at, finished_at, ok BOOL, error TEXT, details JSONB)  -- keep 30 days
integration_status (key VARCHAR(40), property_id NULL, ok BOOL, last_ok_at, last_fail_at, last_error TEXT,
  checked_at, PRIMARY KEY (key, property_id))
rum_minute (ts, app VARCHAR(20), property_id NULL, page VARCHAR(120), loads INT, load_p50_ms, load_p95_ms,
  ttfb_p50_ms, api_count, api_p50_ms, api_p95_ms, api_errors, js_errors, slow_net INT,
  PRIMARY KEY (ts, app, property_id, page))               -- + rum_hourly roll-up
rum_errors (fingerprint PK, app, page, message, count, first_seen, last_seen)
pos_health (ts PK, ok BOOL, response_ms, payload JSONB)  -- one per minute, 7 days
platform_settings (key VARCHAR(60) PK, value JSONB)      -- superadmin Telegram link, alert thresholds
```

## 2. Collectors (PMS server) — `server/monitoring/`

- **`requestMetrics.js`** — middleware mounted first in `server/index.js`. On `res.finish`: duration, status,
  `req.propertyId` (when auth set it), route key = `req.method + ' ' + (req.baseUrl + req.route?.path)` (fallback
  `unmatched`). Keeps per-minute buckets in memory (durations in a small fixed-bucket histogram for p50 / p95 —
  no arrays of every timing). Skips `/api/health` and the monitoring endpoints themselves.
- **Error capture** — the existing Express error handler and `process.on('unhandledRejection' / 'uncaughtException')`
  (log, don't exit behaviour unchanged) record into `app_errors` (fingerprint = hash of message without numbers / ids + route).
  Also wrap `console.error` lightly: lines starting with a `[Tag]` are counted per tag per minute (so `[MQTT] Error`
  shows as "MQTT: 12/min" instead of only filling the log) — stored as `app_errors` with route = the tag.
- **`hostSampler.js`** — every 60 s: host CPU (from `/proc/stat` delta), load, memory + swap (`/proc/meminfo`),
  disk of `/` (`fs.statfs`), process RSS / heap, event-loop delay (`perf_hooks.monitorEventLoopDelay`, p99, reset each
  minute), pg pool `totalCount / idleCount / waitingCount`. Flushes the request buckets into `sys_minute` + `req_minute`.
- **Jobs** — wrap every `cron.schedule` callback in `server/jobs/index.js` (and the Channex sync loop, telegram polling
  start, any `setInterval` workers) with `trackJob(name, fn)` → `job_runs` row with duration / ok / error. Expected
  schedule per job kept next to it so the page can show "late" (should have run, hasn't).
- **Integrations** — `integration_status` updated where the call already happens (no extra traffic): Channex
  (`channelHealth` / channelSync success / failure), Telegram send, SMTP send (mailer), POS calls (posRoomOrders /
  posPurchases / events), MQTT connect / error (`server/mqtt/index.js`), Anthropic API (`claude.js` / `assistant.js`),
  holiday / Google Places APIs. Per property where the integration is per property.
- **Backups** — every 15 min read the backup folder (`BACKUP_DIR` env, default `/var/backups/<app folder>-pms`, same
  rule as `deploy.sh`): newest file, its time and size. Missing folder = "unknown", not an error.
- **Sizes** — hourly: database size (`pg_database_size`), largest tables (top 10), `server/uploads` size per property
  where the path holds the property, pm2 log folder size (`~/.pm2/logs`).
- **Version** — at start: git commit + date (read `.git/HEAD` / `git log -1` once), Node version, start time.
  pm2 restarts via `pm2 jlist` once a minute (`child_process.execFile`, 5 s timeout; skip when pm2 is not there).

## 3. Browser timing (RUM) — all apps

- Tiny shared module (copy into each app: `client`, `room-display`, `tv-display`, `kitchen-display`, `resto-display`,
  later `booking`): on page load reads Navigation Timing (load, TTFB), counts JS errors (`window.onerror`,
  `unhandledrejection`, message + page only), and an axios interceptor (or fetch wrapper) records API call durations
  and failures. `navigator.connection.effectiveType` → "slow network" flag (2g / slow-3g or RTT > 600 ms).
- **Page = route pattern** (`/bookings/:id`, never the real id). No personal data, no URLs with tokens, no user names.
- Batched: sent with `navigator.sendBeacon` every 60 s and on `visibilitychange` → `POST /api/metrics/rum`
  `{ app, property_slug?, page samples..., errors... }`. Max 20 KB per beacon; rate limit 10 / min per IP; aggregated
  in memory into `rum_minute` / `rum_errors` like the request metrics. Accepted without login (tablets / TVs have
  device tokens, the booking page has none); property from the token when present, else the slug.
- Can be switched off per app by a constant; sampling rate setting (default 100 % — the platform is small).

## 4. API — `routes/systemStatus.js`, mounted `/api/admin/system` behind `authSuperAdmin`

- `GET /overview` — the tiles below + active alerts.
- `GET /series?metric=&range=1h|24h|7d|30d|90d` — from minute or hourly rows.
- `GET /routes?range=&property_id=` — slowest / busiest / most failing routes.
- `GET /errors?range=` — server + browser errors, grouped, with counts; `POST /errors/:fp/resolve` (hide until it recurs).
- `GET /jobs`, `GET /integrations`, `GET /hotels?range=`, `GET /rum?range=&app=&property_id=`, `GET /pos?range=`.
- `GET /api/health` (public) becomes a real check: DB `SELECT 1` within 2 s → 200 `{ status:'ok', db:'ok', version }`,
  else 503. Used by the outside uptime monitor.

## 5. Superadmin page — `client/src/pages/admin/SystemStatus.jsx` (+ nav item in `AdminLayout.jsx`)

Refresh every 30 s while visible (pause when the tab is hidden). Range picker 1 h / 24 h / 7 d / 30 d / 90 d.
Mobile-friendly (the owner will check it from the phone).

- **Overview** — status tiles with green / amber / red: CPU, RAM (+ swap), disk, PMS process (memory, restarts,
  uptime, version), requests / min, p95 response, error rate, event-loop delay, last backup age, jobs (failed / late),
  integrations (failing count), POS (up / down, response time). Active alerts list on top.
- **Server** — charts: CPU + load, RAM + swap, disk, process memory, event-loop delay, DB connections; DB size and
  top tables; uploads and log sizes.
- **App** — requests / min, p50 / p95, 4xx / 5xx; tables: slowest routes, busiest routes, failing routes (click →
  per-hotel split); **Errors** (server, grouped, last seen, count, stack on click, Resolve).
- **Jobs & integrations** — each job: schedule, last run, duration, ok / failed / late, last error, mini history;
  each integration (per hotel where relevant): ok / failing since, last error.
- **Hotels** — one row per property: requests / day, errors, p95, active staff users today (distinct users with
  requests), devices online / total (room display devices `last_seen_at`, room tablets, TVs, kitchen / resto displays —
  use the existing last-seen columns, "online" = seen in the last 5 min), storage used, modules on, browser p95 load
  time and slow-network share. Click → that hotel's routes, errors, devices list (name, last seen), browser timings.
- **Browsers** — per app (PMS, Room display, TV, Kitchen, Resto, Booking): page load p50 / p95, slowest pages, API time
  as the browser sees it vs the server's own time (the gap = network / wifi), JS errors grouped, slow-network share.
- **POS** — up / down history, response time, its host and process figures (section 7), version, last error.
- **Settings** — alert thresholds, Connect Telegram (section 6), "send test alert".

## 6. Alerts to the superadmin (Telegram)

- **Connect**: Settings → *Connect my Telegram* → link to the **platform bot** (`TELEGRAM_BOT_TOKEN`) with a one-time
  token (same pattern as `telegramLink.js`); the chat id is stored in `platform_settings.superadmin_telegram`.
  Fallback: `SUPERADMIN_TELEGRAM_CHAT_ID` env.
- Checked every minute by a job; each alert fires once when it starts and once when it clears ("✅ back to normal"),
  re-sent at most every 6 h while it lasts. Thresholds editable (defaults):
  - RAM available < 10 % for 5 min, or swap used > 1 GB · disk > 85 % · CPU > 90 % for 10 min
  - event-loop p99 > 500 ms for 3 min · 5xx > 2 % of requests over 5 min (min 20 requests) · p95 > 3 s for 5 min
  - a new server error type (first time seen) — batched, max one message / 15 min
  - newest backup older than 26 h · a job failed, or is late by > 2× its interval
  - an integration failing for 15 min (per hotel) · POS not answering for 5 min
  - pm2 restart that was not a deploy (restart count went up and the version did not change)

## 7. POS side (zahillpos)

- `GET /api/hotel/health` (existing `hotelAuth`, hotel key): `{ ok, version (git commit / date), started_at,
  uptime_s, node, process: { rss_mb, heap_mb, event_loop_p99_ms }, host: { load1, cpu_count, mem_total_mb,
  mem_avail_mb, swap_used_mb, disk_total_gb, disk_used_gb }, db: { ok, ms, size_mb }, errors_last_hour,
  pms_link: { ok, last_error } }` — computed on request, cheap (no stored history on the POS).
- Count `console.error` lines per hour in memory for `errors_last_hour` (same light wrapper as the PMS).
- PMS: a job every minute calls it for each property with the POS linked (`posRoomOrders.config`), 5 s timeout,
  stores `pos_health`, feeds the POS tab and the "POS not answering" alert.

## 8. Outside the code (owner)

- Add a free external uptime monitor (UptimeRobot or Better Stack) on `https://pms.zahill.kdai.cloud/api/health`,
  every 1–5 min, alerting by Telegram / WhatsApp — the only way to know when the whole server is down.
- `pm2 install pm2-logrotate` (keeps logs from filling the disk).

## Order of work

1. Migration, request metrics, host sampler, error capture, retention / roll-up job, real `/api/health`.
2. Job tracking, integrations, backups, sizes, version.
3. API + page (Overview, Server, App, Jobs & integrations).
4. Hotels tab + device counts. 5. RUM in every app + Browsers tab. 6. POS endpoint + POS tab. 7. Telegram alerts.

## Acceptance checks

1. With the app idle, metrics add < 1 % CPU and < 15 MB RSS (measure before / after with `ps` over 10 min);
   `sys_minute` has one row per minute; after 8 days minute rows older than 7 days are gone and hourly rows exist.
2. Load test 50 req/s for 1 min on a cheap route → requests / min, p95 and the route table match (± 5 %);
   a route throwing 500 shows in failing routes and in Errors grouped as one row with a count.
3. Stop PostgreSQL → `/api/health` 503 within 3 s; start → 200.
4. A job made to throw → `job_runs` failed, page red, Telegram alert; job not run for 2× interval → "late".
5. MQTT broker unreachable (today's prod state) → MQTT integration red, errors counted per minute, one alert (not one per line).
6. Backup folder with a file 30 h old → red tile + alert; fresh backup → green + "back to normal" message.
7. Browser: open PMS pages on a throttled "Slow 3G" profile → Browsers tab shows the pages, higher load times,
   slow-network share; a thrown JS error appears grouped; no ids, tokens or names in any stored page / message.
8. POS stopped → POS tab down, alert after 5 min, recovery message when started.
9. Superadmin-only: a hotel owner's token → 403 on every `/api/admin/system` route; RUM endpoint refuses > 20 KB bodies and is rate limited.
10. Page at 390 px and 1280 px; refresh pauses when the tab is hidden.
