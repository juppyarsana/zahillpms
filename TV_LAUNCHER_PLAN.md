# Zahill TV Launcher — Implementation Plan

> Status: **Phases 1–2 built 2026-10-28** (`tv-launcher/`, see its README; tried on the room TV at
> 192.168.20.116 against a local server). Phases 3–4 not started. Design approved in principle: the
> "Zahill TV Home" design canvas (4 screens: Home with guest, Home room ready, Dining,
> Activities), exported as images to `tv-launcher/design/`. Supersedes the "Android TV" track of `ROOM_DISPLAY_KIOSK_PLAN.md`, which
> planned to add a launcher activity to `tv-screensaver/`; this plan replaces the
> screensaver app with a full launcher instead.

## Context
- Guest TVs are **Sharp AQUOS-TVX19A**, Android TV **11 (SDK 30)**, Google Play
  certified, Chromecast built in. Stock home is `com.google.android.tvlauncher`
  (HOME priority 2). Sharp also registers `rcota.android.av.sharp.co.jp.rcota` as a HOME
  activity (priority 0) — purpose unknown, leave it enabled.
- Today each TV runs `tv-screensaver/` (`com.zahill.tvscreensaver`): a `DreamService` +
  "Zahill Welcome" activity showing the `tv-display/` page in a WebView. Guests only see
  it after 5 minutes idle, or when housekeeping opens it by hand.
- Goal: the TV turns on straight into a Zahill home screen — welcome and stay info,
  streaming apps, and hotel information fed from the PMS — with no stock Google TV
  home, no ads, and later a reset of guest sign-ins at checkout.
- Tried on a room TV 2026-10-28: both **CleanYourTV** (Gathin23/cleanyourtv, MIT, ~17k
  lines Java) and **tv-home** (mihirgupta0900/tv-home, MIT, one 850-line
  `MainActivity.java`) install and run as Home on the TVX19A once the stock launcher is
  disabled.

## Decisions
1. **Base: fork tv-home**, not CleanYourTV. Its whole UI is built in code in one file,
   so the Zahill layout (logo, welcome block, two tile rows) is a rewrite of
   `buildUi()` / `buildHeader()`, not a fight with themes, cards and an app library we
   would remove anyway. Borrow from CleanYourTV where useful: its debloat tooling
   (`tools/disable.sh`, `restore.sh`, `check.py`) and Home-key fixes.
2. **Same repo**, new folder **`tv-launcher/`**, Gradle project (based on the
   `tv-home-gradle` wrapper built 2026-10-28). Java (tv-home) plus the screensaver's
   Kotlin files.
3. **One app per TV.** The launcher absorbs the screensaver: `ZahillDreamService`,
   the settings screen (room ID, display token, base URL; hold OK 3 s to open) and
   `WRITE_SECURE_SETTINGS` self-selection move into `tv-launcher/`. `tv-screensaver/` is
   retired after rollout.
4. **Native Home, web details.**
   - **Home screen is native**: background, logo, clock, welcome block, the "Watch" row
     and the "At Zahill" row. Data comes from the JSON the TV page already uses
     (`GET /api/display/room/:roomId/state`, `authDisplay`), refreshed on every return
     to Home and every few minutes. Keeps D-pad focus fully native and fast.
   - **Hotel info screens are web pages** in `tv-display/`, opened full screen in a
     WebView from the "At Zahill" tiles: Dining & Menu, Activities, Hotel Guide, Today
     at Zahill. Content changes need no APK update. They reuse existing endpoints
     (`/room/:roomId/menu`, `/room/:roomId/activities`, Guest Board cards).
5. **New package and a shared release key**: `com.zahill.tv`, signed with a release
   keystore kept out of git (`keystore.properties`, same pattern as the other Android
   apps). Avoids the screensaver's "only installs from the laptop that built it" problem.
   TVs are set up with a provisioning script (Phase 3), so re-entering room settings is
   scripted, not manual.
6. **Stock launcher disabled** (`pm disable-user com.google.android.tvlauncher`),
   reversibly. Nothing uninstalled.
7. **Netflix: open decision** (see Open questions). Nothing in the build depends on it.

## Background rules (PMS-controlled)
Order of precedence for the Home background:
1. **Guest Board photos** (`guest_board_cards.image_url`, cards shown on rooms) rotate
   as the background, like the current TV page. A property setting can switch this off.
2. Otherwise the **TV background by time of day** from Settings: up to three images,
   **Morning / Day / Night**, each with a start time (defaults 05:00 / 11:00 / 18:00,
   property time). Only one uploaded → used all day.
3. Nothing uploaded → the built-in default photo (the current `tv-display` sunrise).

The accent colour follows `property_settings.brand_color` (default gold `#c9a227`), and
the logo `property_settings.logo_url`, so every property on the PMS gets its own look.

## Phase 1 — Launcher shell (tv-launcher/)
- New `tv-launcher/` from `tv-home-gradle`; `applicationId com.zahill.tv`,
  minSdk 30; `.gitignore` lines copied from `tv-screensaver/`.
- Port from `tv-screensaver/`: `Preferences.kt`, settings `MainActivity.kt` (rename to
  `SettingsActivity`), `ZahillDreamService.kt`, `WelcomeWeb.kt`.
- Rebuild `MainActivity` layout to the design: background image layer (crossfade),
  logo top-left, clock/date/weather top-right, welcome block (greeting, guest name, room,
  check-out, Wi-Fi, breakfast), "Watch" row, "At Zahill" row, Inputs and EN/ID pills.
