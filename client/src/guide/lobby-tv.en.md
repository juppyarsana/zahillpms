# Lobby TV & Guest Board

The **Guest Board** (Settings → Guest Board) is one list of cards — pictures, short texts, notices and videos — shown on three kinds of screen:

| Screen | Shows |
| --- | --- |
| **Room TVs** (screensaver) | the cards' pictures and **videos** full screen (videos without sound), with the guest's name, room, the clock and weather along the bottom |
| **Room tablets** (Explore) | the cards with their pictures (not video cards) |
| **Lobby TV** | the cards' pictures and **videos** as a slideshow, the hotel's name, clock, weather and notices — no guest data |

## Where a card shows

Open a card → **Show on**:

- **Rooms & lobby** — everywhere (every existing card starts like this)
- **Rooms only** — room TVs and room tablets, not the lobby (e.g. "Please hang the Do Not Disturb sign")
- **Lobby only** — only the lobby TV (e.g. a welcome video)

## Adding a video

1. **+ New Card** (or **Edit** a card), fill in the title and text, and add a **picture** — it is the video's cover.
2. **Video** → choose the file. Set **Show on** to where it should play.
3. **Play with sound** — on or off.
4. **Create Card** / **Save Changes** and wait while the video uploads (the button shows the %).

> The video must be **MP4 (H.264)**, at most **2 minutes** and **100 MB**. A video from an iPhone (.mov or HEVC) must first be exported as MP4 "Most compatible". The page says so when a file can't be played on the TV.

On the lobby TV a picture stays 8 seconds; a video plays to its end, then the slideshow carries on. The TV downloads each video **once** and keeps it, so the hotel's internet isn't used every time it loops. Room TVs play the videos too, always **without sound** (the screensaver also comes on at night with a guest asleep); a room TV waits a few minutes before downloading new videos, so 30 TVs don't all download at once. Keep room videos short — under a minute is best. Room tablets never show a card that has a video — video cards are only for the TVs.

## Music in the lobby

At the top of the Guest Board page, **🎵 Lobby music**:

1. **+ Add songs (MP3)** — choose one or more MP3 files (up to 20 MB each, 20 at a time). ▶ plays a song here to listen first.
2. Tick **Play on the lobby TV**.
3. **Volume** — the music's level inside the TV (start around 40%). The TV's own volume on the remote still sets how loud the lobby hears it.
4. **Shuffle**, or keep the order with ↑ ↓. **Remove** takes a song off.

The lobby TV plays the songs one after the other in a loop. When a video **with sound** comes up, the music fades out and comes back after the video. Room TVs never play music. The TV keeps each song after the first play, like the videos. Music needs **TV app 0.2.0** on the lobby TV — older versions don't let the music start by itself.

> Use royalty-free music, or songs the hotel holds a licence for (LMKN). Commercial songs played in a public area need a licence.

## Room TV Home

Room TVs with the new **Zahill TV** app open on a Home screen: the guest's name and room, their check-out day, the streaming apps, and four hotel tiles (Dining & Menu, Activities, Hotel Guide, Today). An empty room shows **Welcome to your room · Ready for guests** until the guest presses OK.

What it shows is set on the Guest Board page → **Room TVs** tab:

1. **Details for guests** — **Guest Wi-Fi name** and **Wi-Fi password**, **Check-out time**, **Breakfast hours** and **Breakfast served at** — then **Save**. A field left empty is simply not shown on the TV.
2. **Watch row apps** — the streaming apps on the Home screen, left to right, at most 6 (**Cast from phone** is always last). **Start from this list** takes the TVs' own list (Netflix, YouTube, Prime Video, Disney+ Hotstar, Vidio, Spotify); add an app with its button, or any other app by its Android package name; ↑ ↓ to order, ✕ to remove, then **Save**. A TV that doesn't have an app leaves it out — install apps from the **Google Play Store** on the TV (or from play.google.com with the TVs' Google account). Needs **Zahill TV app 0.2.2** on the TV.
3. **Home background photo** — with **Rotate the Guest Board's pictures** ticked, the pictures of the Guest Board cards rotate behind the Home screen. Untick it (or have no card pictures) to use your own photos: **Morning**, **Day** and **Night**, each from its start time. One photo is used all day; none = the TV's own sunrise picture. Use a wide landscape photo.

The TVs pick changes up within a minute. **Dining & Menu** shows the restaurant menu once the guest has checked in; **Hotel Guide** shows the Wi-Fi, breakfast and check-out details and the *Property* and *Dining* cards; **Today** shows the *Notice* and *Activity* cards. Guests order and book on the room tablet — the TV only shows.

## Setting up the lobby TV

It runs the same **Zahill** app as the room TVs. In its settings (hold **OK** for 3 seconds on the welcome screen) type **lobby** as the **Room ID**, the same display token as the rooms, and **Save**. Then press **Zahill Welcome**. Set the TV's own **sleep timer to Never** so it stays on.

Changes on the Guest Board reach the lobby TV within about 15 seconds.
