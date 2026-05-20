# Birdnest PMS — Claude Code Context

> Read this file before starting any work. It defines naming conventions, architecture decisions, and current project state agreed upon by the owner (Juppy).

---

## Project Overview

A Property Management System for **Birdnest Glamping Kintamani**, a 5-unit glamping site in Kintamani, Bali. Built as a monorepo with React/Vite frontend and Node/Express backend. See `PLANNING.md` for full feature specs and database schema.

**Owner:** Juppy (juppyjp@gmail.com)  
**Live domain:** `pms.birdnestay.id`  
**Server:** Ubuntu 24.04 cloud VM at `server.birdnestay.id`

---

## Monorepo Structure

```
Birdnest PMS/          ← this repo (PMS + Room Display)
├── client/            ← PMS frontend (React/Vite PWA)
├── server/            ← Shared backend (Node/Express)
├── room-display/      ← Room Display PWA (to be built)
├── PLANNING.md
└── CLAUDE.md          ← this file

birdnest_iot/          ← separate repo
└── controller/        ← ESP32 firmware
```

---

## Naming Conventions — CRITICAL

These names are final. Do not use alternatives.

| Correct Name | Do NOT call it |
|---|---|
| **Room Controller** | ESP32 controller, IoT device, smart device |
| **Room Display** | IoT panel, tablet app, room tablet, control panel |
| **Birdnest PMS** | admin panel, dashboard app |
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
   │    ESP32    │   │  Birdnest PMS │   │ Room Display │
   │Room Control-│   │  client/      │   │room-display/ │
   │    ler      │   │pms.birdnest-  │   │display.bird- │
   │  per room   │   │  stay.id      │   │ neststay.id  │
   └─────────────┘   └───────────────┘   └──────────────┘
```

- **Room Controller** — ESP32 in each room. Controls 5 generic relays, RGB LED, IR blaster (for AC).
- **Room Display** — PWA on Samsung Galaxy Tab A9 (8.7") mounted in each room. Shows guest details when occupied and allows basic room control. Lives at `display.birdneststay.id`. Built as `room-display/` in this monorepo.
- **Backend** — Shared by both PMS and Room Display. Bridges MQTT ↔ database ↔ frontend.
- **Mosquitto** — MQTT broker on the same VM. Address: `mqtt.birdnestay.id:1883`.

---

## MQTT Setup (Completed)

- Broker: `mqtt.birdnestay.id` port `1883`
- WebSockets: port `9001`
- Auth: username `birdnest`, password configured
- DNS: `mqtt.birdnestay.id` A record → VM IP (Cloudflare, DNS only — no proxy)

### Topic Structure

**Subscribe (backend → ESP32):**
- `birdnest/room/{id}/relay/{n}/set` — payload: `on` or `off`
- `birdnest/room/{id}/rgb/set` — payload: `{"r":255,"g":0,"b":0}`
- `birdnest/room/{id}/ir/send` — payload: slot index
- `birdnest/room/{id}/request/status` — triggers full status publish

**Publish (ESP32 → backend):**
- `birdnest/room/{id}/relay/{n}/state` — `on` or `off` (retained)
- `birdnest/room/{id}/rgb/state` — JSON (retained)
- `birdnest/room/{id}/status` — full JSON snapshot
- `birdnest/room/{id}/connected` — `true`/`false` LWT (retained)

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
- `/api/iot` — Room Controller device states and commands (recently added)

**IoT database tables (migration 006):**
- `units.controller_id` — links a PMS unit to its ESP32 Room ID (e.g. `"1"`)
- `unit_relays` — relay labels and current state per unit
- `room_controller_status` — online/offline, IP, RGB state per controller

**MQTT client:** `server/mqtt/index.js` — connects to Mosquitto, subscribes to all room topics, updates DB on incoming messages.

---

## In-Room Display Hardware — Decided

Each glamping unit has **two displays** with distinct, complementary roles:

### 1. Room Display (Samsung Galaxy Tab A9, 8.7") — ✅ COMPLETE
**Primary purpose:** Device control — relay toggles, RGB LED, AC via IR blaster  
**Secondary:** Shows guest name and stay dates at a glance

**Status:** Built and working. Lives in `room-display/`.
- Calls `GET /api/display/room/:roomId/state` (via `authDisplay` middleware)
- Three screens: `SetupScreen` (first-time config), `IdleScreen` (vacant), `GuestScreen` (occupied)
- Room ID and display token stored in localStorage
- Debug menu triggered by 5 rapid taps
- Stack: React/Vite PWA, served from `display.birdneststay.id`

### 2. TV Welcome Display (Xiaomi 32" Android TV) — 🔨 TO BE BUILT
**Only purpose:** Welcome guests and show their stay details when TV is idle  
**No device controls** — this is purely a guest-facing ambient display

**Key decisions:**
- Guests also use this TV for regular entertainment (Netflix, YouTube, etc.)
- Built as an **Android TV screensaver (DreamService APK)** that wraps a WebView
- Screensaver launches after TV is idle; pressing any remote button exits back to normal TV
- APK is sideloaded onto each Xiaomi TV (no Play Store required)
- Room ID configured once during installation (stored in app SharedPreferences)
- The WebView loads a dedicated page from `tv-display/` in this monorepo
- UI: landscape only, large text, beautiful/branded — Birdnest aesthetic, guest-facing
- No touch interaction — passive display only
- Calls the **same backend endpoint** as the Room Display: `GET /api/display/room/:roomId/state`
  - Returns: `unit.name`, `booking.guest_name`, `booking.check_in_date`, `booking.check_out_date`, `booking.num_guests`
  - Returns `booking: null` when room is vacant → show a branded idle screen

**Two parts to build:**
1. `tv-display/` — simple React/Vite app (or plain HTML) served at `tv.birdnestay.id`. Landscape-only, no controls, large beautiful UI. Two states: occupied (show guest welcome) and vacant (show Birdnest branding).
2. `tv-screensaver/` — tiny Kotlin Android TV app (DreamService). Opens `tv.birdnestay.id?room={roomId}` in a fullscreen WebView. Room ID set once via a simple settings screen, stored in SharedPreferences.

**Stack:** Kotlin DreamService APK + React/Vite page served from subdomain

---

## PMS Frontend — Current State

**Stack:** React 18 + Vite 5 + PWA (vite-plugin-pwa)  
**Location:** `client/`  
**Live at:** `pms.birdnestay.id`

The IoT section in the PMS Settings page shows room controller status (online/offline, relay states, RGB). This was recently added as part of the MQTT integration work.

---

## Environment Variables

Add these to `server/.env` for IoT/MQTT:
```
MQTT_BROKER=mqtt://mqtt.birdnestay.id
MQTT_PORT=1883
MQTT_USERNAME=birdnest
MQTT_PASSWORD=<password>
```

---

## Important Conventions

- **Relays are generic** — all 5 relays are `relay_1` through `relay_5` in firmware and database. Human-readable labels (e.g. "Main Light", "AC") are stored in the `unit_relays` table and shown in the PMS UI. Never hardcode relay purposes in firmware.
- **Room IDs** — ESP32 uses simple string IDs (`"1"` through `"5"`). These map to `units.controller_id` in the database.
- **No localStorage in PWA artifacts** — use React state or backend for persistence.
- **CommonJS in server** — `server/` uses `require()` not `import`. Do not convert to ESM.
- **Migrations** — new DB changes go in `server/db/migrations/` as numbered SQL files (next is `007_...`).
