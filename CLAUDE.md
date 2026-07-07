# Zahill PMS — Claude Code Context

> Read this file before starting any work. It defines naming conventions, architecture decisions, and current project state agreed upon by the owner.
>
> **This is a fork of Birdnest PMS**, adapted for Zahill. The original project remains available as the `upstream` git remote — fetch/cherry-pick shared bug fixes or improvements from there when useful (`git fetch upstream`).

---

## Project Overview

A Property Management System for **Zahill** <!-- TODO: fill in property type, unit count, and location, e.g. "a 12-room boutique hotel in Ubud, Bali" -->. Built as a monorepo with React/Vite frontend and Node/Express backend. See `PLANNING.md` for full feature specs and database schema.

**Owner:** <!-- TODO: owner name and contact email --><br>
**Live domain:** `pms.d-zahill.kdai.cloud` <!-- TODO: confirm actual subdomain scheme --><br>
**Server:** <!-- TODO: hosting details (cloud VM provider, OS, address) -->

---

## Monorepo Structure

```
Zahill PMS/            ← this repo (PMS + Room Display)
├── client/            ← PMS frontend (React/Vite PWA)
├── server/            ← Shared backend (Node/Express)
├── room-display/      ← Room Display PWA
├── PLANNING.md
└── CLAUDE.md          ← this file

<!-- TODO: if using Room Controller / IoT hardware, note the separate firmware repo here -->
```

---

## Naming Conventions — CRITICAL

These names are final. Do not use alternatives.

| Correct Name | Do NOT call it |
|---|---|
| **Room Controller** | ESP32 controller, IoT device, smart device |
| **Room Display** | IoT panel, tablet app, room tablet, control panel |
| **Zahill PMS** | admin panel, dashboard app |
| **relay** | light, device, switch (in code/API) |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Cloud VM                           │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │  Mosquitto  │◄──│   Backend    │──►│  PostgreSQL │  │
│  │MQTT Broker  │   │ Node/Express │   │     DB      │  │
│  │port 1883    │   │  port 4000   │   │             │  │
│  └──────┬──────┘   └──────┬───────┘   └─────────────┘  │
└─────────┼─────────────────┼───────────────────────────-─┘
          │ MQTT             │ REST / WebSocket
          │                 ├─────────────────────────────►
   ┌──────▼──────┐   ┌──────▼────────┐   ┌──────────────┐
   │    ESP32    │   │  Zahill PMS   │   │ Room Display │
   │Room Control-│   │  client/      │   │room-display/ │
   │    ler      │   │pms.d-zahill.  │   │display.d-    │
   │  per room   │   │  kdai.cloud   │   │zahill...     │
   └─────────────┘   └───────────────┘   └──────────────┘
