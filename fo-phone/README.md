# Front Desk Phone (Android)

Rings like a normal phone call when a room tablet calls the front desk, also with the screen off and on the lock screen. The PMS screens keep ringing too; the first to answer takes the call. Front desk can also call a room and see missed calls.

- Package `com.zahill.fophone`, minSdk 26, target 35, JDK 17 (Android Studio JBR), same toolchain as `room-display-kiosk/`.
- PMS side: migration 162 (`call_devices`), `server/services/foPhones.js`, `server/routes/phoneCalls.js` (`/api/phone/*`), pairing `POST /api/public/fo-phone/pair`, owner screen Settings → Front desk phones, the page `client/src/pages/FoPhone.jsx` (`/fo-phone`).

## How it works

- `CallService` (foreground service, type specialUse) holds `GET /api/phone/stream?key=` with a Wi-Fi lock, reconnects, polls `/api/phone/pending` every 15 s as a fallback, and keeps the signals of a ringing call for the page.
- A room calls → the phone's ringtone + vibration, a full-screen notification → `IncomingCallActivity` (over the lock screen). **Not now** silences only this phone.
- **Answer** opens `MainActivity` = the PMS page `/fo-phone?answer=…` in a WebView; the page takes the signals already received (`FoPhoneApp.takeSignals`) and answers with the same WebRTC code as the PMS screens. Mute, speaker, hang up; the screen turns off at the ear.
- The page is part of the PMS web app, so changes to it reach the phone with a normal PMS deploy. A new APK is only needed for changes in this folder.

## Build

```bash
cd fo-phone
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"; export PATH="$JAVA_HOME/bin:$PATH"
./gradlew :app:assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
```

`local.properties` (not in git) holds `sdk.dir`. The debug build is signed with this PC's debug key: build updates on the same PC, or Android refuses to install over it (uninstall first, then pair again).

## Install on the phone

1. Copy `app-debug.apk` to the phone (WhatsApp to yourself, USB, Google Drive) and open it; allow *Install unknown apps* for the app you opened it from.
2. Open **Front Desk Phone** → PMS address (default `https://pms.zahill.kdai.cloud`) → Continue.
3. On the PMS: **Settings → Front desk phones → Add phone** → type the code on the phone.
4. Do every item on **Finish setting up this phone** (microphone, notifications, full-screen calls, battery: no restrictions, the phone maker's autostart).

### Vivo (Funtouch OS / Origin OS) — or it stops ringing after a while

- Settings → Battery → *Background power consumption management* (or *High background power usage*) → Front Desk Phone → **Allow** / *Don't restrict*.
- i Manager → App manager → **Autostart** → Front Desk Phone on (the app's *Fix* button tries to open this page).
- Settings → Apps → Front Desk Phone → Notifications → allow all, **Lock screen: show**, **Floating / banner** on.
- Open Recents, pull the app's card down (or tap the lock icon) so it is **locked** and not cleared.
- Test: lock the phone, leave it 30 minutes, then call from a room tablet.

## Not done

- Not tried on a real phone yet (built only).
- No Firebase push: if the Vivo still misses calls with all the settings above, add FCM.
- Calls don't show in the phone's own call log; Bluetooth headset buttons don't answer.
