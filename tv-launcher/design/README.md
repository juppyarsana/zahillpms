# Zahill TV Home — design reference

Exported 2026-10-28 from the "Zahill TV Home" design canvas. All screens are
1920×1080 (TV resolution). See `TV_LAUNCHER_PLAN.md` for how each part is built.

| File | Screen |
|---|---|
| `01-home-guest.png` | Home, guest in room (native) — focus ring on the first Watch tile |
| `02-home-vacant.png` | Home, room ready / no guest (native) |
| `03-dining.png` | Dining & Menu (tv-display web page) |
| `04-activities.png` | Activities (tv-display web page) |

Tokens
- Ground `#05070a` (detail screens `#0a0c10`, cards `#15181d` / `#1a1d22`)
- Accent `#c9a227` = `property_settings.brand_color` default; focus ring 4px accent
- Text `#f4f1ea`, secondary `#d9d4c7`, labels `#b7b1a3`
- Fonts: Manrope (UI, 300–800), Cormorant Garamond 500 (guest name, page titles)
- Margins 88px left/right, 56px top/bottom; tile radius 16–18px

Sample / placeholder content: "Mr. Budi Santoso", "Room 12", weather and times are
samples; anything in [brackets] comes from the PMS. Streaming tiles show text only —
on the TV each app's own banner is drawn by the launcher.