```

- **Room Controller** — ESP32 in each room (if hardware is used at this property). Controls generic relays, RGB LED, IR blaster (for AC).
- **Room Display** — PWA mounted in each room. Shows guest details when occupied and allows basic room control. Lives at `display.d-zahill.kdai.cloud` <!-- TODO: confirm subdomain -->.
- **Backend** — Shared by both PMS and Room Display. Bridges MQTT ↔ database ↔ frontend.
- **Mosquitto** — MQTT broker on the same VM. Address: `mqtt.d-zahill.kdai.cloud:1883` <!-- TODO: set up broker, confirm address -->.

---

## MQTT Setup

<!-- TODO: this needs its own broker instance and credentials — do NOT reuse Birdnest's mqtt.birdnestay.id broker or topic namespace, to avoid any risk of cross-property command collisions. -->

- Broker: `mqtt.d-zahill.kdai.cloud` port `1883`
- WebSockets: port `9001`
- Auth: username `zahill`, password configured
- DNS: `mqtt.d-zahill.kdai.cloud` A record → VM IP

### Topic Structure

**Subscribe (backend → ESP32):**
- `zahill/room/{id}/relay/{n}/set` — payload: `on` or `off`
- `zahill/room/{id}/rgb/set` — payload: `{"r":255,"g":0,"b":0}`
- `zahill/room/{id}/ir/send` — payload: slot index
- `zahill/room/{id}/request/status` — triggers full status publish

**Publish (ESP32 → backend):**
- `zahill/room/{id}/relay/{n}/state` — `on` or `off` (retained)
- `zahill/room/{id}/rgb/state` — JSON (retained)
- `zahill/room/{id}/status` — full JSON snapshot
- `zahill/room/{id}/connected` — `true`/`false` LWT (retained)

---

## Backend — Current State

**Stack:** Node.js + Express (CommonJS), PostgreSQL (raw SQL), JWT auth, PM2 + Nginx
**Port:** 4000 behind Nginx
**Entry:** `server/index.js`

**Completed routes:**
- `/api/auth` — login/logout
- `/api/units` — glamping unit CRUD
- `/api/guests` — guest profiles
- `/api/bookings` — reservations
- `/api/payments` — deposit/balance tracking
- `/api/checkin` — check-in/out flow
- `/api/allotments` — OTA channel allotment
- `/api/tasks` — operations kanban
- `/api/loyalty` — loyalty tiers
- `/api/products` — ancillary product catalog
- `/api/sales` — ancillary sales
- `/api/dashboard` — owner dashboard summary
- `/api/reports` — revenue reports
- `/api/pricing` — dynamic pricing periods
- `/api/users` — user management
- `/api/settings` — property settings
- `/api/iot` — Room Controller device states and commands
- `/api/insights` — Market Insights: competitor ratings, search trends, holidays, AI weekly briefing (see Market Insights section below)

**IoT database tables (migration 006):**
- `units.controller_id` — links a PMS unit to its ESP32 Room ID (e.g. `"1"`)
- `unit_relays` — relay labels and current state per unit
- `room_controller_status` — online/offline, IP, RGB state per controller

**MQTT client:** `server/mqtt/index.js` — connects to Mosquitto, subscribes to all room topics, updates DB on incoming messages.

---

## In-Room Display Hardware

<!-- TODO: confirm whether Zahill uses the same Room Display / TV Display hardware as Birdnest (Samsung Galaxy Tab A9 + Xiaomi Android TV), or different devices. -->

Each unit can have **two displays** with distinct, complementary roles:

### 1. Room Display
**Primary purpose:** Device control — relay toggles, RGB LED, AC via IR blaster
**Secondary:** Shows guest name and stay dates at a glance

- Calls `GET /api/display/room/:roomId/state` (via `authDisplay` middleware)
- Three screens: `SetupScreen` (first-time config), `IdleScreen` (vacant), `GuestScreen` (occupied)
- Room ID and display token stored in localStorage
- Debug menu triggered by 5 rapid taps
- Stack: React/Vite PWA, served from `display.d-zahill.kdai.cloud` <!-- TODO -->

### 2. TV Welcome Display
**Only purpose:** Welcome guests and show their stay details when TV is idle
**No device controls** — this is purely a guest-facing ambient display

**Key decisions (inherited from Birdnest — re-confirm for Zahill):**
- Guests also use this TV for regular entertainment (Netflix, YouTube, etc.)
- Built as an **Android TV screensaver (DreamService APK)** that wraps a WebView
- Screensaver launches after TV is idle; pressing any remote button exits back to normal TV
- APK is sideloaded onto each TV (no Play Store required)
- Room ID configured once during installation (stored in app SharedPreferences)
- The WebView loads a dedicated page from `tv-display/` in this monorepo
- UI: landscape only, large text, beautiful/branded — Zahill aesthetic, guest-facing
- No touch interaction — passive display only
- Calls the **same backend endpoint** as the Room Display: `GET /api/display/room/:roomId/state`
  - Returns: `unit.name`, `booking.guest_name`, `booking.check_in_date`, `booking.check_out_date`, `booking.num_guests`
  - Returns `booking: null` when room is vacant → show a branded idle screen

**Two parts to build/adapt:**
1. `tv-display/` — simple React/Vite app (or plain HTML) served at `tv.d-zahill.kdai.cloud` <!-- TODO -->. Landscape-only, no controls, large beautiful UI. Two states: occupied (show guest welcome) and vacant (show Zahill branding).
2. `tv-screensaver/` — Kotlin Android TV app (DreamService). Opens `tv.d-zahill.kdai.cloud?room={roomId}` in a fullscreen WebView. Android package is `com.zahill.tvscreensaver`.

**Stack:** Kotlin DreamService APK + React/Vite page served from subdomain

---

## PMS Frontend — Current State

**Stack:** React 18 + Vite 5 + PWA (vite-plugin-pwa)
**Location:** `client/`
**Live at:** `pms.d-zahill.kdai.cloud` <!-- TODO -->

The IoT section in the PMS Settings page shows room controller status (online/offline, relay states, RGB) — only relevant if this property uses Room Controllers.

**Reservations calendar** (`client/src/pages/Reservations.jsx`) shows each available night's effective rate (base rate, overridden by the highest-priority active pricing period) directly in the calendar cells, fetched from `GET /api/pricing/calendar?month=&year=`.

---

## Market Insights (Dashboard)

Three cards on the Owner Dashboard, backed by `server/routes/insights.js`, `server/jobs/marketInsights.js`, and scheduled jobs in `server/jobs/index.js`. All external API calls degrade gracefully (skip + log) when their key isn't set — nothing crashes without them.

**Competitor Ratings** — manually curated, not auto-discovered. Owner types a competitor name into the dashboard card; the backend resolves it via Google Places Text Search (`server/services/googlePlaces.js`) and starts tracking its rating/review count/price level. Add: `POST /api/insights/competitors {name}`. Remove (soft delete, keeps history): `DELETE /api/insights/competitors/:id`. Daily refresh at **06:00** just re-checks whatever's currently active — it does not discover or replace entries.
- Table: `competitors` (id, name, place_id, matched_address, is_self, is_active) + `competitor_snapshots` (rating, review_count, price_level per check).
- **TODO:** the self-benchmark row (`is_self = true`) is currently unset for Zahill — resolve Zahill's own Google Places listing and seed it (see migration `016_competitor_extras.sql`, which currently still has Birdnest's place ID commented context — replace with Zahill's).

**Search Interest** — Google Trends (unofficial library, no official API exists). **TODO:** the tracked search terms in `server/jobs/marketInsights.js` (`TREND_TERMS`) are still Birdnest's ("kintamani glamping", "bali glamping") — update to terms relevant to Zahill's market.

**AI Weekly Briefing** — Claude API (`claude-opus-4-8`, `server/services/claude.js`) reads the current competitor/trends/holidays data and returns a structured JSON briefing (headline + labeled highlights, via `output_config.format`) rather than free prose. **TODO:** the prompt in `claude.js` still describes "Birdnest Glamping Kintamani" — update the property description. Weekly refresh, **Monday** (after trends). Table: `ai_market_summary` (singleton row, `summary` stored as JSON text).

**Holidays** — `holidays` table seeded with Indonesian national + Balinese Hindu observances (Nyepi, Galungan, Kuningan). **TODO:** confirm these are relevant to Zahill's location — if outside Bali, this table needs different regional holidays.

**Property location**: `property_settings.latitude`/`longitude` (migration 015) — **TODO:** currently still seeded with Birdnest's coordinates; update to Zahill's actual location.

Manual refresh triggers (owner only, useful right after a fresh deploy before the cron has fired): `POST /api/insights/competitors/refresh`, `/api/insights/trends/refresh`, `/api/insights/summary/refresh`.

---

## Environment Variables

Add these to `server/.env` — **all values below must be Zahill's own, never shared with Birdnest's**:
```
MQTT_BROKER=mqtt://mqtt.d-zahill.kdai.cloud
MQTT_PORT=1883
MQTT_USERNAME=zahill
MQTT_PASSWORD=<password>
```

Add these for Market Insights:
```
GOOGLE_PLACES_API_KEY=<key>        # console.cloud.google.com — legacy Places API enabled + billing active
ANTHROPIC_API_KEY=<key>            # console.anthropic.com
```

Recommended: use separate Google Cloud / Anthropic accounts (or at least separate API keys) from Birdnest's, so usage and billing don't mix between properties.

---

## Important Conventions

- **Relays are generic** — all relays are `relay_1` through `relay_N` in firmware and database. Human-readable labels (e.g. "Main Light", "AC") are stored in the `unit_relays` table and shown in the PMS UI. Never hardcode relay purposes in firmware.
- **Room IDs** — ESP32 uses simple string IDs. These map to `units.controller_id` in the database.
- **No localStorage in PWA artifacts** — use React state or backend for persistence.
- **CommonJS in server** — `server/` uses `require()` not `import`. Do not convert to ESM.
- **Migrations** — new DB changes go in `server/db/migrations/` as numbered SQL files (next is `018_...`).

---

## Setup Checklist (Fork-Specific TODOs)

This repo was forked from Birdnest PMS. Before going live for Zahill, work through:

- [ ] Fill in property details above (owner, unit count, location, hosting)
- [ ] Set up Zahill's own MQTT broker (do not share Birdnest's)
- [ ] Set up Zahill's own PostgreSQL database
- [ ] Generate fresh secrets (`JWT_SECRET`, `DISPLAY_TOKEN`) — never reuse Birdnest's
- [ ] Get separate `GOOGLE_PLACES_API_KEY` / `ANTHROPIC_API_KEY` (or at least separate keys within existing accounts)
- [ ] Update `server/jobs/marketInsights.js` `TREND_TERMS` for Zahill's market
- [ ] Update `server/services/claude.js` prompt's property description
- [ ] Update `property_settings` coordinates (migration or via Settings UI once built)
- [ ] Resolve and seed Zahill's own self-benchmark competitor row
- [ ] Set up DNS/subdomains for Zahill's actual domain
- [ ] Replace seeded demo units in `server/db/migrations/001_initial.sql` ("Nest 1"–"Nest 5") with Zahill's actual room/unit list and count
- [ ] Replace logo/icon assets (`client/public/logo.png`, PWA icons, `room-display` icon) — still Birdnest's branding
- [ ] `client/src/pages/Dashboard.jsx` — hardcoded `"Kintamani, Bali"` subtitle text needs updating to Zahill's actual location
- [ ] Review `PLANNING.md` — original Birdnest phase plan, adapt as needed for Zahill's requirements
