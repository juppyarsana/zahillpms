# Room Display Kiosk

Native Android wrapper around the Room Display PWA (`room-display/`). It loads
the PWA in a fullscreen landscape WebView, exposes device stats to it via a
`window.AndroidKiosk` bridge, and POSTs telemetry (battery, wifi, storage,
uptime, versions) to the backend so every tablet shows up on the PMS Dashboard.

**Phase 1 only** — no Device Owner / Lock Task / boot receiver yet. 5 taps in
the bottom-right corner open Settings so a test tablet is never locked in.

## Build

```
bash build.sh          # -> ./gradlew clean :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Toolchain mirrors `tv-screensaver/`: AGP 8.3.2, Kotlin 1.9.25, Gradle 8.7,
compileSdk/targetSdk 35, minSdk 24, JDK 17 (Android Studio JBR).

## Configure

Open the app once → enter:
- **Room ID** — the unit's Room ID in the PMS (usually the room number)
- **Display Token** — the property's display token (PMS → Settings → Property
  Details → Device Setup)
- **Room Display URL** — defaults to `https://display.zahill.kdai.cloud`; point
  at `http://<dev-host>:5175` for local testing

Save → the WebView loads `<url>?room=<id>&token=<token>`; the PWA seeds those
into `localStorage` and strips them from the URL.

## Wi-Fi name (SSID)

Reading the Wi-Fi SSID/BSSID needs `ACCESS_FINE_LOCATION` + Location services on
for a non-device-owner app (Android 9+). Grant it from the Settings screen, or
accept a blank SSID. A Device Owner (Phase 2) is exempt and this goes away.

## Telemetry

`POST {baseUrl}/api/display/room/{roomId}/telemetry` with
`Authorization: Bearer <displayToken>` — one immediate on start, then every
2 min, plus on charging/connectivity change. Runs only while the activity is
started (telemetry going stale = "tablet down").

`chrome://inspect` on a dev machine → `window.AndroidKiosk.getDeviceStats()`
returns the same JSON.
