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

## Room Display — To Be Built

**What it is:** A PWA designed specifically for the Samsung Galaxy Tab A9 (8.7" screen) mounted in each glamping unit. It runs in kiosk/fullscreen mode and shows:
- Guest name, check-in/out dates, and stay details when the room is occupied
- Room device controls (relay toggles, RGB LED, AC via IR)
- A welcome/idle screen when the room is vacant

**Key decisions:**
- Separate PWA app (`room-display/` folder in this monorepo)
- Served from subdomain: `display.birdneststay.id`
- Talks to the same backend (`server/`) via REST and WebSocket
- Does NOT go through MQTT directly — backend is the bridge
- Touch-optimized UI, large tap targets, no keyboard input needed
- Kiosk mode: no browser chrome, no navigation away from the app
- Each tablet is configured with its Room ID (e.g. `?room=1` or stored in localStorage)

**Stack:** React/Vite PWA (same as `client/`) — keeps the tech consistent.

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
