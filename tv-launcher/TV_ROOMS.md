# Guest TVs: addresses and where the rollout stands

Last updated 2026-11-01. Connect with `adb connect <ip>:5555`, then check the name with
`adb -s <ip>:5555 shell settings get global device_name` before changing anything: addresses can move
until the router has DHCP reservations (705 already moved from .18 to .26).

Before restarting a TV or running the setup, check for a guest:
`GET https://pms.zahill.kdai.cloud/api/display/room/<room>/state` with the display token
(PMS: Settings → Property Details → Device Setup). A TV that is off doesn't answer ping.

## Rooms

| Room | Address | Network | Model | Android | App | YouTube Music | Cast | State |
|---|---|---|---|---|---|---|---|---|
| 102 | 192.168.20.48 | .20 | AQUOS-TVX22A | 11 | 0.2.4 | Works | Answers | Done; restart OK; Google account removed, YouTube and Music data cleared. Storage was full (25 MB), cleared caches (about 310 MB free) |
| 103 | 192.168.20.46 | .20 Wi-Fi "Zahill Kintamani" | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done 2026-11-01; restart OK; a YouTube login was still on it with `Accounts: 0`: YouTube and Music data cleared |
| 104 | 192.168.20.88 | .20 Wi-Fi "Zahill Kintamani" | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done 2026-11-01; restart OK; Google account removed, YouTube and Music data cleared |
| 106 | 192.168.20.26 | .20 Wi-Fi "Zahill Kintamani" | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done 2026-11-01; restart OK; a YouTube login was still on it with `Accounts: 0`: YouTube and Music data cleared |
| 107 | 192.168.20.2 | .20 Wi-Fi "Zahill Kintamani" | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done 2026-11-01; restart OK. Was named "okta". Music had been turned off by hand: enabled. Prime Video also off by hand, left off |
| 108 | 192.168.21.13 | .20 Wi-Fi "Zahill Kintamani" | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done 2026-11-01; restart OK. Was named "tv_fenny". Google account removed, YouTube and Music data cleared. Setup app left on, it owns a saved Wi-Fi |
| 109 | 192.168.20.247 | .20 | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done; restart OK |
| 202 | 192.168.20.5 | .20 | SHARP 2K Smart TV | 11 | 0.2.4 | Hidden | Hidden | Basic TV: needs the setup below if Music and Cast are wanted. Netflix signed in with the hotel test account (2026-10-31): sign out before a guest stays, or decide to keep it |
| 801 | 192.168.30.38 | .30 Wi-Fi "PRAMANA ZAHILL" | AQUOS-TVX21B | 14 | 0.2.5 | Works | Answers | Villa, 4 TVs on one Room ID. Done 2026-11-01; restart OK; Google account removed, YouTube and Music data cleared. Setup app left on, it owns a saved Wi-Fi. Slow connection (700-1000 ms) |
| 801 | 192.168.30.64 | .30 Wi-Fi "PRAMANA ZAHILL" | AQUOS-TVX22A | 14 | 0.2.5 | Works | Answers | Done 2026-11-01; restart OK; Google account removed, YouTube and Music data cleared. Setup app turned off by hand (see below); saved Wi-Fi "zahillvilla" went with it |
| 801 | 192.168.31.9 | .30 Wi-Fi "PRAMANA ZAHILL" | Mi TV Stick (MiTV-AESP0) | 9 | 0.2.5 | Works | Answers | Done 2026-11-01; restart OK; Google account removed, YouTube and Music data cleared |
| 801 | 192.168.31.11 | .30 Wi-Fi "PRAMANA ZAHILL" | Mi TV Stick (MiTV-AESP0) | 9 | 0.2.5 | Works | Answers | Done 2026-11-01; restart OK |
| 802 | 192.168.20.64 | .20 | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done; restart OK |
| 803 | 192.168.20.56 | .20 | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done; restart OK. Was named "TV Kamar Tidur" (bedroom TV) |
| 804 | 192.168.20.50 | .20 | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done; restart OK |
| 204 | 192.168.20.166 | .20 Wi-Fi "Zahill Kintamani" | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done 2026-11-01; restart OK. Up 19 days before: `dumpsys` empty until restarted |
| 209 | 192.168.20.68 | .20 | AQUOS-TVX19A | 11 | 0.2.4 | Works | Answers | Done; restart OK |
| 203 | 192.168.110.203 | .110 Wi-Fi "Zahill Kintamani" | AQUOS-TVX19A | 11 | 0.2.4 | Opens YouTube Kids | Answers | YouTube holds earlier guests' logins and is stuck on Kids: owner chose to leave it as it is (2026-10-31). Was .20.41 before the restart; setup app left on, it owns a saved Wi-Fi |
| 302 | 192.168.20.116 | .20 | AQUOS-TVX19A | 11 | 0.2.4 | Turned off by the old setup | Not checked | Was off at last check |
| 303 | 192.168.20.42 | .20 | AQUOS-TVX19A | 11 | 0.2.4 | Works | Works | Done |
| 304 | 192.168.20.122 | .20 | AQUOS-TVX22A | 14 | 0.2.4 | Hidden | Not working | Basic TV: needs the setup below |
| 305 | 192.168.20.4 | .20 | AQUOS-TVX22A | 14 | 0.2.4 | Works | Works | Done; account removed |
| 306 | 192.168.20.65 | .20 | AQUOS-TVX22A | 14 | 0.2.4 | Works | Works | Done; account removed |
| 701 | 192.168.1.16 | .1 | SHARP 2K Smart TV | 14 | 0.2.4 | Works | Works | Done; Google TV setup done |
| 702 | 192.168.1.14 | .1 | SHARP 2K Smart TV | 14 | 0.2.4 | Hidden | Probably not working | Needs the setup below |
| 703 | 192.168.1.21 | .1 | SHARP 2K Smart TV | 11 | 0.2.4 | Hidden | Probably not working | Needs the setup below |
| 704 | 192.168.1.19 | .1 | SHARP 2K Smart TV | 11 | 0.2.4 | Hidden | Probably not working | Needs the setup below |
| 705 | 192.168.1.26 | .1 | SHARP 2K Smart TV | 11 | 0.2.4 | Works | Answered | Still has a Google account: remove it |

