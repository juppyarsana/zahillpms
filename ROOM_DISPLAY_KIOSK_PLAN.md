# Room Display Kiosk APK & Android TV Launcher — Implementation Plan

> Status: **Phase 1 built + verified on a real tablet 2026-09-11** (migration 052) —
> `room-display-kiosk/` Android project, `POST /telemetry` endpoint, `room_display_devices`
> table, Dashboard badges, PWA kiosk chip. APK built (JDK 21 + auto-downloaded android-35)
> and run on a Samsung Galaxy Tab A9 (Android 16): PWA loads fullscreen, kiosk chip shows,
> full telemetry (battery/wifi SSID/storage/uptime/WebView version) reaches the Dashboard.
> Telemetry interval is 2 min; Dashboard marks a tablet offline after ~6 min. Phases 2–4
> not started. See also the "Room Display Kiosk APK" section in `ROADMAP.md`.

## Context
- 35-room property; each room has a tablet running **Room Display** (currently the
  `room-display/` React/Vite PWA, loaded in the tablet's browser) and, separately, an
  Android TV for the guest.
- Goals: make Room Display feel native, centrally track each tablet's live battery (and
  other health signals), and lock the guest out of everything on the tablet except
  Room Display.
- Also want the Android TV to feel like a hotel TV: a custom launcher with shortcuts
  (Netflix, YouTube, PMS guest info) on top of the screensaver that already exists.
- New company, limited resources — prioritise free / self-built over paid MDM for now.
- A personal Android tablet is available for testing.

## Current state this plan builds on
- **Room Display** is `room-display/` — a PWA. Device identity is a per-property
  `display_token` plus a `roomId`, both stored in `localStorage` on the physical tablet
  (the one sanctioned `localStorage` exception in the codebase). It calls
  `GET /api/display/room/:roomId/state` via the `authDisplay` middleware — no staff JWT.
  A 5-rapid-tap gesture opens its debug menu.
- **There is no Android wrapper for Room Display yet** — the tablet just runs the PWA in
  a browser. That wrapper APK is the main deliverable of this plan and is **greenfield**:
  new project directory (`room-display-kiosk/`), new package name, new signing key.
- **The Android TV screensaver already exists**: `tv-screensaver/` — a Kotlin
  `DreamService` (`com.zahill.tvscreensaver`) that wraps the `tv-display/` web page in a
  fullscreen WebView, with a settings activity for room ID / token / TV URL and
  `WRITE_SECURE_SETTINGS` to select itself as the active dream. The TV track in this plan
  is an **update to that existing APK** (add a launcher activity, add Lock Task), **not**
  a new project — and it is deliberately deferred until the new Room Display APK is built
  and stable (see Build Order).

## Decided Approach — Room Display tablet APK

**Architecture:** Native Android wrapper app (fullscreen WebView pointing at the existing
Room Display PWA URL), not PWA-only — needed for OS-level battery/health access and true
guest lock-down, neither of which a PWA can do.

**Lock-down mechanism:** Android Device Owner + Lock Task API (`DevicePolicyManager` +
`startLockTask()`). The standard Google-native kiosk (COSU) mechanism — zero licensing
cost, not tied to any MDM.

**Battery / health tracking:** `BatteryManager` API / `ACTION_BATTERY_CHANGED` broadcast,
read natively, then used **two ways** — both in Phase 1:

1. **Bridged into the WebView** via a `@JavascriptInterface` so the Room Display PWA can
   show this tablet's own battery % / charging state inline.
