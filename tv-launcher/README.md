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

## Put it on a TV
```bash
A="adb -s <tv-ip>:5555"
$A install -r app-debug.apk
$A shell pm grant com.zahill.tv android.permission.WRITE_SECURE_SETTINGS
$A shell am start -n com.zahill.tv/.SettingsActivity --es room_id 101 --es display_token <token>   # [--es base_url https://...]
$A shell pm disable-user --user 0 com.google.android.tvlauncher
$A shell cmd package set-home-activity com.zahill.tv/.MainActivity
$A shell input keyevent KEYCODE_HOME
```
Then hold OK 3 s → *Set as screensaver*. Default TV URL: `https://tv.zahill.kdai.cloud`
(serves `/api/display`, `/property-logos`, `/board-images` and the `tv-display` pages).

**Back to the stock home:** `$A shell pm enable com.google.android.tvlauncher`, then press Home.

Trying it against a PC's local server: `adb reverse tcp:4000 tcp:4000` and
`--es base_url http://127.0.0.1:4000` (the hotel info pages need `tv-display` too, so they
don't open that way).

Screenshots: `adb exec-out screencap -p` on the Sharp prints two vendor lines before the PNG —
cut everything before the `\x89PNG` bytes.