The `.20`, `.30` and `.1` networks don't reach each other, so the PC must be on the right one. Setting up a new
TV: see README.md (the setup list depends on the model).

## Log, 2026-11-01

Set up with the display token from the owner, one room at a time, each with no guest in the PMS and a restart test:

- **104:** a Google account removed, YouTube and Music data cleared.
- **204:** no account. Up 19 days, so `dumpsys` came back empty until restarted.
- **103, 106:** no account listed, but YouTube Music was signed in with someone's profile. Data cleared.
- **107:** was named "okta". Music had been turned off by hand: enabled. Prime Video, TalkBack and `com.cltv.fast` also off by hand, left off.
- **108:** was named "tv_fenny". A Google account removed, data cleared. Setup app left on (owns a saved Wi-Fi).
- **801 (villa, 4 devices, one Room ID):** two Sharps and two Mi TV Sticks. Google accounts removed from .38, .64 (last synced 31 Oct) and .9.
  - **Still "Room 801" on all four:** the owner has not said where each one is. Rename with `settings put global device_name 'Room 801 Living Room'`.
  - .64 looped on the setup wizard's recovery screen: fixed as under "What was learned", its unused saved Wi-Fi "zahillvilla" went with the wizard.
- **App 0.2.5:** minimum Android lowered from 11 to 9 for the sticks, with a fallback for hiding the system bars on the hotel info pages. Lint found no other call that needs a newer Android. Only the 801 devices have it; the others stay on 0.2.4.

Not tried by hand on any of these: Home on the real remote, casting from a phone, switching off at the wall.

## Mi TV Stick for rooms with an old TV

**Works on the two in Room 801** (restart OK, Home, screensaver, hotel info page, YouTube Music, port 8008 answers).

| | What these two are |
|---|---|
| Reports as | `MiTV-AESP0`, product `aquaman`, build PI.2055 |
| Android | 9 |
| Picture | 1920×1080 |
| Memory | 1 GB, about 250 MB free with Zahill TV on Home |
| Storage | about 2 to 2.7 GB free of 4.7 GB |
| Connection | Wi-Fi |

**Setting up a new one:** connect it to the room's network and turn on USB debugging. The stick must be the TV's active input to show the Allow prompt. Then:
`.\provision.ps1 -Tv <ip> -Room <room> -Token <token> -AnyModel -List debloat-mistick.txt`
Then remove any Google account, open Music to look for a YouTube login, and restart to test.

**Not known yet, try on the first one before buying many:**
- Whether a guest gets back to the stick by itself: after the TV is switched off and on, or off at the wall, the TV must return to the stick's HDMI input, and the stick needs power (from the TV's USB port it may restart each time).
- Whether the stick's remote controls the old TV's power and volume (`hdmi_control_enabled` reads empty on these two). Depends on the TV having HDMI-CEC.
- A newer model (e.g. Xiaomi TV Stick 4K) has not been tried: a different Android and launcher may need its own list. The script stops if Home doesn't open Zahill TV.
- A video on the Guest Board with only 1 GB of memory has not been watched on a stick.

## To do, in order