2. **Pushed to the backend** so the PMS Dashboard shows every tablet's status in one
   place. This needs, and is part of Phase 1:
   - **Migration (next number, currently 052)** — new `room_display_devices` table,
     `property_id`-scoped per project convention. Unique `(property_id, controller_id)`.
     Most columns nullable so the APK can send a partial payload and the schema can grow
     without a migration each time. Columns:
     - identity/liveness: `property_id`, `controller_id` (the room ID), `last_seen_at`,
       `created_at`, `updated_at`
     - power: `battery_level` (int %), `battery_charging` (bool),
       `power_source` (`ac`/`usb`/`wireless`/`none`), `battery_temp_c` (numeric)
     - network: `network_type` (`wifi`/`ethernet`/`cellular`/`none`),
       `internet_ok` (bool — from `NetworkCapabilities.NET_CAPABILITY_VALIDATED`, i.e.
       Android has actually confirmed internet, not just "associated to an AP"),
       `wifi_ssid`, `wifi_bssid` (which AP — catches a tablet stuck on a far/weak one),
       `wifi_rssi` (int dBm), `wifi_link_speed_mbps` (int), `wifi_frequency_mhz` (int —
       2.4 vs 5 GHz), `ip_address` (text)
     - host: `storage_free_mb`, `storage_total_mb`, `uptime_seconds` (bigint),
       `app_version`, `webview_version` (the Chrome/WebView package version — this app
       *is* a WebView shell), `android_version`, `device_model`, `screen_on` (bool)
   - **SSID / BSSID / RSSI permission caveat:** on Android 9+ a normal app needs
     `ACCESS_FINE_LOCATION` **and** location services on to read SSID/BSSID/RSSI — they
     come back as `<unknown ssid>` / null otherwise. A **Device Owner** app is exempt, so
     from Phase 2 onward this is a non-issue; during Phase 1 testing on the personal
     tablet, grant the location permission (or accept null wifi identity until
     device-owner is claimed). Battery/storage/uptime/network-type/`internet_ok` need no
     special permission.
   - **Endpoint** — `POST /api/display/room/:roomId/telemetry` on `routes/display.js`,
     `authDisplay` (per-property `display_token`), **no `moduleGuard`** (device health is
     always-on, like `GET /state`). Upserts the row by `(property_id, controller_id)`.
   - **Transport** — a **dedicated `POST /telemetry` from the APK itself** (it has the
     stored `display_token` + `roomId`), on an interval (~2 min) plus on significant
     change (charging state flip, battery crosses a threshold, network up/down). Kept as
     its own channel — **not** piggybacked onto the PWA's existing `GET /state` 10s poll:
     direct-from-APK still reports "tablet online, battery 12%" even when the web app
     fails to load, which is exactly when you most want to know. `last_seen_at` on this
     POST doubles as the tablet's liveness heartbeat.
   - **Dashboard** — `routes/dashboard.js`'s occupancy query `LEFT JOIN
     room_display_devices` on `controller_id`; Live Unit Status tiles get a badge for
     low battery, offline, or "on wifi but no internet" (`internet_ok = false`). The
     `UnitCard` popover shows battery % + charging, wifi SSID + signal (derive bars from
     `wifi_rssi`), last-seen, and app/WebView version. "Offline" = `last_seen_at` older
     than ~6 min (3 missed intervals).
- **What's still deferred to Phase 3 (Headwind):** OTA app-push, QR enrolment, and a
  richer standalone fleet dashboard. The basic "is this tablet alive and charged" view
  lands in Phase 1 via the pipeline above — it does not wait for Headwind.

**Provisioning (no MDM, sideload only, for now):**
- Requires a clean, accountless tablet (factory reset only if the tablet already has a
  Google/other account on it — brand-new / unset-up tablets don't need a reset).
- Sideload via `adb install`, then claim device-owner via
  `adb shell dpm set-device-owner com.yourpackage/.YourDeviceAdminReceiver`.
- Same underlying mechanism as QR-code MDM enrolment, just done manually — no server needed.

**Auto-launch after reboot:**
- `BOOT_COMPLETED` broadcast receiver launches the main activity on boot, which
  re-calls `startLockTask()`.
- App also registered as the default Home/launcher (`addPersistentPreferredActivity` or
  `HOME`/`DEFAULT` intent categories) as a second guarantee.

**Un-enrolment / release:**
- Hidden gesture (e.g. long-press a corner 5×) opens a PIN-protected screen calling
  `clearDeviceOwnerApp()`. Reuse the same 5-tap idiom the PWA debug menu already uses so
  staff only learn one gesture.
- Factory reset is the fallback if the app / PIN screen is ever inaccessible.

**Content updates:**
- The app is a WebView shell, so almost all day-to-day change (branding, guest info,
  layout, bug fixes) ships by updating the web app — no APK rebuild, no touching tablets.
- APK updates are only needed for: new native bridge methods (new sensor/health data),
  changes to lock-task / device-owner logic, boot-receiver logic, or permission/manifest
  changes.
- Device-owner status **and the WebView's `localStorage`** (so the stored
  `roomId` / `displayToken` survive) persist across APK updates as long as package name +
  signing key stay the same — `adb install -r` works, no factory reset.
- Build a native fallback ("Reconnecting…") for `WebView.onReceivedError` — these are
  unattended tablets and a blank error page is a bad guest experience.

**Other health data worth bridging into the WebView (beyond battery), roughly in priority
order:**
- WiFi / network status (online/offline, signal strength) — likely the 2nd most common
  failure mode after battery.
- Storage free space.
- Uptime since last reboot.
- App version / build number.
- Last successful `GET /state` timestamp (staleness signal).
- Device temperature (if exposed via `BatteryManager`).

## MDM Layer — Headwind MDM (Deferred to Phase 3 / next client)

- **Important distinction:** true single-app kiosk / COSU lock-down is a Headwind
  **Enterprise**-only feature, NOT Community. So lock-down is always handled by our own
  Device Owner / Lock Task code, regardless of MDM tier.
- Headwind **Community** (free, self-hosted, open-source) is used only for: fleet
  dashboard (device status / battery monitoring), OTA app-push / updates, QR-based
  enrolment — running in "Application mode" (not device owner) alongside our own wrapper
  app, which remains the actual device owner.
- Self-hosting: official `h-mdm/hmdm-docker` image, requires an external PostgreSQL
  container (can run on the same VPS, just a separate container — not the same one as the
  app), HTTPS via certbot (required for QR enrolment).
- Use the **stock / unmodified** Headwind agent APK — custom-rebuilt Headwind launcher
  builds are blocked by Play Protect on GMS-certified devices as of 2026.
- Community edition supports up to 300 devices free — comfortably covers 35 tablets and
  near-future growth.

## Decided Approach — Android TV (update to existing `tv-screensaver` APK, after the tablet APK is stable)

- The screensaver half is **already built** (`tv-screensaver/`,
  `com.zahill.tvscreensaver`, `ZahillDreamService` → WebView of `tv-display/`). This
  track only *adds* the launcher + lock-down to that same project.
- Netflix / OTT apps **cannot** be embedded in a WebView (DRM / Widevine + licensing
  terms prohibit it).
- Instead: a launcher activity with tiles that launch installed OTT apps via standard
  Android intents (`packageManager.getLaunchIntentForPackage(...)`) — just app-launching,
  not embedding, so no DRM / licensing concern on our side.
- Launcher registered as default `HOME` category app, using Device Owner + Lock Task
  (multi-app whitelist) so guests can't escape to system settings or other apps.
- Idle screensaver stays the existing `DreamService` WebView — no change needed there.
- TV hardware must be Google Play Certified / GMS-licensed for Netflix DRM (Widevine) to
  function — a purchasing requirement, not just a software one.
- Netflix account / licensing (house account vs. per-guest login) is a separate
  contractual / billing decision, not a technical one.

## Build Order

**Phase 1 — Data bridge + telemetry (new `room-display-kiosk/` APK + backend) — ✅ BUILT 2026-09-11**
Wrapper APK (`room-display-kiosk/`, `com.zahill.roomdisplay`): fullscreen landscape WebView
of the Room Display PWA + `window.AndroidKiosk` bridge (`isKiosk`/`getConfig`/
`getDeviceStats`/`openSettings`), `SettingsActivity` for Room ID / token / URL, a 5-tap
corner escape hatch, `onReceivedError` reconnect overlay, `mediaPlaybackRequiresUserGesture
=false`. `TelemetryScheduler` (`ScheduledExecutorService` + `HttpURLConnection`, no new
deps) POSTs every 2 min + on battery/connectivity change while started. Backend: migration
`052_room_display_devices.sql`, `POST /api/display/room/:roomId/telemetry` (whitelist +
clamp + dynamic-column upsert), `dashboard/summary` LEFT JOIN → `tablet_*` columns. Client:
`Dashboard.jsx` `tabletHealth()` + `UnitTile` badge + `UnitCard` "Room tablet" section.
`room-display/`: `src/kiosk.js`, `bootstrapKiosk()` in `main.jsx`, `KioskChip.jsx`,
`DebugMenu.jsx` Device section. **Still to do:** build the APK in Android Studio (this
laptop lacks Android Studio + android-35 SDK — use the PC, same as `tv-screensaver/`),
sideload to the test tablet, verify telemetry reaches the Dashboard.

**Phase 2 — Lock-down + auto-launch (same APK)**
Add `DeviceAdminReceiver`, claim device-owner via ADB (factory reset the test tablet
first if it already has an account), call `startLockTask()`, add `BOOT_COMPLETED`
receiver + Home/launcher registration, add the hidden PIN-protected release screen. Goal:
the guest can't escape to home / settings, and a reboot lands straight back in Room Display.

**Phase 3 — MDM layer (Headwind)**
Once Phases 1–2 are proven and there's a second client / property, stand up Headwind MDM
Community on a VPS and enrol its agent in Application mode alongside the existing
device-owner app, for **OTA app-push, QR enrolment, and a richer standalone fleet
dashboard** — without touching the lock-down logic. Basic battery/online visibility
already exists from Phase 1's own pipeline; this is the heavier fleet-management layer on
top.

**Phase 4 — Android TV launcher (update to `tv-screensaver/`)**
Only after the Room Display tablet APK is built and stable. Add a launcher activity +
Device Owner / Lock Task (multi-app whitelist) to the **existing** `tv-screensaver`
project. The `DreamService` screensaver already there is unchanged. Same core concepts as
the tablet APK (Device Owner, Lock Task, WebView), so most of Phase 1–2's learnings carry
over.
