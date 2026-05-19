# Birdnest TV Screensaver

A tiny Android TV app that runs as a DreamService and opens the `tv-display` web page in a fullscreen WebView.

## Features
- Android TV `DreamService` screensaver wrapper
- Settings screen for room ID, display token, and TV URL
- Loads `https://tv.birdneststay.id?room=<roomId>&token=<token>`

## Local testing
1. Open `tv-screensaver` in Android Studio.
2. Build and run the `app` module.
3. Use the launcher activity to enter room ID, token, and TV URL.
4. Enable the screensaver in Android TV settings and select `Birdnest TV Screensaver`.

## Notes
- This project does not include Gradle wrapper files.
- The app uses `android.permission.INTERNET` to load the remote web page.
