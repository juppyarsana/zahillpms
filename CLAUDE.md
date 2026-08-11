# ZHP PMS — Claude Code Context

> Read this file before starting any work. It defines naming conventions, architecture decisions, and current project state. **Keep it updated** — see "Working Across Multiple Machines" at the bottom. This file is the single source of truth that travels with the repo between the laptop and the PC; if it's stale, the next session starts blind.

---

## What this is

**ZHP PMS** (working platform name — originally built as "Zahill PMS" for a single property, now a **multi-tenant Property Management System platform** intended to be sold/hosted for multiple hotel/glamping clients from one shared codebase and database). Zahill is the first, reference property running on the platform; "Birdnest" is a second property used to build and verify multi-tenancy end-to-end. Both run on the same infrastructure, fully data-isolated from each other.

Built as a monorepo with React/Vite frontend(s) and a Node/Express backend shared by every property.

**Owner:** Juppy (juppyjp@gmail.com)
<!-- TODO: hosting details (cloud VM provider, address), production domain scheme for new client onboarding (e.g. {slug}.pms.yourplatform.com vs custom domains) -->

---

## Monorepo Structure

```
ZHP PMS/
├── client/              ← PMS frontend (React/Vite PWA) — property staff + superadmin
│   └── src/pages/admin/ ← Superadmin-only pages (Properties list, PropertyDetail)
├── server/              ← Shared backend (Node/Express), serves ALL properties
├── room-display/        ← Room Display PWA (per-room tablet)
├── tv-display/           ← TV Welcome Display (React/Vite page loaded by the screensaver APK)
├── tv-screensaver/       ← Android TV DreamService APK (Kotlin) that wraps tv-display in a WebView
├── PLANNING.md          ← original single-property feature/schema spec (historical reference)
├── ROADMAP.md           ← current feature roadmap, phase status, module registry
├── MULTI_TENANCY.md     ← how/why multi-tenancy was built, migration-by-migration detail
└── CLAUDE.md            ← this file
```

---

## Naming Conventions — CRITICAL

These names are final. Do not use alternatives.

| Correct Name | Do NOT call it |
|---|---|
| **Property** | client, tenant, account (when referring to a hotel/glamping site on the platform) |
| **Superadmin** | platform admin, root user |
| **Room Controller** | ESP32 controller, IoT device, smart device |
| **Room Display** | IoT panel, tablet app, room tablet, control panel |
| **relay** | light, device, switch (in code/API) |
| **module** | feature flag, plugin (when referring to `property_modules` entries) |

Note: "Zahill PMS" as a product name is being superseded by the platform now serving multiple properties — `ROADMAP.md` already refers to it as "ZHP PMS." Not yet fully renamed across the codebase (package names, page titles); treat as in-progress.

---

## Multi-Tenancy & Platform Architecture

**This is the core architectural fact about this codebase: it is not single-tenant.** Every property's data lives in the same database, isolated by `property_id`. This was built and verified in migrations **019–026** against a live second property (Birdnest) — full detail in `MULTI_TENANCY.md`.

### How isolation works
- Every business table has a `property_id` column (added in `019_multi_tenancy.sql`).
- Every authenticated route reads `req.propertyId` (set by `middleware/auth.js` from the JWT — see below) and every query is scoped `WHERE property_id = $n`.
- The JWT issued at login (`routes/auth.js`) embeds `propertyId` alongside `userId`/`role`. `middleware/auth.js` decodes it and sets `req.propertyId` on every request.
- Formerly-singleton tables (`property_settings`, `ai_market_summary` — used to be `WHERE id = 1`) are now one row per property, scoped by `property_id` with a unique constraint instead of a hardcoded PK.
- Tables with human-readable string IDs that used to be globally unique (`booking_sources`, `payment_methods`, `roles`) are now namespaced per property (`<id>-<property_uuid>`) so two properties can both have a role called `manager` without colliding. `users.role`, `bookings.source`, `payments.method` were widened to `varchar(50)` in migration `026` to fit these namespaced values.