0. **801:** say where each device is, rename them. Check the Wi-Fi at .38 (700-1000 ms to answer). .64 stopped answering after its tests (a TV that is off doesn't answer ping): switch it on and confirm it comes back on "PRAMANA ZAHILL".
1. **702, 703, 704:** run the Google TV setup below, one at a time, room empty. The owner hasn't said go yet.
2. **304:** the same, once the guest has left (they were due out 1 Nov 12:00).
3. **705:** remove the Google account, then check the launcher is still off.
4. **302:** switch it on, `pm enable com.google.android.youtube.tvmusic`, check Music and Cast.
5. **303, 304, 305, 306:** confirm the launcher stayed off and Home is Zahill TV.
6. **Home button bug:** on 701 the Home key did not leave the hotel info pages (Dining etc.); Back did. Sent
   by adb only: try the real remote, then fix in app 0.2.5.
7. **DHCP reservations** on the router for every TV.
8. **Change the password of tech.zahill@gmail.com** once all the setups are done. **Delete the TV from the
   hotel account's Google Home app** ("Home").
9. Still to try by hand: wall power on 303 and 304; Inputs / Live TV on the Android 14 TVs; Cast from a phone.

## What was learned

- **Row order** is a PMS setting: Guest Board → Room TVs → Watch row apps. Now Netflix, YouTube,
  `com.google.android.youtube.tvmusic`. A TV without an app leaves that tile out.
- **Basic TV is why Music and Cast are missing.** A TV set up without signing in runs Google's Basic mode
  (`VanillaModeHomeActivity`), which hides built-in apps including YouTube Music and Cast. Copying the app,
  `pm unhide`, `install-existing` and signing in through Settings all fail, and Play says "not available in
  your country". Only Google's own "Set up Google TV" step unhides them.
- **A signed-in Google account can turn the launcher back on** (seen on 305, 306 with Play as the likely
  cause): the TV then opens Google TV with adverts. So never leave an account on a guest TV.
- **Netflix blocks screenshots** (black or empty), so it cannot be driven blind. Signing in takes someone at the TV: Sign In, then approve the code or QR on a phone.
- **Removing an account on a TV with the Google launcher on** offers only "reset" or "Basic mode". Disable the launcher first (setup script), then main Settings → Accounts → the account → Remove account gives a plain OK and Music and Cast stay. `SYNC_SETTINGS` can open a dead "Unknown account" page.
- **YouTube keeps its own login:** it can stay signed in after the Google account is removed (`Accounts: 0`). Open Music and look for a profile picture; `pm clear com.google.android.youtube.tv` and `...tvmusic` clear it.
- **A TV up for weeks can return nothing from `dumpsys`** (109, after 18 days), which would hide accounts and hidden apps. If the checks come back empty, restart it and read them again.
- **YouTube can list earlier guests' accounts** with names and photos (seen on 203), even with `Accounts: 0`. It can also get stuck on Kids, and the Music tile then opens Kids too. Open YouTube itself to check, not only Music. Owner decided on 2026-10-31 not to clear these on 203 or check other rooms.
- **YouTube Kids is dead on these TVs:** the app only shows "YouTube Kids has moved". Play also says
  "Item not found". Don't install it.
- **Mi TV Sticks and the AQUOS-TVX21B** need `-AnyModel -List debloat-mistick.txt` / `debloat-tvx21b.txt` (setup wizard + launcher only). The app's minimum is Android 9 since 0.2.5, for the sticks.
- **TVX22A with the setup wizard left on loops:** with the launcher off, its recovery screen restarts forever (801, as on 305 and 306). `provision.ps1` skips the wizard when it owns ANY saved network, even one not in use. Fix: `pm enable` the launcher, compare `cmd wifi status` with the owners in `dumpsys wifi`; if the wizard doesn't own the network in use, `pm disable-user` it, check Wi-Fi stays up, then run the script again.
- **Storage:** the Google setup can add apps (WeTV, iQIYI, Disney+, etc.). 705 ran out of space and needed
  WeTV and HBO Max removed before an update would install.
- **Updating a TV on its screensaver** can bring the app behind it to the front. Press Home afterwards.

## Google TV setup (Basic TV → Music and Cast), about 5 minutes per TV

Worked on 701. Check each screen with a screenshot (`adb exec-out screencap -p`; on these TVs cut everything
before the PNG header).

1. Check the room is empty and the name matches.
2. `pm enable com.google.android.tungsten.setupwraith`, `pm enable com.google.android.apps.tv.launcherx`,
   press Home.
3. Move down to **Set up Google TV**, press it, and press it again on the next screen.
4. Sign in with the hotel account (ask the owner for the password; don't store it).
5. View more → Accept → Google services: Accept → Stay in the know: **No thanks**.
6. Music and Cast now show `hidden=false`. Skip the "Select a room" screen.
7. Remove the account: `am start -a android.settings.SYNC_SETTINGS` → the account → scroll to the bottom →
   **Remove profile** → Remove account → OK. Confirm `dumpsys account` says `Accounts: 0`.
8. `pm disable-user --user 0` setupwraith, then launcherx (setupwraith first, or its recovery screen takes
   over Home in a loop), then `cmd package set-home-activity com.zahill.tv/.MainActivity`.
9. Restart, then confirm: Home is Zahill TV, name and screensaver unchanged, Music opens, port 8008 answers.

Turning off the setup app can delete a saved Wi-Fi network it owns (304 was seen with this; provision.ps1
skips it there). Check `dumpsys wifi | grep cname` first on any TV on Wi-Fi.
