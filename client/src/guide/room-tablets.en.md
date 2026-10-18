# Room tablets — WiFi connection

**Settings → Property → Room Tablets** shows how well each room tablet stays connected, so you can find weak WiFi spots and check whether a WiFi change helped.

> Owners always see it. Anyone else needs the permission **Room Tablets** (Roles & Permissions → Settings).

## What counts as a drop

Every room tablet asks the PMS for its screen every 10 seconds. When a tablet is silent for **more than a minute**, that is one **drop**. When it comes back, the PMS records how long it was gone.

When **5 or more tablets** go quiet within the same 90 seconds, the cause is not one room's WiFi but the **internet line, the router or the PMS server**. Those are listed apart under **Many rooms at the same time** and are **not** counted against any room.

History is kept **30 days**.

## Overview

- **Now**: one tile per room — online or offline, signal strength (**Good** / **Weak** / **Poor**), 2.4 or 5 GHz, the access point and the battery. Tap a tile to open the room.
- **Drops per day**: rooms down, days across. The darker the box, the more drops that day. Hover a box for the details. A dashed box means the tablet was not heard from that day (switched off or not installed yet). **Sort → Most drops first** puts the weakest rooms on top.
- **Many rooms at the same time**: when, for how long and which rooms.

## Signal strength

| dBm | Means |
| --- | --- |
| −67 or higher | **Good** |
| −67 to −75 | **Weak** — may drop now and then |
| below −75 | **Poor** — expect drops; move the access point closer or add one |

Signal and access point come only from tablets running the **kiosk app**. A tablet that only runs in a browser still has its drops counted.

## One room

Tap a room (a tile or its name in the grid): signal over the **last 24 h**, **7 days** or **30 days** (red marks at the bottom are its drops), when it **changed access point**, and every drop with its time — **Alone** or with other rooms.

## Before / after a WiFi change

1. Open **Before / after**.
2. **Changed at**: the date and time the work was finished.
3. Tick the rooms that got the new WiFi.
4. **Compare**.

Each row shows:

| Column | Means |
| --- | --- |
| **Online before / after** | the share of the time the tablet could reach the PMS — 100% = never lost it |
| **Offline a day** | how long its screen was cut off on an average day |
| **Drops a day** | how many times it lost the connection |
| **Result** | **Better** / **Worse** / **About the same** by the time offline; **Too early** while the change is under 12 hours old; **Not heard from since …** = that tablet is off or cannot join the WiFi now — go and look |

Time offline matters more than the number of drops: many short drops of a minute can still be better than a few drops of hours. The **other rooms** are the comparison: if they also got better, something else changed (e.g. the internet line). The page remembers your choice on this device.

## Access points

**Access points** lists every access point a tablet used in the last 7 days, with the rooms on it now and its average and worst signal. Type a name you recognise (e.g. "Block 200 corridor") and **Save** — the name then shows everywhere instead of the hardware address.