### Module system (per-property feature flags)
Not every property needs every feature (e.g. a property with no ESP32 hardware shouldn't see Room Controller). `server/modules.js` maps each module to the route files it gates:

| Module | Routes gated | Default |
|---|---|---|
| `reservations` | bookings, checkin, allotments, pricing | ✅ on |
| `front_desk` | checkin | ✅ on |
| `guest_crm` | guests, loyalty | ✅ on |
| `financial` | payments, reports, nightAudit, folio | ✅ on |
| `operations` | tasks | ✅ on |
| `sales` | products, sales, tables | ✅ on |
| `in_room_media` | board, display | ✅ on |
| `room_controller` | iot, calls | ❌ off by default (hardware-dependent) |
| `insights` | insights | ✅ on |

Always-on, ungated: `auth`, `dashboard`, `settings`, `units`, `users`, `communications`.

Enforcement: `server/index.js` wires `moduleGuard('<module>')` into each route mount (after `auth`, so `req.propertyId` is already set). A disabled module returns `403 {"error": "Module not enabled for this property"}`. `property_modules` (property_id, module, is_enabled) is the backing table. `GET /api/settings/modules` (owner-only) is what the frontend nav should call to hide/show sections — confirm the client actually wires this before assuming nav visibility is automatic.

### Superadmin & property onboarding
A superadmin is a platform-level operator, not tied to any one property (`users.is_superadmin = true`, `property_id` nullable for them). Distinct auth layer: `middleware/authSuperAdmin.js`, mounted at `/api/admin` in `server/index.js`, ahead of and separate from the per-property `auth` + `moduleGuard` chain.

`routes/admin.js` endpoints:
- `GET /api/admin/properties` — list all properties + module counts
- `POST /api/admin/properties` — create a property (`name`, `slug`, `plan`, `display_token`), then calls `seedPropertyDefaults(property.id)` to clone default settings/modules/booking-sources/payment-methods/roles in one shot
- `GET /api/admin/properties/:id` — property detail + its module states + branding fields (`logo_url`, `brand_color`, `property_name`, `property_address`, `property_phone`, `property_email`, joined from `property_settings`)
- `PATCH /api/admin/properties/:id` — update name/slug/plan/is_active
- `PATCH /api/admin/properties/:id/modules` — toggle a module on/off
- `PATCH /api/admin/properties/:id/branding` — update brand color + contact/invoice fields on `property_settings` (same columns the property owner can also edit in their own Settings page — both write the same row, last save wins, by design)
- `POST /api/admin/properties/:id/logo` — multipart logo upload (`multer` + `sharp`, resized to 512×512 PNG, saved to `server/uploads/property-logos/`, served unauthenticated at `/property-logos/*` since the login screen, Room/TV Display, and email clients all need it without a JWT)
- `GET /api/admin/properties/:id/users` / `POST /api/admin/properties/:id/users` — manage a property's staff accounts

**Frontend — traced button-by-button against the API above (verified, not assumed):**

`client/src/pages/admin/` (`AdminLayout.jsx`, `Properties.jsx`, `PropertyDetail.jsx`), routed in `App.jsx` at `/admin` and `/admin/properties/:id`, gated by `RequireSuperAdmin` (checks `user.is_superadmin`, redirects to `/login` or `/` otherwise). `Login.jsx` sends a superadmin straight to `/admin` after auth; `AuthContext.jsx` skips the per-property `fetchModules()` call for superadmins since they have no `property_id`.

| UI action | Wired to |
|---|---|
| `Properties.jsx` page load | `GET /api/admin/properties` — list + module count |
| "+ New Property" → modal → "Create Property" | `POST /api/admin/properties` (auto-generates `display_token` client-side via `crypto.randomUUID`) |
| "Manage" button on a property row | navigates to `/admin/properties/:id` |
| `PropertyDetail.jsx` page load | `GET /api/admin/properties/:id` — property info + modules |
| "Save Changes" (name/slug/plan/active) | `PATCH /api/admin/properties/:id` |
| Module On/Off toggle buttons | `PATCH /api/admin/properties/:id/modules` (optimistic UI update, rolls back on error) |
| `PropertyDetail.jsx` "Staff Users" card | `GET /api/admin/properties/:id/users` (list), `GET /api/admin/properties/:id/roles` (populates the role dropdown) |
| "+ Add User" → modal → "Create User" | `POST /api/admin/properties/:id/users` (validates the role belongs to that property server-side) |
| `PropertyDetail.jsx` "Branding" card — logo upload | `POST /api/admin/properties/:id/logo` (multipart, preview updates from the returned `logo_url`) |
| "Branding" card — color picker + name/address/phone/email fields → "Save Branding" | `PATCH /api/admin/properties/:id/branding` |

**Closed gap (was open until a previous session):** the superadmin UI previously had no way to create a property's first staff login — `routes/admin.js` had the `users` endpoints but nothing called them. Added a "Staff Users" card to `PropertyDetail.jsx` plus a new `GET /api/admin/properties/:id/roles` endpoint (list-only, so the create-user modal can populate a role dropdown). Onboarding a new property is now fully self-serve from the superadmin UI: create property → toggle modules → add first staff user, no API tooling required.

**Closed gap (this session): per-property branding.** Every property used to render with Zahill's hardcoded logo and name everywhere — a single static `client/public/logo.png` and hardcoded strings, since the client/room-display/tv-display apps are each one shared deployment for every property. Migration `032` added `property_settings.logo_url` / `brand_color`. The new "Branding" card above lets superadmin set logo, color, and contact/invoice fields (`property_name`/`address`/`phone`/`email` — the property owner keeps their own edit access to the same fields in their own Settings page; both write the same `property_settings` row, last save wins).

Logo threading, end to end:
- **Client nav** (`App.jsx` `TopNav`) — `SettingsContext.jsx` fetches `GET /api/settings/branding` (plain `auth`, not owner-gated — every staff role needs the nav logo) alongside its existing sources/payment-methods calls.
- **Login screen** (`Login.jsx`) — runs pre-JWT, so it can't resolve a property the normal way. Added a new no-auth route file `routes/public.js` (`GET /api/public/properties/:slug/branding`) and an optional property-slug field on the login form (also reachable via `/login/:slug`), remembered in `localStorage` (`lastPropertySlug`) so returning staff see the right branding without retyping. **This is cosmetic only** — it does not change how `POST /api/auth/login` resolves the user (still by email alone, see Known gaps below).
- **Invoice PDF** (`routes/folio.js`) — draws the logo top-right via `pdfkit`'s `doc.image()` if the file exists on disk; wrapped in try/catch so a missing/corrupt logo falls back to the pre-existing text-only header rather than breaking invoice generation.
- **Room Display / TV Display** — both already call the same `GET /api/display/room/:roomId/state` (via `authDisplay`/`display_token`); that response now carries a `property: { name, logo_url, brand_color }` field, so both apps picked up branding by threading one new prop through their screen components (`SetupScreen.jsx` is the one exception — it runs before a room/token is configured at all, so it has no property to resolve and still shows the platform default).
- **Guest emails** (`services/mailer.js`) — `wrapEmailBody()` prepends a logo `<img>` at send time (not baked into the stored templates) if `logo_url` is set. Needs an **absolute** URL since email clients don't resolve relative paths — new env var `SERVER_PUBLIC_URL` (see Environment Variables below); if unset, emails just skip the logo rather than breaking.

**Known limitation:** the Staff Users card is list + create only — no edit or deactivate/delete from the UI yet (matches what `routes/admin.js` exposes; there's no `PATCH`/`DELETE` on `/properties/:id/users/:userId`). Add those endpoints + UI controls if you need to reset a password or remove a departing staff member without going to the DB directly.

**Credentials to know about (seeded placeholders — change before production):**
- Superadmin: `admin@platform.com` / `superadmin123`
- Demo second property "Birdnest" (slug `birdnest`): owner login `owner@birdnest.com` / `testpass123` — kept as a live reference for multi-tenancy verification; harmless to keep, fully isolated from Zahill's data, or delete if no longer needed.

### Known gaps (from MULTI_TENANCY.md, still open as of last check)
- **Login still doesn't resolve the *user* by subdomain/tenant** — `POST /api/auth/login` looks up a user by email alone (globally unique since migration `023`). The login screen can now show the right property's *branding* pre-auth via an optional slug field (`GET /api/public/properties/:slug/branding`, see Superadmin section above), but that's cosmetic only — actual auth is still email-only, and there's still no real subdomain/DNS-based routing. Fine while staff don't overlap across properties; revisit if you want `{slug}.pms...` login pages or true per-property subdomains.
- `booking_sources` / `payment_methods` / `roles` use namespaced raw strings as their identity rather than a surrogate key — works, but awkward if another table ever needs a clean FK to them.
- No environment-level docs yet for a full "spin up client #3" runbook beyond `POST /api/admin/properties` — worth writing once you actually onboard a paying second/third client.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Cloud VM                            │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │  Mosquitto  │◄──│   Backend    │──►│  PostgreSQL  │  │
│  │MQTT Broker  │   │ Node/Express │   │  (all        │  │
│  │port 1883    │   │  port 4000   │   │  properties) │  │
│  └──────┬──────┘   └──────┬───────┘   └──────────────┘  │
└─────────┼─────────────────┼────────────────────────────-─┘
          │ MQTT             │ REST
   ┌──────▼──────┐   ┌──────▼────────┐   ┌──────────────┐
   │    ESP32    │   │  PMS client/  │   │ Room Display │
   │Room Control-│   │ (per-property │   │ + TV Display │
   │    ler      │   │  login, JWT   │   │ (per-property│
   │  per room   │   │  scoped data) │   │ display_token)│
   └─────────────┘   └───────────────┘   └──────────────┘
```

One backend, one database, many properties. The client app, Room Display, and TV Display are the same codebase deployed once — property identity comes from the logged-in user's JWT (staff apps) or the per-property `display_token` (guest-facing displays), not from separate deployments.

---

## MQTT Setup

- Broker: `mqtt.d-zahill.kdai.cloud` port `1883` (Zahill's own broker — each property should get its own broker/credentials; do not share across properties, to avoid cross-property command collisions)
- WebSockets: port `9001`
- Auth: username `zahill`, password configured per `server/.env`
- DNS: `mqtt.d-zahill.kdai.cloud` A record → VM IP

### Topic Structure

**Subscribe (backend → ESP32):**
- `zahill/room/{id}/relay/{n}/set` — payload: `on` or `off`
- `zahill/room/{id}/rgb/set` — payload: `{"r":255,"g":0,"b":0}`
- `zahill/room/{id}/ir/send` — payload: slot index
- `zahill/room/{id}/request/status` — triggers full status publish

**Publish (ESP32 → backend):**
- `zahill/room/{id}/relay/{n}/state` — `on` or `off` (retained)
- `zahill/room/{id}/rgb/state` — JSON (retained)
- `zahill/room/{id}/status` — full JSON snapshot
- `zahill/room/{id}/connected` — `true`/`false` LWT (retained)

<!-- TODO: topic namespace is currently "zahill/..." hardcoded — when a second property with real Room Controller hardware comes online, this needs a per-property namespace (e.g. "{property_slug}/room/{id}/...") so MQTT topics don't collide across properties on a shared broker. -->

---

## Backend — Current State

**Stack:** Node.js + Express (CommonJS), PostgreSQL (raw SQL), JWT auth, PM2 + Nginx
**Port:** 4000 behind Nginx
**Entry:** `server/index.js` — also where module gating is wired (see Multi-Tenancy section above)

**Route files** (`server/routes/`):
- `auth` — login/logout (always on)
- `public` — unauthenticated endpoints callable pre-login/pre-JWT (e.g. property branding lookup by slug for the login screen)
- `admin` — superadmin: property CRUD, module toggles, per-property user management (separate `authSuperAdmin` layer)
- `units`, `users`, `settings`, `dashboard`, `display` — core, always on
- `bookings`, `checkin`, `allotments`, `pricing` — reservations + front desk
- `guests`, `loyalty` — guest CRM
- `payments`, `reports`, `nightAudit`, `folio` — financial
- `tasks` — operations kanban
- `products`, `sales`, `tables`, `kitchen` — ancillary sales, table management, Kitchen Display (all ride on the `sales` module; `kitchen` applies its `moduleGuard('sales')` per-route instead of via `modules.js`, same mixed-auth pattern as `calls`)
- `board` — Guest Board CMS (In-Room Media)
- `iot`, `calls` — Room Controller (MQTT-backed device state, room-to-desk calls)
- `insights` — Market Insights (competitors, trends, AI briefing)
- `communications` — guest email (owner-only)

**IoT database tables (migration 006):**
- `units.controller_id` — links a PMS unit to its ESP32 Room ID (e.g. `"1"`)
- `unit_relays` — relay labels and current state per unit
- `room_controller_status` — online/offline, IP, RGB state per controller

**MQTT client:** `server/mqtt/index.js` — connects to Mosquitto, subscribes to all room topics, updates DB on incoming messages.

**Migrations** (`server/db/migrations/`, run via `npm run migrate` → `server/db/migrate.js`):

| # | What |
|---|---|
| 001 | Initial schema |
| 002 | Pricing periods |
| 003–004 | Deposit amount / paid status |
| 005 | Dynamic sources & methods |
| 006 | IoT devices |
| 007 | Relay config |
| 008–009 | Roles |
| 010 | Guest board |
| 011–012 | Night audit |
| 013 | Booking discount |
| 014 | Market insights |
| 015 | Property location |
| 016 | Competitor extras |
| 017 | AI market summary |
| 018 | Calls |
| **019–021** | **Core multi-tenancy** — property_id everywhere, route scoping, per-property display_token |
| **022** | **Property module system** |
| **023–026** | **Superadmin + onboarding** — auth, admin routes, seedPropertyDefaults, singleton-table fixes, column widening |
| 027 | Fix namespaced role/source/method IDs |
| 028 | Folio charges |
| 029 | Tax config |
| 030 | Guest communication (email templates) |
| 031 | SMTP config (per-property) |
| 032 | Property branding (logo_url, brand_color on property_settings) |
| 033 | Group Bookings — `reservation_groups`, `bookings.reservation_group_id`, `group_booking_confirmed` email trigger |
| 034 | Kitchen Display System — `sales.order_type`/`table_number`/`kitchen_status` |
| 035 | Table Management — `restaurant_tables`, `sales.table_id` |
| 036 | Stock Tracking — `products.track_stock`/`stock_quantity`/`low_stock_threshold`, `stock_movements` |

**Next migration number: 037** (keep `ROADMAP.md` in sync when you add one).

---

## Frontend — Current State

**Stack:** React 18 + Vite 5 + PWA (vite-plugin-pwa)
**Location:** `client/`

Key pages (`client/src/pages/`): `Dashboard`, `Reservations`, `NewBooking`, `BookingDetail`, `CheckIn`, `QuickCheckIn`, `Guests`, `GuestProfile`, `Loyalty`, `Allotment`, `Pricing`, `Sales`, `Operations`, `NightAudit`, `Users`, `Settings` (Booking Sources & Payment Methods only — see below), `SettingsProperty`, `SettingsCommunications`, `SettingsRoles`, `SettingsBoardCards`, `SettingsRoomControllers`, `UnitSettings`, `Login`.

**`/settings` used to be one page mixing four unrelated concerns** (property name/address/tax config, SMTP + email templates + comm log, booking sources, payment methods) under a misleading "Sources & Methods" label. Split into three owner-only routes/pages: `/settings` (`Settings.jsx`, trimmed to just Booking Sources + Payment Methods, label now matches contents), `/settings/property` (`SettingsProperty.jsx`), `/settings/communications` (`SettingsCommunications.jsx`). All three share the same `GET/PATCH /api/settings/property` endpoint — the PATCH is `COALESCE`-based per-field server-side, so two pages independently patching different field subsets don't clobber each other (verified). All three are wrapped in `RequireOwner` at the route level now, not the old `RequireMenu menuKey="settings"` — the page component already hard-blocked non-owners regardless of `allowed_menus`, so this just moves the same real restriction to the route boundary (consistent with the `RequireOwner` pattern below).

Superadmin pages (`client/src/pages/admin/`): `AdminLayout`, `Properties`, `PropertyDetail`.

**Navigation** — `client/src/components/Sidebar.jsx` is the desktop nav (persistent left sidebar, replaced the old `TopNav` top bar + flyout-dropdown pattern in `App.jsx`). Mobile keeps the existing `BottomNav` (unchanged layout, in `App.jsx`) below the 768px breakpoint — same `.sidebar { display:none }` / `.bottom-nav { display:flex }` media-query swap mechanism as before, just swapping which desktop element hides. Superadmin's `AdminLayout.jsx` intentionally still uses the old top-bar pattern (`.nav-bar`/`.nav-logo`/`.nav-end` classes, kept in `index.css` for it) — it's a 2-page, non-module-driven shell, not part of this. `client/src/styles/global.css` is dead/unimported CSS (only `index.css` is actually loaded, via `main.jsx`) with overlapping class names — don't edit it, don't trust it when grepping for current styles.

Sidebar layout: `.sidebar-nav` (flex:1, `min-height:0`, its own `overflow-y:auto`) holds the daily-use items and is the one region that scrolls; `.sidebar-settings` sits below it as a separate, visually distinct, non-flex block (divider + dark tint) pinned above the footer — this mirrors Cloudbeds/Mews keeping config structurally apart from daily nav, not mixed into one list. Both "Rates & Channels" and the three Settings sub-groups (General / Guest & Booking / Admin) use the reusable `SidebarSection` component (collapsible, chevron toggle, open/closed state persisted per-section in `localStorage` under `sidebar-section-<id>`), collapsed by default for Settings so it doesn't visually dominate. **If `.sidebar`'s children ever look wrong again (one region eating another's space), check for competing `overflow`/`max-height` rules between `.sidebar` and its children first** — that exact bug happened once already.

**Route guards** — every module-gated client route is wrapped in `RequireModule` (in `App.jsx`; accepts a single module name or an array when a page depends on more than one, e.g. `/checkin` needs both `reservations` and `front_desk`), and every owner-only route in `RequireOwner`. Both the sidebar/bottom-nav *and* the routes read from the same `hasModule()`/`can()` in `AuthContext.jsx`, so toggling a module off in superadmin now both hides the link and blocks direct URL access — before this pass, only the nav-hiding half existed for most routes (worth checking `App.jsx`'s route list, not just the nav component, whenever a new module-gated page is added).

**Reservations calendar** (`Reservations.jsx`) shows each available night's effective rate (base rate, overridden by the highest-priority active pricing period) directly in the calendar cells, via `GET /api/pricing/calendar?month=&year=`.

**Folio** — running charge ledger per booking (room charges, F&B, sales, activities), settled at checkout. Tab on `BookingDetail.jsx`. Backed by `routes/folio.js` / migration `028`.

**Guest Communication** — email templates editor in Settings, per-property SMTP config (falls back to platform-default SMTP env vars if a property hasn't configured its own). Backed by `routes/communications.js` / migrations `030`–`031`.

**Per-property branding** — logo, brand color, and contact/invoice fields, set from the superadmin `PropertyDetail.jsx` "Branding" card (see Superadmin section above for the full trace). Rendered via `SettingsContext.jsx`'s `branding` value in the client nav, and via `/login/:slug` + an optional slug field on `Login.jsx` pre-auth. Backed by migration `032`.

**Group Bookings** (Phase D #9) — multiple room bookings under one guest + shared date range (villa/event groups), with a group-level discount/deposit prorated across child bookings, a master folio rollup, and best-effort group check-in. Backed by migration `033` (`reservation_groups` table, nullable `bookings.reservation_group_id`). `NewBooking.jsx`'s "+ Add Another Room" is the only new UI surface for *creating* one — a single-room submission still goes through the original `POST /api/bookings` untouched, and only 2+ rooms route to the new `POST /api/bookings/group`. New page `GroupDetail.jsx` (`/reservations/group/:groupId`) shows the room list, payment rollup, a "Check In Whole Group" action (`POST /api/checkin/group/:groupId/start`, partial-success — inspect the response body, not just the HTTP status), "Cancel Group", and a Master Folio tab (`GET /api/folio/group/:groupId`, aggregates each room's own folio — `folio_charges` still always posts per-room). `BookingDetail.jsx` shows a "Part of a group booking" banner when relevant; `CheckIn.jsx`/`QuickCheckIn.jsx` cluster same-group arrivals under one header. No new module — all new endpoints live inside the existing `bookings`/`checkin`/`folio` route files, so they inherit `reservations`/`front_desk`/`financial` gating for free. Multi-room groups get one combined confirmation email (new `group_booking_confirmed` template trigger, editable in Settings → Communications) instead of one per room.

---

## In-Room Display Hardware

Each unit can have **two displays** with distinct, complementary roles:

### 1. Room Display
**Primary purpose:** Device control — relay toggles, RGB LED, AC via IR blaster
**Secondary:** Shows guest name and stay dates at a glance; guest self-ordering (see below)

- Calls `GET /api/display/room/:roomId/state` (via `authDisplay` middleware, per-property `display_token` — not a staff JWT)
- Three screens: `SetupScreen` (first-time config), `IdleScreen` (vacant), `GuestScreen` (occupied)
- Room ID and display token stored in localStorage on the device
- Debug menu triggered by 5 rapid taps
- Stack: React/Vite PWA (`room-display/`)
- **Guest self-ordering** (extends the `sales` module, see `ROADMAP.md`): when occupied and the property's `sales` module is on (`state.orderingEnabled`), `GuestScreen` shows an "Order Food" tab (`OrderFoodTab.jsx`) listing the full product catalog. `GET /api/display/room/:roomId/menu` + `POST /api/display/room/:roomId/order` (both `authDisplay` + `moduleGuard('sales')`) create a `room_charge` / `room_service` sale against the room's current `checked_in` booking — prices are always looked up server-side, never trusted from the tablet. Feeds the same Kitchen Display (`/kitchen` in the PMS client) as staff-entered orders. Sale creation itself lives in `server/services/salesService.js`, shared with the staff POS (`routes/sales.js`).

### 2. TV Welcome Display
**Only purpose:** Welcome guests and show their stay details when TV is idle. No device controls — purely guest-facing ambient display.

- Android TV screensaver (DreamService APK, `tv-screensaver/`, package `com.zahill.tvscreensaver`) wraps a fullscreen WebView loading `tv-display/`
- Screensaver launches after TV idle; any remote button press exits back to normal TV
- APK sideloaded per TV (no Play Store); Room ID configured once at install (SharedPreferences)
- Landscape only, large text, no touch interaction
- Calls the same `GET /api/display/room/:roomId/state` endpoint as Room Display
  - Returns: `unit.name`, `booking.guest_name`, `booking.check_in_date`, `booking.check_out_date`, `booking.num_guests`, `property.{name,logo_url,brand_color}`
  - Returns `booking: null` when vacant → branded idle screen

Both displays render the property's own logo/name from that `property` field (falling back to the bundled default asset/text when a property hasn't uploaded one) — see the Superadmin Property Branding trace above.

---

## Market Insights (Dashboard)

Three cards on the Owner Dashboard, backed by `server/routes/insights.js`, `server/jobs/marketInsights.js`, `server/jobs/index.js`. All external API calls degrade gracefully (skip + log) when their key isn't set.

- **Competitor Ratings** — manually curated. Owner types a competitor name; backend resolves via Google Places Text Search (`services/googlePlaces.js`), tracks rating/review count/price level. `POST /api/insights/competitors`, `DELETE /api/insights/competitors/:id` (soft delete). Daily refresh at 06:00 (per property, once jobs are scoped — confirm `marketInsights.js` loops over active properties rather than assuming a single one, per the multi-tenancy migration guide).
- **Search Interest** — Google Trends (unofficial library). Tracked terms in `TREND_TERMS` — confirm these are Zahill-relevant (glamping/Bali terms), not leftover from Birdnest.
- **AI Weekly Briefing** — Claude API (`services/claude.js`), structured JSON output. Monday refresh. Confirm the property-description prompt is Zahill's, not Birdnest's.
- **Holidays** — `holidays` table, Indonesian national + Balinese Hindu observances. Region-specific — a non-Bali property would need different seeding.

Manual refresh triggers (owner only): `POST /api/insights/competitors/refresh`, `/api/insights/trends/refresh`, `/api/insights/summary/refresh`.

---

## Environment Variables

See `server/.env.example` for the full current list (kept up to date — check there first, not here, since env vars change often). Categories: server/DB core, JWT, CORS origins (`CLIENT_URL`/`DISPLAY_URL`/`TV_URL`, comma-separated for multi-origin dev), Room Display/TV `DISPLAY_TOKEN`, MQTT, Market Insights (`GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`), weather, platform-default SMTP (`PLATFORM_SMTP_*`, used when a property hasn't set its own), and `SERVER_PUBLIC_URL` (this server's own publicly reachable base URL, used to build absolute property-logo URLs for guest emails — unset in local dev just skips the logo image in emails).

---

## Important Conventions

- **Every new table needs `property_id`** (unless it's genuinely platform-global, like `properties` itself or superadmin-only tables) — and every route touching it needs `WHERE property_id = $n` on every SELECT/INSERT/UPDATE/DELETE. This is the single easiest thing to forget when adding a feature; it's the difference between multi-tenant and a data leak between clients.
- **Relays are generic** — `relay_1`...`relay_N` in firmware/DB. Human-readable labels live in `unit_relays`. Never hardcode relay purposes in firmware.
- **Room IDs** — ESP32 uses simple string IDs, mapped via `units.controller_id`.
- **No localStorage in PWA artifacts** — use React state or backend for persistence (exception: Room Display's own device-local room ID/token, which is intentionally local to that physical tablet).
- **CommonJS in server** — `require()`, not `import`. Do not convert to ESM.
- **Migrations** — numbered SQL files in `server/db/migrations/`, next is `034`. Update the "Next migration number" line in `ROADMAP.md` when you add one.
- **New features that touch routes must consider**: does this need a new module in `server/modules.js`? Does it need `property_id` scoping? Should the migration number and this file's migration table both be updated in the same commit?
- **New module-gated client pages need `RequireModule` on the route, not just a `hasModule()` check in the nav** — `client/src/App.jsx`'s route list and `client/src/components/Sidebar.jsx`/`BottomNav`'s nav-visibility checks are two separate places that must agree; it's easy to add one and forget the other (this was a real, multi-route bug fixed in one pass — see `git log` around the sidebar redesign).

---

## Open Decisions (not yet final — context for whoever picks this up next)

- **Product name:** currently "Zahill PMS" / "ZHP PMS" are placeholders. Shortlisted a real brand name: **Nestly** is the front-runner (clean trademark/domain check, though `nestly.com` itself is squatted — would need `.io`/`getnestly.com`/similar). Guesthive and Havenstay were also clear on a conflict check. Not yet decided — don't rename anything in code/docs until it's locked in.
- **WhatsApp messaging (Phase B item 5):** decided against Fonnte (unofficial WhatsApp Web gateway) due to real ban risk for a product resold to paying clients. Leaning toward **api.co.id** — an Indonesian Meta Tech Provider offering the official WhatsApp Cloud API at low cost with no per-message markup. Architecture direction: **one WhatsApp number/WABA per property** (not one shared platform-wide number), managed under the platform's own Meta Business Portfolio via the Tech Provider / Embedded Signup model — this keeps messages branded as the property (guests see "Zahill," not the platform name) while sparing each client the full manual Meta Business Verification (they can start immediately at the unverified 250-conversations/day tier). Not yet implemented — no `whatsapp` module, no migration, no route file exist yet. See chat history for the full reasoning if picking this up cold.

---

## Roadmap Status (summary — full detail in ROADMAP.md)

- ✅ Foundation complete (migrations 001–026): core PMS, operations, sales, loyalty, market insights, in-room media, Room Controller/IoT, multi-tenancy, module system, superadmin.
- ✅ Phase A (Guest Folio, Invoice/Receipt PDF, Tax & Service Charge config) — implemented, migrations 028–029.
- ✅ Phase B item 4 (Automated Email) — implemented, migrations 030–031.
- ⏳ Phase B item 5 (WhatsApp messaging) — not started; leaning toward api.co.id (official WhatsApp Cloud API), see Open Decisions below.
- ✅ Superadmin Property Branding (logo, brand color, contact info) — implemented, migration 032.
- ✅ Phase D item 9 (Group Bookings) — implemented, migration 033.
- ✅ Phase D item 10 (F&B / Full POS) — implemented across four slices: Kitchen Display System + guest self-ordering (migration 034), then table management + stock tracking (migrations 035–036).
- 🔵 **Phase D item 11 (Concierge / Activities) — NEXT.** Not started.
- ⚪ Phase C (Direct Booking Engine, Beds24 Channel Manager) — deprioritized behind Phase D's selected modules, not started.
- ⚪ Phase D remaining (Reviews & Feedback, Stripe subscription billing) — build when a client actually requests it.

Check `ROADMAP.md` directly before starting new work — this summary will drift faster than that file does.

---

## Working Across Multiple Machines (laptop + PC)

Since development happens on two machines, **this file and `ROADMAP.md` are the handoff mechanism** between them — not memory, not chat history. Treat doc updates as part of the feature, not cleanup afterward.

**Every time you (or Claude) finish a feature, migration, or architectural change:**
1. Update `ROADMAP.md` — flip the status, bump "Next migration number" if a migration was added.
2. Update this file (`CLAUDE.md`) if the change affects: routes, migrations table, module registry, module list, env vars, naming conventions, or known gaps.
3. Commit docs **in the same commit** as the code change, not a separate "docs" commit later — it's too easy to skip that second commit.
4. `git push` before walking away from either machine.

**Starting a session on either machine:**
1. `git pull` first, always — don't trust memory of "where things were."
2. Re-read this file's Multi-Tenancy and Roadmap Status sections if it's been more than a few days.
3. Run `npm run migrate` in `server/` if migrations were added on the other machine — check the migrations table above against what's actually applied in your local DB if unsure.
4. `npm install` in `client/` and `server/` if `package.json`/lockfiles changed.

If a feature was left half-done on one machine, add a one-line note under "Known gaps" in the relevant section above (or a `<!-- TODO -->` comment) rather than relying on remembering it — the whole point of this file is that neither machine has to hold context in your head.
