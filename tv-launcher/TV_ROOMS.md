# Guest TVs: addresses and where the rollout stands

Last updated 2026-10-31. Connect with `adb connect <ip>:5555`, then check the name with
`adb -s <ip>:5555 shell settings get global device_name` before changing anything: addresses can move
until the router has DHCP reservations (705 already moved from .18 to .26).

Before restarting a TV or running the setup, check for a guest:
`GET https://pms.zahill.kdai.cloud/api/display/room/<room>/state` with the display token
(PMS: Settings → Property Details → Device Setup). A TV that is off doesn't answer ping.

## Rooms

| Room | Address | Network | Model | Android | App | YouTube Music | Cast | State |
|---|---|---|---|---|---|---|---|---|
| 202 | 192.168.20.5 | .20 | SHARP 2K Smart TV | 11 | 0.2.4 | Hidden | Hidden | Basic TV: needs the setup below if Music and Cast are wanted |
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

The `.20` and `.1` networks don't reach each other, so the PC must be on the right one. Setting up a new
TV: see README.md (the setup list depends on the model).

## To do, in order

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
- **YouTube Kids is dead on these TVs:** the app only shows "YouTube Kids has moved". Play also says
  "Item not found". Don't install it.
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