- **Room states**: occupied (guest name + stay chips) vs vacant ("Welcome to your room ·
  Ready for guests"), from the `/state` response, as `tv-display` does today.
- **Watch row**: configurable package list (Netflix, YouTube, Prime Video, Disney+
  Hotstar, Vidio, Spotify); skip apps not installed; app banners from the system. Add a
  "Cast from phone" tile with short instructions.
- **At Zahill row**: four tiles opening `HotelInfoActivity` (full-screen WebView) on
  `tv-display` routes.
- Sharp specifics: find the Live TV / tuner package and Sharp's input picker with
  `pm list packages`; replace tv-home's TCL values in `config.xml`.
- Keep tv-home's known fixes (Home task reset, `getChangedPackages` re-check, one `pm`
  call per shell command).
- **Built 2026-10-28.** Checked on the TV (Sharp, 1280×720) with the local PMS through
  `adb reverse`: guest and empty-room Home, rows, D-pad focus between pills / Watch / At-hotel,
  EN / ID, Inputs list (AV IN, HDMI 1–3, Live TV = `com.mediatek.wwtv.tvcenter`), Cast panel,
  Guest Board photos rotating as the background, a hotel tile opening its page and Back.
  Not checked: holding OK 3 s for the settings (adb can't hold a key on this TV — try with the
  remote), the screensaver, the release key (no `keystore.properties` yet — debug builds are
  signed with the building PC's key). `/state` now also returns `unit.type` (room type for
  "Room 12 · Deluxe Lake View"); Wi-Fi / breakfast / check-out time chips appear once the
  Phase 2 `tv` object exists. Disney+ Hotstar is not installed on the test TV, so it's skipped.

## Phase 2 — PMS side
- **Migration 142**: `property_settings` gains `tv_backgrounds JSONB` (list of
  `{slot, start, image_url}`, max 3) and `tv_bg_use_board BOOLEAN DEFAULT true`.
- **Settings page**: "TV background" section — three uploads with start times, the
  Guest Board switch, preview.
- **Display API**: `/room/:roomId/state` gains a `tv` object — `background_urls`
  (already resolved by the rules above for "now"), `accent`, `wifi` (SSID + password,
  new property setting if not present), `breakfast` (hours + outlet).
- **tv-display**: new D-pad-friendly routes for the hotel info screens (`/info/dining`,
  `/info/activities`, `/info/guide`, `/info/today`) matching the design: large focus
  rings, arrow-key navigation, Back closes. Dining/Activities read-only first; ordering
  and booking from the TV later (endpoints already exist for the tablet).

- **Built 2026-10-28** as planned, with these choices: the settings live on the **Guest Board page**
  (card *Room TV Home*, `/api/board/tv`, Guest Board permission) rather than a new Settings page;
  check-out time added (`checkout_time`); photos go to `uploads/board` / `/board-images/` so no
  nginx change is needed; the `tv` object carries `checkout_time` too. Info pages: Dining shows the
  POS menu (emoji instead of dish photos — the POS has none) and only for a checked-in room (the
  POS endpoint needs a stay); Activities take photos and text from linked Guest Board cards;
  Guide = Wi-Fi / breakfast / check-out + *property* and *dining* cards; Today = *notice* and
  *activity* cards. The page's ‹ button closes via a `ZahillTV.close()` bridge. Checked: 17 HTTP
  checks, the Guest Board card in headless Chrome at 1366px and 390px (found and fixed the settings
  frame growing past a phone's width), all four pages and Home on the TV with the remote.
  Not done: ordering / booking from the TV, an EN / ID switch inside the pages (they follow
  Home's language via `?lang=`).

## Phase 3 — Rollout
- **Debloat list for the TVX19A** using CleanYourTV's tools (no TVX19A list exists
  upstream yet): disable Sharp/Google home, recommendations and telemetry; keep tuner,
  HDMI inputs, Widevine/DRM, Chromecast, Play services. Test on one room first.
- **Provisioning script** (`tv-launcher/provision.ps1`): for a TV IP + room — install
  the APK, grant `WRITE_SECURE_SETTINGS` and location, write room ID / token / URL via an
  intent to `SettingsActivity`, set as screensaver, disable the stock launcher,
  `set-home-activity com.zahill.tv/.MainActivity`, uninstall `com.zahill.tvscreensaver`.
- Room list from the PMS (units) → run once per TV.
- Restore path: `pm enable com.google.android.tvlauncher` + CleanYourTV `restore.sh`.

## Phase 4 — Device Owner, lock-down, checkout reset (later)
- Requires a factory reset per TV and provisioning without a Google account first
  (`dpm set-device-owner com.zahill.tv/.AdminReceiver`); Play Store apps installed after.
- **Checkout reset**: on checkout the PMS notifies the TV (existing SSE / polling of
  `/state`), the launcher calls `DevicePolicyManager.clearApplicationUserData` for the
  streaming apps (skipping any house-account apps), and returns Home.
- Lock-down: hide/PIN-protect Settings, block factory reset and app installs for guests.
- Device health telemetry like the tablets (`POST /room/:roomId/telemetry`).

## Open questions
- **Netflix**: guest's own account + checkout reset, casting only, or house accounts
  (9 accounts × 4 streams considered). House accounts conflict with Netflix's
  personal/non-commercial terms and expose shared viewing history between rooms.
- What `rcota.android.av.sharp.co.jp.rcota` does (leave it enabled until known).
- Guest network: client isolation on? (Affects casting from guest phones.)
- Languages: EN / ID toggle on Home only, or the info pages too.
