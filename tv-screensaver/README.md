# Zahill TV Screensaver

A small Android TV app that shows the `tv-display` welcome page (`https://tv.zahill.kdai.cloud?room=<roomId>&token=<token>`) full screen in a WebView, two ways:

- **Screensaver** (`ZahillDreamService`): starts by itself when the TV has been idle for the time set in the TV's screensaver settings (5 minutes at Zahill).
- **"Zahill Welcome" on the TV home screen** (`WelcomeActivity`, since 0.2.0): one press shows the welcome page now — what housekeeping does when a room is made ready, instead of waiting for the screensaver. Any remote button goes back to the TV (volume keys still work), like the screensaver.

The settings (Room ID, display token, TV URL, "Set as screensaver") have **no icon of their own**, so they can't be opened by mistake. To open them: **hold OK for 3 seconds** on the welcome screen; or Android Settings → Screen saver → Zahill → settings; or `adb shell am start -n com.zahill.tvscreensaver/.MainActivity`. A TV that is not set up yet opens them by itself.

**Lobby TV:** the same app with Room ID **`lobby`** shows the lobby slideshow (Guest Board cards set to the lobby, with videos and sound) instead of a room — see the Guide chapter *Lobby TV & Guest Board*.

## Build

From `tv-screensaver/`, with Android Studio's Java (`build.sh` strips the PATH and fails on some machines):

```bash
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" && export PATH="$JAVA_HOME/bin:$PATH"
./gradlew :app:assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. It is signed with the **debug key of the machine that builds it** — Android only updates an installed app when the new APK has the same key. The TVs were installed from the owner's laptop (2026-10), so build updates there, or the update is refused (see below).

## Install / update on a TV

```bash
adb connect <tv-ip>:5555
adb install -r app-debug.apk
```

- `-r` keeps the TV's Room ID, token and permission.
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` = built with another machine's key: `adb uninstall com.zahill.tvscreensaver`, `adb install app-debug.apk`, then set it up again (below).

First setup on a new TV:

```bash
adb shell pm grant com.zahill.tvscreensaver android.permission.WRITE_SECURE_SETTINGS
```

then open **Zahill Welcome** (it opens the settings when not set up), enter the Room ID + display token, **Save**, and **Set as screensaver**. Put **Zahill Welcome** in the TV's favourites row (Home → Apps → hold OK on it → add to favourites / move) so housekeeping finds it in one press.

Also set the TV's time zone by hand (Settings → System → Date & time → Automatic time zone off → GMT+08:00 Makassar): an Android TV only knows the country and defaults to Jakarta. The welcome page shows hotel time (WITA) either way.
