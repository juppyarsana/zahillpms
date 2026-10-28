# Zahill TV (tv-launcher)

The guest TV's Home screen (`com.zahill.tv`). Replaces the stock Google TV home and the old
`tv-screensaver/` app (its screensaver and settings are in here). Plan and phases:
`../TV_LAUNCHER_PLAN.md`. Designs: `design/`.

Started from [tv-home](https://github.com/mihirgupta0900/tv-home) (MIT, `LICENSE-tv-home`).
Fonts: Manrope and Cormorant Garamond (SIL OFL, `app/src/main/assets/fonts/OFL-*.txt`).

## What's in it
| File | |
|---|---|
| `MainActivity.java` | Home: background, logo, clock, welcome block, Watch row, At-hotel row, Inputs, EN / ID, the empty-room card. Hold OK 3 s = settings. |
| `PmsClient.java` | `GET /api/display/room/:roomId/state` (display token) and the pictures it names. |
| `HotelInfoActivity.kt` | A `tv-display` page full screen (`/info/dining`, `/info/activities`, `/info/guide`, `/info/today` — Phase 2). |
| `SettingsActivity.kt` | Room ID, display token, TV URL; set as screensaver; Android settings. |
| `ZahillDreamService.kt`, `WelcomeWeb.kt` | The screensaver (the `tv-display` welcome page), from `tv-screensaver/`. |
| `res/values/config.xml` | Watch row apps, Live TV / input picker packages. |

Everything is drawn in code in pixels of the 1920×1080 design, scaled to the screen.

## Build
```bash
cd tv-launcher
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"; export PATH="$JAVA_HOME/bin:$PATH"
./gradlew :app:assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease    # signed only when keystore.properties exists (not in git)
```
`local.properties` needs `sdk.dir=C\:\\Android\\Sdk` (double backslashes).

## Put it on a TV — `provision/provision.ps1`
One TV:
```powershell
cd tv-launcher\provision
.\provision.ps1 -Tv 192.168.20.116 -Room 101 -Token <display token>     # -BaseUrl defaults to https://tv.zahill.kdai.cloud
```
Every TV: copy `rooms.example.csv` to `rooms.csv` (columns `room,ip`, not in git), then
`.\provision.ps1 -RoomsCsv rooms.csv -Token <display token>`. Safe to run again — a TV already
set up is updated in place.

It installs the release APK (the debug one if there is none; a copy signed with another key is
replaced), grants the two permissions it needs over adb (write secure settings, draw over apps —
the second lets it take the screen back from Live TV after power-on), writes Room ID / token / URL,
sets the screensaver, names the TV **Room 101** (what guests see in their Cast list), disables the
packages in `debloat-tvx19a.txt`, makes Zahill TV the Home screen, removes the old
`com.zahill.tvscreensaver` and checks Home opens. What it changed is kept in
`provision/state/<ip>.json` (not in git).

Safety rules (from CleanYourTV): it refuses a list with core Android / TV packages in it, never
disables the setup wizard while that owns the saved Wi-Fi, only disables what is installed and
enabled, and stops on a model other than AQUOS-TVX19A unless `-AnyModel -SkipDebloat`.

**Back to the stock home:** `.\restore.ps1 -Tv <ip>` (add `-Uninstall` to remove Zahill TV) — enables
exactly the packages the setup disabled, puts back the TV name and screensaver.

## Release key
`zahill-tv-release.jks` + `keystore.properties` in this folder, **not in git**. Every TV app must be
signed with it or the next update won't install over it — keep a copy of both files (and the
password inside `keystore.properties`) somewhere safe, e.g. the owner's password manager. Release
builds skip Play's "target API 33" lint rule on purpose (sideloaded, never on Play).

Trying it against a PC's local server: `adb reverse tcp:4000 tcp:4000` and
`--es base_url http://127.0.0.1:4000` (the hotel info pages need `tv-display` too, so they
don't open that way).

Screenshots: `adb exec-out screencap -p` on the Sharp prints two vendor lines before the PNG —
cut everything before the `\x89PNG` bytes.
