# ZHP PMS — Claude Code Context

> Read this file before starting any work. It defines naming conventions, architecture decisions, and current project state. **Keep it updated** — see "Working Across Multiple Machines" at the bottom. This file is the single source of truth that travels with the repo between the laptop and the PC; if it's stale, the next session starts blind.

---

## What this is

**ZHP PMS** (working platform name — originally built as "Zahill PMS" for a single property, now a **multi-tenant Property Management System platform** intended to be sold/hosted for multiple hotel/glamping clients from one shared codebase and database). Zahill is the first, reference property running on the platform; "Birdnest" is a second property used to build and verify multi-tenancy end-to-end. Both run on the same infrastructure, fully data-isolated from each other.

Built as a monorepo with React/Vite frontend(s) and a Node/Express backend shared by every property.

**Owner:** Juppy (juppyjp@gmail.com)

**Product name is now locked: HALF.** Domain/tenancy scheme decided (2026-08-14): a single app subdomain (`half.kdai.cloud`), not one subdomain per client. Every property logs into the same domain; the JWT (already carries `propertyId`) is what resolves tenant, exactly like GitHub/Stripe Dashboard/Google Workspace rather than Shopify-style `client.myapp.com`. Rejected per-client subdomains because it would require wildcard DNS/cert + a Host-header-based login rewrite for no real benefit at current scale (one browser origin is fine since no one needs two properties open in parallel tabs today — superadmin already has its own separate, non-property-scoped auth layer for cross-property work). Module-specific subdomains keep the existing pattern, just moved off `zahill.kdai.cloud` onto `half.kdai.cloud` (e.g. `kitchen.half.kdai.cloud`, `display.half.kdai.cloud`, `tv.half.kdai.cloud`) — small fixed set, no wildcard needed. If a client later wants their own branded custom domain, that's a per-client CNAME added on top of this, not a redesign.

**Not yet done:** this is a naming/architecture decision, not an executed migration — `zahill.kdai.cloud`/`d-zahill.kdai.cloud` are still the live domains, and "Zahill PMS"/"ZHP PMS" still appear throughout code (package names, page titles, MQTT topic namespace, Nginx configs). Renaming those and standing up `half.kdai.cloud` is future work, not done in this pass.

---

## Monorepo Structure

```
ZHP PMS/
├── client/              ← PMS frontend (React/Vite PWA) — property staff + superadmin
│   └── src/pages/admin/ ← Superadmin-only pages (Properties list, PropertyDetail)
├── server/              ← Shared backend (Node/Express), serves ALL properties
├── room-display/        ← Room Display PWA (per-room tablet)
├── tv-display/           ← TV Welcome Display (React/Vite page loaded by the screensaver APK)
├── kitchen-display/      ← Kitchen Display PWA (kitchen ticket board kiosk)
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
| `reservations` | bookings, checkin, allotments, pricing, ratePlans | ✅ on |
| `front_desk` | checkin | ✅ on |
| `guest_crm` | guests, loyalty | ✅ on |
| `financial` | payments, reports, nightAudit, folio | ✅ on |
| `operations` | tasks | ✅ on |
| `sales` | products, sales, tables | ✅ on |
| `in_room_media` | board, display | ✅ on |
| `room_controller` | iot | ❌ off by default (hardware-dependent) |
| `insights` | insights | ✅ on |
| `activities` | activities | ✅ on |
| `calling` | calls | ✅ on |

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
- `bookings`, `checkin`, `allotments`, `pricing`, `ratePlans` — reservations + front desk (`ratePlans` = the "arrangement" per booking: RO/BB/HB/FB + a flat net per-pax-per-night meal price; owner CRUD at `/settings/rate-plans`)
- `guests`, `loyalty` — guest CRM
- `payments`, `reports`, `nightAudit`, `folio`, `agents` — financial (`agents` = Agent Accounts / Direct Billing #13: per-agent statement, AR aging, agent payments + allocations, consolidated invoice PDF; owner-only per handler)
- `tasks` — operations kanban
- `products`, `sales`, `tables` — ancillary sales, table management (ride on the `sales` module via `modules.js`)
- `kitchen` — Kitchen Display kiosk app's API. `authDisplay` (per-property `display_token`, same as `display`) on every route, not staff JWT — the Kitchen Display is its own kiosk app (`kitchen-display/`), not a page inside the PMS client. `moduleGuard('sales')` applied per-route instead of via `modules.js`.
- `board` — Guest Board CMS (In-Room Media)
- `iot` — Room Controller (MQTT-backed device state, ESP32 relay/RGB/IR — hardware-dependent, off by default)
- `calls` — Calling (two-way room↔desk voice, own `calling` module, no hardware dependency — see the Room Display section below for the full write-up)
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
| 037 | Concierge / Activities — `activities`, `activity_bookings`, new `activities` module |
| 038 | Guest Board ↔ Activities linking — nullable `guest_board_cards.activity_id` FK |
| 039 | Two-way calls — `calls.direction` (`room_to_staff`/`staff_to_room`), `calls.initiated_by` |
| 040 | Split `calling` module out of `room_controller` — seeds `calling=true` for every property |
| 041 | Agent Accounts / Direct Billing (Phase D #13, Slice A) — `booking_sources` generalized with `source_type` (walkin/direct/booking_engine/ota/travel_agent/company/wholesaler), `payment_status` (normal/city_ledger/city_ledger_payment/commission/commission_and_city_ledger), and agent billing fields (contact, NPWP `tax_id`, `billing_address`, `credit_terms_days`, `credit_limit`, `commission_type`/`commission_value`). Additive only — `bookings.source` unchanged, `is_ota` kept. |
| 042 | Agent Accounts / Direct Billing (Phase D #13, Slice B) — nullable `bookings.folio_status` (`pending_agent_invoice`), new `agent_commissions` ledger (`booking_id` unique). City-ledger checkout + commission posting via `server/services/agentBillingService.js`; `loadFolio` extracted to `server/services/folioService.js`. Additive only. |
| 043 | Agent Accounts / Direct Billing (Phase D #13, Slice C) — `agent_invoices`, `agent_payments`, `agent_payment_allocations` tables + `bookings.agent_invoice_id`. `folio_status` now also uses `'invoiced'`/`'paid'`. Statement/aging/payments/consolidated-invoice via `server/services/agentStatementService.js` + `server/routes/agents.js` + `client/src/pages/Agents.jsx`. Additive only. |
| 044 | Rate plans ("arrangements") + bed config + room/F&B net revenue split. New `rate_plans` (RO/BB/HB/FB per property, flat `meal_price` net per pax/night, one `is_default`). `units.bed_config`, `bookings.bed_preference` (double/twin/twin_or_double/other). `bookings.rate_plan_id` + `room_revenue`/`fnb_revenue` (NET, post-discount; `computeFolioTotals(room_revenue+fnb_revenue).total ≈ total_amount−discount`). `folio_charges.service_date` + partial unique index `uq_folio_charges_night`. `night_audit_runs.fnb_revenue`. Backfill: `room_revenue = (total_amount−discount)/F`. **Reports/dashboard/night-audit/loyalty room-revenue now NET** (visible drop vs the old gross `total_amount` sum). **Slice 2 (per-night auto folio posting, `server/services/roomChargeService.js`) also ships on this migration** — night audit posts one `room` + one `fnb` `folio_charges` row per in-house booking per night (idempotent); checkout catches up / voids early-departure nights; `PUT /:id/dates` + rate-plan change repost; cancel/no-show void. Fixes the pre-existing gap where a normal stay's folio never contained the room charge. |

| 045 | Room ID (`units.controller_id`) — scope + default. The `UNIQUE (controller_id)` index was **global**, not per-property (two properties couldn't both have a room "101") — now `UNIQUE (controller_id, property_id) WHERE NOT NULL`. Widened `varchar(10)→(32)`. Backfilled `controller_id = name` for every unit that had none (per property; skips names >32 chars or that collide with an existing custom id). `POST /api/units` now defaults `controller_id` to the room name (overridable; explicit `''` opts out) — `routes/units.js` + `routes/iot.js` slice bumped to 32, 23505 messages say "Room ID". Fixes the friction where a display-only property had to hand-type a Room ID for every room. |

**Next migration number: 046** (keep `ROADMAP.md` in sync when you add one).

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

**Amend stay dates / manual no-show** — two front-desk gaps closed after a reservation-flow audit against Cloudbeds/Mews-style PMS behavior. `BookingDetail.jsx`'s "Amend Dates" action (`PUT /api/bookings/:id/dates`) lets staff change check-in/check-out on an existing booking without going through Transfer Room — re-checks conflicts on the same unit, does **not** touch `total_amount` (staff adjust that separately if needed), and is blocked for group-member bookings (dates are shared across a group's rooms; amending one room's dates independently isn't supported yet). "Mark No-Show" (`PUT /api/bookings/:id/no-show`, also surfaced as a quick action on `CheckIn.jsx`'s arrivals list) lets staff flag a no-show manually instead of waiting for the nightly `runNightAudit` job, which still auto-flags any `confirmed` booking whose check-in date has passed. Neither endpoint sends a guest-facing email (the `email_templates` `TRIGGERS` list wasn't extended) or touches payments/refunds — both remain open gaps.

**`BookingDetail.jsx` action menu** — the page header had grown to up to 8 buttons in a row (Amend Dates, Transfer Room, WhatsApp, Check In/Out, Confirm, Mark No-Show, Cancel) once Call Room was added on top; consolidated into a new reusable `ActionMenu.jsx` (`client/src/components/`) — a generic "⋮" dropdown taking `items: [{ label, icon, onClick, danger }]`, falsy entries filtered so conditional items read naturally (`condition && {...}`). Only the single status-driven primary CTA (Check In / Check Out / Confirm Booking — whichever applies) stays as a visible button; everything else, including the new **Call Room** action (`hasModule('room_controller')`-gated, calls `useCall()`'s `callRoom({ id: booking.unit_id, name: booking.unit_name })` directly — no room picker needed since the booking already names its own unit), moved into the menu. Not yet reused elsewhere, but written generically enough to (`GroupDetail.jsx`'s own button row would be the next candidate if it grows).

**Folio** — running charge ledger per booking (room charges, F&B, sales, activities), settled at checkout. Tab on `BookingDetail.jsx`. Backed by `routes/folio.js` / migration `028`. The folio money math (`loadFolio` — subtotal → service charge → tax → total → balance_due) lives in `server/services/folioService.js` (extracted in migration 042's pass so `agentBillingService` can reuse it); `routes/folio.js` keeps only the HTTP handlers + the PDF renderer.

**Guest Communication** — email templates editor in Settings, per-property SMTP config (falls back to platform-default SMTP env vars if a property hasn't configured its own). Backed by `routes/communications.js` / migrations `030`–`031`.

**Per-property branding** — logo, brand color, and contact/invoice fields, set from the superadmin `PropertyDetail.jsx` "Branding" card (see Superadmin section above for the full trace). Rendered via `SettingsContext.jsx`'s `branding` value in the client nav, and via `/login/:slug` + an optional slug field on `Login.jsx` pre-auth. Backed by migration `032`.

**Group Bookings** (Phase D #9) — multiple room bookings under one guest + shared date range (villa/event groups), with a group-level discount/deposit prorated across child bookings, a master folio rollup, and best-effort group check-in. Backed by migration `033` (`reservation_groups` table, nullable `bookings.reservation_group_id`). `NewBooking.jsx`'s "+ Add Another Room" is the only new UI surface for *creating* one — a single-room submission still goes through the original `POST /api/bookings` untouched, and only 2+ rooms route to the new `POST /api/bookings/group`. New page `GroupDetail.jsx` (`/reservations/group/:groupId`) shows the room list, payment rollup, a "Check In Whole Group" action (`POST /api/checkin/group/:groupId/start`, partial-success — inspect the response body, not just the HTTP status), "Cancel Group", and a Master Folio tab (`GET /api/folio/group/:groupId`, aggregates each room's own folio — `folio_charges` still always posts per-room). `BookingDetail.jsx` shows a "Part of a group booking" banner when relevant; `CheckIn.jsx`/`QuickCheckIn.jsx` cluster same-group arrivals under one header. No new module — all new endpoints live inside the existing `bookings`/`checkin`/`folio` route files, so they inherit `reservations`/`front_desk`/`financial` gating for free. Multi-room groups get one combined confirmation email (new `group_booking_confirmed` template trigger, editable in Settings → Communications) instead of one per room.

**Concierge / Activities** (Phase D #11) — a schedulable, capacity-limited, staff-confirmed booking concept for tours/transport/wellness, deliberately separate from two pre-existing, unrelated concepts: `products.category='tour'` (a flat instant-purchase POS item, unchanged) and `guest_board_cards.category='activity'` (static "things to do" info cards on the Guest Board CMS — see the linking note below, this is no longer fully unrelated). New module `activities` (default on), backed by migration 037 (`activities`, `activity_bookings`). New page `client/src/pages/Activities.jsx` (`/activities`) with Catalog (owner-only CRUD, any-staff read — same convention as `products.js`) and Bookings tabs (date/status filters, confirm/complete/cancel/no-show actions, a revenue summary card for owners). Requests always start at `status='requested'`, never auto-confirmed, since capacity/guide/vehicle availability can't be verified from a tablet the way a drink order can; staff desk bookings (from `Activities.jsx`) skip straight to `confirmed`. Revenue tracking: confirming a `room_charge` booking posts a real `folio_charges` row (`type='activity'`, already a valid value from migration 028 — no folio migration needed) via `server/services/activityBookingService.js`, and cancelling/no-showing a confirmed booking voids it — this fixes, for this feature only, a pre-existing gap where F&B room-charge sales never post to the folio (`salesService.createSale` still doesn't; out of scope to fix there). `BookingDetail.jsx` shows a read-only "Activities" tab for that booking's activity bookings. **Guests never browse the raw `activities` catalog directly on Room Display** — see the linking note below for how they actually reach a booking.

**Guest Board ↔ Activities linking** — closes the gap above: Guest Board and Activities shipped as two disconnected systems, meaning staff had to enter the same tour twice with no link between the promotional card and the bookable catalog row, *and* guests saw two separate, confusingly-both-labeled "Activities" menus on Room Display (the Explore promotional carousel and a standalone bookable-catalog nav tab). Fixed both problems in one pass: **Guest Board is now the sole guest-facing entry point for activities** — the standalone catalog-browsing nav tab is gone; an activity with no linked Guest Board card simply isn't reachable by guests (staff must link/create a card to expose it).

- Migration 038 adds a nullable `guest_board_cards.activity_id` FK. `activities` stays the sole owner of commerce fields (price/duration/capacity) — `server/services/activitiesService.js` holds the one `createActivity()`/`setAvailability()` write path, shared by `routes/activities.js`'s `POST /` and the Guest Board paid-card flow below.
- `SettingsBoardCards.jsx` gets a Free/Paid toggle (gated on `hasModule('activities')`). Going Paid on an unlinked card offers **two** paths: **create new** (one field, price — auto-creates the activity from the card's title/body) or **link an existing, not-yet-linked activity** (a dropdown of `GET /api/activities` rows not already claimed by another card — closes the gap where an activity made directly in the Catalog tab, e.g. legacy pre-linking data, had no way to become guest-visible without being duplicated). `routes/board.js`'s `linkOrCreateActivity()` helper handles both, rejecting a `link_activity_id` already claimed by another card (409). Once linked, price is **read-only** with a "Manage full details →" link into `/activities` — no further commerce-field editing from Guest Board, ever.
- Going back to Free (or deleting a linked card) never deletes the `activities` row — it sets `is_available = false` and clears `activity_id`, since `activity_bookings` has an `ON DELETE RESTRICT` FK to it once there's booking history.
- `routes/board.js`'s `GET /` and `routes/display.js`'s `GET /room/:roomId/state` both gained a `LEFT JOIN activities`, with the display endpoint only surfacing `activity_id`/`activity_price` while the linked activity is still available — a deactivated link silently stops showing a booking CTA without touching the card.
- Room Display: a linked+available Guest Board card shows price + a "Book Now" CTA (`ExploreTab.jsx`) that opens `BookActivityTab.jsx` as a focused single-activity booking panel (`GuestScreen.jsx`'s `preselectedActivityId` state — set on tap, cleared on "Back"), overlaid on top of whatever tab was showing. `BookActivityTab` no longer has its own sidebar nav entry and no longer shows a catalog grid — it only ever renders the one preselected activity's booking form.

---

## In-Room Display Hardware

Each unit can have **two displays** with distinct, complementary roles, plus one property-wide Kitchen Display kiosk (not per-unit):

### 1. Room Display
**Primary purpose:** Device control — relay toggles, RGB LED, AC via IR blaster
**Secondary:** Shows guest name and stay dates at a glance; guest self-ordering (see below)

- Calls `GET /api/display/room/:roomId/state` (via `authDisplay` middleware, per-property `display_token` — not a staff JWT)
- Three screens: `SetupScreen` (first-time config), `IdleScreen` (vacant), `GuestScreen` (occupied)
- Room ID and display token stored in localStorage on the device
- Debug menu triggered by 5 rapid taps
- Stack: React/Vite PWA (`room-display/`)
- **Guest self-ordering** (extends the `sales` module, see `ROADMAP.md`): when occupied and the property's `sales` module is on (`state.orderingEnabled`), `GuestScreen` shows an "Order Food" tab (`OrderFoodTab.jsx`) listing the full product catalog. `GET /api/display/room/:roomId/menu` + `POST /api/display/room/:roomId/order` (both `authDisplay` + `moduleGuard('sales')`) create a `room_charge` / `room_service` sale against the room's current `checked_in` booking — prices are always looked up server-side, never trusted from the tablet. Feeds the Kitchen Display kiosk (below) the same as staff-entered orders. Sale creation itself lives in `server/services/salesService.js`, shared with the staff POS (`routes/sales.js`).
- **Guest activity booking** (extends the `activities` module — see the Guest Board ↔ Activities linking write-up above for the full picture): reached only via "Book Now" on a linked Guest Board card, never a standalone catalog tab — `BookActivityTab.jsx` renders as a focused single-activity panel. Unlike food ordering, a guest request always starts as `status='requested'` — staff must confirm before it's guaranteed or billed.
- **Your Orders** — closes the gap where a placed food order or activity request had nowhere to go after its 4–5 second confirmation toast. `GET /api/display/room/:roomId/orders` (`authDisplay`, not module-gated — it's just the guest's own current-stay data) returns the room's active booking's `sales`/`sale_items` (`order_type='room_service'`, with `kitchen_status`) and `activity_bookings` (with `status`) in one call. `GuestScreen.jsx` polls it every 15s and also refetches immediately after a successful order/booking (`onOrderPlaced`/`onBooked` callbacks from `OrderFoodTab.jsx`/`BookActivityTab.jsx`). A new "Your Orders" nav entry (`YourOrdersTab.jsx`) appears only once there's at least one order/booking for the stay — same conditional-visibility convention as the Explore tabs — with a small pulsing dot while anything is still in flight (food not yet `served`, activity not yet past `requested`/`confirmed`). Positioned in its own divided-off section directly above the call-front-desk button, separate from the Controls/Order Food group and the Explore tabs group above it.
- **Room-to-desk calling (two-way)** — real voice calls (WebRTC, audio-only, public STUN only — no TURN, so it assumes caller/callee share the hotel's network; cross-network calling is a known limitation) between a room's tablet and staff, gated by its own `calling` module (default **on**, see below — not `room_controller`). One `calls` table, `direction` column (`room_to_staff` default / `staff_to_room`, migration 039) distinguishing who placed it, signaled over Server-Sent Events per room (`room:{controllerId}` channel) and per property for staff (`staff:broadcast:{propertyId}` channel) — `routes/calls.js`'s `/signal` and `/signal-from-room` are direction-agnostic relays (just forward whatever offer/answer/ICE payload to the other side), so adding the reverse direction only needed two new endpoints: `POST /to-room` (staff places a call, auth-gated, picks any unit with a `controller_id` assigned) and `POST /:id/answer-from-room` (guest answers). A 45s ring timeout auto-marks a call `missed` either direction. Both `room-display/src/callClient.js` and `client/src/services/callClient.js` are now symmetric — each can play offerer (`createOffer`) or answerer (`createAnswer`) role, since which side initiates now varies. Staff trigger an outgoing call from a "Call a Room" entry in `Sidebar.jsx` (visible whenever `calling` is on, not owner-gated — any staff can already answer an incoming call, so any staff can place one) → `CallRoomModal.jsx` lists units with a controller assigned (deliberately doesn't show online/offline — `GET /api/iot/units`'s `connected` field is the ESP32 controller's MQTT status, not the Room Display tablet's, and there's no tracked presence signal for the tablet app itself; an unanswered call just rings out and gets marked missed, same as the reverse direction already did). On the room side, `CallOverlay.jsx` gained an `'incoming'` status (red ringing UI, Answer/Decline) reached via a new `incoming_call_from_staff` SSE event in `App.jsx`. Room Display's own `CallButton` (both `GuestScreen.jsx` and `IdleScreen.jsx`) is gated by a new `callingEnabled` flag on `GET /room/:roomId/state` — hidden entirely when the module's off, rather than showing a button that 403s.
- **`controller_id` (Room ID) assignment is deliberately NOT gated behind `room_controller`**, even though it lives on the same `units` row the module's relay/RGB/IR features use. Room Display/TV Display/Kitchen Display/calling all key off `controller_id` regardless of whether a property has ESP32 hardware — a hardware-less client still needs to assign a Room ID to get any guest-facing display working at all. `PUT /api/units/:id` (always-on route) accepts `controller_id` directly, and `/units` → `UnitSettings.jsx` has a "Room ID" field, so it's settable with zero dependency on the module. `PUT /api/iot/units/:unitId/controller` (gated, `SettingsRoomControllers.jsx`) still exists too and writes the same column — harmless duplication, kept for hardware-owning clients configuring relay labels at the same time. **Migration 045 went further**: `controller_id` now *defaults to the room name* on `POST /api/units` (so a display-only property never hand-types Room IDs — they're the room number by default, still overridable), and its uniqueness is finally scoped `(controller_id, property_id)` instead of global (two properties can now both have a room "101"; column widened to `varchar(32)`). Separately, `GET /room/:roomId/state` gained a `roomControllerEnabled` flag (mirroring `orderingEnabled`/`activitiesEnabled`) so Room Display's relay/RGB/IR "Controls" tab (`GuestScreen.jsx`, `IdleScreen.jsx`) actually hides when the module is off — previously it showed unconditionally regardless of the toggle, a real bug caught in production testing.
- **Calling split into its own module (migration 040), same day as the above.** Calling was originally gated by `room_controller` purely because it also keys off `controller_id` — it has zero actual ESP32/MQTT dependency. That meant a hardware-less property couldn't get calling either, hit for real in production (`moduleGuard` 403 "Module not enabled for this property" on "Call Front Desk"). New standalone `calling` module (default **on**, unlike `room_controller`) — `server/modules.js`'s `room_controller` entry now only gates `iot`; `routes/calls.js`'s `const gate = moduleGuard(...)` points at `'calling'`. Rewired every place that checked `hasModule('room_controller')` for calling specifically: `Sidebar.jsx`'s "Call a Room" entry, `BookingDetail.jsx`'s "Call Room" action, Room Display's `callingEnabled` flag (above). `PropertyDetail.jsx`'s `MODULE_LABELS` and `seedPropertyDefaults.js` (which defaults every module to enabled except `room_controller` by name, so `calling` needed no special-casing) picked it up for free. The Room Controllers settings page/link (`SettingsRoomControllers.jsx`, `/settings/room-controllers`) is unaffected — still correctly gated by `room_controller`, since relay/RGB/IR config is genuinely hardware-specific.
- **Calling reliability fix (2026-08-20, commit 28d0c30).** Calls used to hang on "Connecting…" forever whenever WebRTC ICE negotiation failed or stalled — `onConnectionStateChange` only reacted to `'connected'`, and an incoming call's offer arriving late was silently ignored. Both `room-display/src/App.jsx` and `client/src/context/CallContext.jsx` now: treat `failed`/`disconnected`/`closed` as a hangup, enforce a 25s connecting timeout, and poll up to 5s for a late-arriving offer instead of no-opping — surfacing a clear "Could not connect" message either side (`CallOverlay.jsx` / `CallBanner.jsx`) instead of hanging indefinitely. Also added `room-display/src/ringtone.js` (ported from the staff app's `services/ringtone.js`, same synthesized Web Audio beep) — Room Display previously had no ringtone at all on an incoming staff call, only the staff side did.
- **Known gap: calls still fail intermittently even with the above** — same-WiFi calls succeed maybe 1 in 4-5 attempts (retrying eventually connects). Root cause is architectural, not the timeout logic: STUN-only, no TURN server (see the calling write-up above), which is flaky under NAT hairpinning / any AP client-isolation on the property's router. Fix is scoped (self-host `coturn` on the same cloud VM — lightweight, negligible resource cost) but **deliberately deferred** — user said "not now" on 2026-08-20. Don't build it unprompted; revisit when raised again.
- **`CallRoomModal.jsx` was fetching from the wrong endpoint (2026-09-05) — real bug, calling was completely broken from the Sidebar.** It listed rooms via `GET /api/iot/units`, which is gated behind the `room_controller` module — off by default, and with zero actual relation to calling (that's exactly why `calling` was split into its own module in the first place, see above). On every hardware-less property the fetch just 403'd, silently caught, leaving "No rooms have a controller assigned yet." Fixed to use the always-on `GET /api/units` instead (same `controller_id` field). While in there, replaced the single scrolling list-row-with-a-Call-button (unusable past a handful of rooms — 35 rows to hunt through on Zahill) with a grouped tile grid, same visual language as the Dashboard's Live Unit Status board, plus a search box that filters live — tapping a tile calls directly.
- **Dashboard: Call Room from Live Unit Status (2026-09-05).** `UnitCard` (the room detail popover) gained a "📞 Call Room" button — same eligibility as the Sidebar modal (`calling` module on + `unit.controller_id` assigned), reusing `useCall()`'s `callRoom()`. Needed `u.controller_id` added to `routes/dashboard.js`'s occupancy query (wasn't selected before).
- **Fixed a real "busy" bug: a second incoming call could hijack a busy staff member's screen and silently drop their first call.** `CallContext.jsx`'s SSE handler `setIncomingCall(...)` unconditionally on every `incoming_call` broadcast — even for a staff member already mid-call. `CallBanner.jsx` renders `incomingCall` with priority over `activeCall`, so their screen got hijacked by the new prompt, and tapping Answer reused the single `callClient` WebRTC connection, killing the first call with no clean hangup (its DB row never got `ended_at`). Fixed: the SSE handler now ignores a new `incoming_call` entirely when `activeCallRef.current` is set (mirrors a guard `room-display/src/App.jsx` already had — `if (callIdRef.current) return`), and ignores it if there's already an unanswered incoming call pending (first one wins). `answerCall()` got the same guard as defense-in-depth. Verified live: staff answers Room 202, Room 201 calls in immediately after, staff's screen stays on the Room 202 "Connecting…" banner with no interruption.
  - **Deliberately not built (discussed, deferred):** an API-level "busy" rejection (reject a new call outright when no staff is free) needs real staff-presence tracking that doesn't exist yet — a naive version ("busy" = any call currently `answered`) would be *wrong* for any property with 2+ staff, since it'd reject calls even when another staff member is free. The existing broadcast-to-every-staff-session + first-to-answer-wins (DB-level `WHERE status='ringing'` guard) already routes correctly when anyone's free; only revisit this if a single/short-staffed shift missing calls turns out to matter in practice.
  - **Also discussed, deferred:** room-to-room calling (a guest calling another room directly). Feasible — `callClient.js` is already symmetric, each room has its own SSE channel — but `calls` only models one room + a `direction` (no second room slot), and open any-room-to-any-room dialing is a real guest-privacy concern most hotels avoid. If built, scope it to rooms sharing a `reservation_group_id` (existing Group Bookings feature) rather than open dialing. User is thinking it over — don't build unprompted.
- **Guest Screen landing tab fixed (2026-08-20, same commit as above).** `GuestScreen.jsx` used to default to whichever of Controls/Order Food/first Explore tab existed (`roomControllerEnabled ? 'controls' : orderingEnabled ? 'order' : ...`) — meaning a property with `room_controller` off (the default) landed every guest straight on "Order Food" first, with no stay info anywhere prominent. Added an always-visible "Home" tab (first in the nav, not gated by any module) that's now the actual default landing tab — shows the existing `StayPanel` (guest name, room, dates) plus a new `HomeWelcome` component (clock, date, weather). The old Controls tab no longer duplicates `StayPanel` next to the relay/RGB/IR panel, since Home now owns that.
- **Theme token system + per-property accent + auto day/night (2026-09-04, "Option 1").** Every color in `room-display/` was a hardcoded literal (gold `#c9a227`, `bg-bg-dark`, `text-slate-*`, "Kintamani · Bali", …) — one shared deployment couldn't flex per property. Replaced ~127 literals across 17 files with semantic CSS variables (`--accent`, `--bg`, `--surface`, `--text`, `--text-muted`, …) resolved from one of two token sets in `src/index.css` — **dark** and **warm-paper light** — selected by `data-theme` on `<html>`. `src/theme.js`: `startThemeWatcher()` (called from `main.jsx`) auto-picks light 06:00–18:00 / dark otherwise, re-checked each minute; DebugMenu has an Auto/Light/Dark override (device-local `localStorage`, same exception as the stored room id/token); `applyAccent(brandColor)` (called from `App.jsx` when `state.property.brand_color` changes) sets `--accent`/`--accent-rgb`/`--accent-contrast`, the contrast colour luminance-derived so text-on-accent stays readable for any brand hue. `GET /display/room/:roomId/state`'s `property` object gained `location` (from `property_settings.property_address`) — the old "Kintamani · Bali" literal now comes from there, hidden when unset. Semantic Tailwind-v4 utilities (`.bg-app`, `.text-ink`, `.text-accent`, `.accent-tint`, …) live in an `@layer utilities` block; `glass-card` is now theme-aware. **No per-client code edits for branding** — it's all the `brand_color` field + the module flags. The Front Desk call button deliberately stays danger-red (not accent) — it's a call-for-help affordance. PWA splash (`vite.config.js` `theme_color`) stays dark (OS-level, can't be per-theme). A per-property theme override (`auto`/`light`/`dark`) and a real featured-event schedule field are noted for a later "Option 2" `display_config` pass.
- **Sidebar + layout rework (2026-09-04, same pass).** Sidebar nav is vertically centred in the rail (was top-aligned), active item is a raised accent-tinted card (inset ring + soft glow) rather than a hairline bar. Labels: Home→**Stay**, Order Food→**Dining**; explore tabs → **Activities / Venues / Resort**; Controls stays a nav item. New `TopBar` on `GuestScreen` (date + live wifi/wifi_off connection dot, fed by a new `online` prop threaded from `App.jsx`'s `error` state). New `EveningHighlight` floating card promotes the soonest bookable activity-linked Guest Board card (`cards.find(category==='activity' && activity_id)`), "Reserve" reuses the existing `handleBookActivity` flow — soft "this evening" label, no schedule-time data yet. `HomeWelcome` greets with property name + location.
- **`TopBar` weather merge + connectivity icon fix (2026-09-05).** `TopBar`'s date/wifi row and `ExploreTab`'s separate Today/Tomorrow weather strip read as two disconnected rows stacked under each other — merged the weather into `TopBar` itself (`ExploreTab`'s now-redundant `WeatherStrip` removed). The connectivity icon changed `wifi`/`wifi_off` → `cloud_done`/`cloud_off`: it actually reflects whether the last `GET /room/:roomId/state` poll succeeded (`App.jsx`'s `error` state), not the tablet's real WiFi radio — the wifi icon implied the wrong thing (a tablet could have WiFi but a dead backend and still show disconnected, or vice versa near a poll boundary). Sidebar footer's live clock (`Clock.jsx`, now deleted — it had no other callers) replaced with the build commit hash (`__APP_COMMIT__`, same stamp `DebugMenu.jsx` already showed) so the footer states which build is actually running, matching what `git status` on the dev machine can't tell you from across the room.
- **`StayPanel` unit card redesign + Quick Actions (2026-09-05).** The room/property "unit card" was a flat `bg-surface` rectangle with a dead-center ghost `home` icon at 10% opacity — reworked with an accent-tinted diagonal gradient, a soft corner glow + rotated `villa` watermark (positioned top-right, *not* bottom — the bottom is where the scrim gradient needed for text legibility is nearly opaque, so a first pass placing it there rendered invisible), a glowing pill badge, and centered/enlarged room-number + property-name (all per direct visual iteration).
  Below the stay-duration card there was a large dead empty space in the panel — filled it with a new `QuickActions.jsx`, and evened out the whole panel's spacing to one consistent gap (`gap-3`→`gap-5` after a "still feels tight" pass) with `overflow-y-auto` added as a safety net (the panel can now scroll rather than clip if a shorter physical screen can't fit every card).
  - **Call Front Desk** moved here from the sidebar (was a small icon-only button, now full-width and labeled) — sidebar footer, once vacated, is where the commit-hash change above landed.
  - **Do Not Disturb** / **Clean Room** — guest self-service housekeeping, both posting to a new `POST /api/display/room/:roomId/housekeeping` (`authDisplay` + a new `operationsEnabled` module gate mirroring `orderingEnabled`/`activitiesEnabled`/`roomControllerEnabled`/`callingEnabled` on `GET /room/:roomId/state`), which inserts a real `tasks` row (`type='guest_request'`) — the same table/kanban `routes/tasks.js`/`Operations.jsx` already use, no new table. Clean Room is one-shot (priority `medium`, staff mark it done whenever). DND is a toggle (priority `high`): the open task's id round-trips through `localStorage` scoped **per room** (`dndTaskId:{roomId}` — flat, unscoped key was the first pass and a real bug, see below) so the guest can cancel it later. **Turning DND off is always effective immediately in the UI regardless of the server response** — the first version awaited the cancel call and only cleared local state on success, so a stale/mismatched task id (e.g. from a debug-menu room change) 404'd and left the toggle permanently stuck "on" with no guest-facing recovery path. Root-caused and fixed live this session.
  - **DND is modeled as a room *state*, not a completable task** — deliberate, raised by the property owner mid-build. It still rides the `tasks` table for storage convenience (no schema change), but the Dashboard's guest-request banner (below) explicitly excludes it (`isDndTask()` title-prefix check in `Dashboard.jsx`) since there's nothing for staff to "mark done"; it only ever shows as passive status (Live Unit Status tile badge + popover pill, below) and clears itself the moment the guest toggles it off.
  - **Alarm** — fully client-side, zero backend involvement, deliberately labeled "Alarm" not "Wake-up Call" (the latter implies front desk is placing a call, which isn't what this is). Guest sets a time via `AlarmTimePicker.jsx` — large circular tap-up/tap-down steppers (56px targets) for hour/minute + AM/PM buttons in a modal, replacing the native `<input type="time">` dropdown whose scroll-wheel picker was too fiddly for a touchscreen kiosk. Rings once via a dedicated synthesized chime (`alarm.js` — deliberately independent module-level state from `ringtone.js`'s call-ring so an alarm and an incoming call can never share state and silence each other) through a full-screen `AlarmOverlay.jsx`, then auto-disables — one-shot like a real hotel wake-up-call request, not a recurring daily alarm. State (`alarmTime`/`alarmEnabled`/`alarmRinging`) lives in `App.jsx` alongside `callState`, same pattern, so it fires regardless of which Stay-panel tab is active and survives a reload via `localStorage` (`alarmTime`/`alarmEnabled` — device-local, same exception as `roomId`/`displayToken`).
- **Dashboard: live guest-request visibility (2026-09-05).** Two additions to `client/src/pages/Dashboard.jsx`, prompted by realizing `Operations.jsx` has no polling/SSE at all (loads tasks once on mount) — a guest's DND/Clean Room tap could otherwise sit invisible until someone happened to reload that page:
  - A dedicated amber banner ("N guest requests need attention") above the existing holiday/arrivals banners, listing each open **Clean Room** task (DND excluded, see above) with an inline "Mark Done" (`PUT /api/tasks/:id`) — rides the Dashboard's existing 30s poll (`api.get('/api/tasks')`, already fetched for the "Today's Activity" card), no new endpoint.
  - **Live Unit Status** tiles gained a per-state icon (🛏/🔑/✓/🔧/🔒 — color was previously the *only* signal, an accessibility/legibility gap) plus a small corner badge (🔕 DND / 🧹 Clean) on any room with an open request; the click-through popover (`UnitCard`) shows the same as labeled pills. Both the banner and the tiles read the same `guestRequests` fetch, matched to units by `unit_id`.

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

### 3. Kitchen Display
**Only purpose:** Kitchen ticket board — New/Preparing/Ready columns, tap to advance a ticket. One kiosk per kitchen station, not per-unit.

- Originally shipped as a page inside the PMS client (`/kitchen`, staff-JWT-gated); extracted into its own standalone kiosk app (`kitchen-display/`) to match the Room Display / TV Display pattern — same `display_token` device-auth model instead of staff login, so a kitchen tablet doesn't need a staff account.
- `GET /api/kitchen/active` (ticket board data), `PATCH /api/kitchen/:id/status` (advance a ticket), `GET /api/kitchen/stream` (SSE push on `kitchen:{propertyId}`) — all `authDisplay`, all gated `moduleGuard('sales')` per-route. `authDisplay` reads the token from either the `Authorization` header or `?token=`, so the same middleware covers the SSE endpoint (EventSource can't set custom headers) without a separate query-token middleware.
- Setup screen accepts the same per-property `display_token` used by Room Display and TV Display (surfaced in `SettingsProperty.jsx`'s "Device Setup" card, owner-only, `GET /api/settings/display-token`).
- Stack: React/Vite PWA (`kitchen-display/`), dev port 5177, CORS origin via `KITCHEN_URL` env var. Deployed at `kitchen.zahill.kdai.cloud` per `nginx/kitchen.conf` — kept on the existing `zahill.kdai.cloud` domain for now rather than the planned `half.kdai.cloud` (see "What this is" above); the rename stays deferred until every app is confirmed working on the current domain.
- Removed from the PMS client as part of this extraction: `pages/KitchenDisplay.jsx`, `context/KitchenTicketsContext.jsx`, the `/kitchen` route, the `kitchen_display` menu key (`SettingsRoles.jsx`) and its nav links (`Sidebar.jsx`/`BottomNav`). Staff no longer need a menu permission for it — it's a separate device, not a PMS page.

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

- ~~**Product name:** currently "Zahill PMS" / "ZHP PMS" are placeholders. Shortlisted a real brand name: **Nestly** is the front-runner...~~ **Decided (2026-08-14): the product name is HALF.** See the domain/tenancy note under "What this is" above for the working domain (`half.kdai.cloud`) and architecture. Actual rename across code/docs/infra is still pending — see that note for what's not done yet.
- **WhatsApp messaging (Phase B item 5):** decided against Fonnte (unofficial WhatsApp Web gateway) due to real ban risk for a product resold to paying clients. Leaning toward **api.co.id** — an Indonesian Meta Tech Provider offering the official WhatsApp Cloud API at low cost with no per-message markup. Architecture direction: **one WhatsApp number/WABA per property** (not one shared platform-wide number), managed under the platform's own Meta Business Portfolio via the Tech Provider / Embedded Signup model — this keeps messages branded as the property (guests see "Zahill," not the platform name) while sparing each client the full manual Meta Business Verification (they can start immediately at the unverified 250-conversations/day tier). Not yet implemented — no `whatsapp` module, no migration, no route file exist yet. See chat history for the full reasoning if picking this up cold.

---

## Roadmap Status (summary — full detail in ROADMAP.md)

- ✅ Foundation complete (migrations 001–026): core PMS, operations, sales, loyalty, market insights, in-room media, Room Controller/IoT, multi-tenancy, module system, superadmin.
- ✅ Phase A (Guest Folio, Invoice/Receipt PDF, Tax & Service Charge config) — implemented, migrations 028–029.
- ✅ Phase B item 4 (Automated Email) — implemented, migrations 030–031.
- ⏳ Phase B item 5 (WhatsApp messaging) — not started; leaning toward api.co.id (official WhatsApp Cloud API), see Open Decisions below.
- ✅ Superadmin Property Branding (logo, brand color, contact info) — implemented, migration 032.
- ✅ Phase D item 9 (Group Bookings) — implemented, migration 033.
- ✅ Phase D item 10 (F&B / Full POS) — implemented across four slices: Kitchen Display System + guest self-ordering (migration 034), then table management + stock tracking (migrations 035–036). Kitchen Display later extracted from the PMS client into its own standalone kiosk app (`kitchen-display/`), same `display_token` model as Room/TV Display.
- ✅ Phase D item 11 (Concierge / Activities) — implemented, migration 037. New `activities` module (default on).
- ✅ Guest Board ↔ Activities linking — implemented, migration 038. Not yet manually verified in a browser.
- ✅ Room Display "Your Orders" status tab — implemented, no migration (reads existing tables). Not yet manually verified in a browser.
- ✅ Two-way room-to-desk calling — implemented, migration 039. Staff can now call a room, not just answer one. **Verified live in production 2026-08-20** on a real tablet — caught and fixed a real bug along the way (occupied-room `CallOverlay` was missing its `onAnswer` wiring, see `ROADMAP.md`).
- ✅ Room ID decoupled from `room_controller`; calling split into its own `calling` module — migration 040. Fixes real production friction: hardware-less clients previously couldn't set a Room ID or use calling at all. Core flow confirmed working live 2026-08-20.
- ✅ Phase D item 13 (Agent Accounts / Direct Billing — company, travel agent, wholesaler) — **Slices A + B + C shipped** (migrations 041–043). Slice A: `booking_sources` doubles as the per-property agent registry. Slice B: `bookings.folio_status` + `agent_commissions`; checkout takes `bill_to_agent`, `server/services/agentBillingService.js` `settleCheckout()` marks the folio `pending_agent_invoice` and posts commissions; non-blocking credit-limit warning. Slice C: `agent_invoices`/`agent_payments`/`agent_payment_allocations`, `server/services/agentStatementService.js` + `server/routes/agents.js` + `client/src/pages/Agents.jsx` (`/agents` AR-aging list → `/agents/:sourceId` statement with Record Payment auto-allocated oldest-first + editable, and Generate Invoice → consolidated pdfkit PDF via `server/services/agentInvoicePdf.js`). Client decisions locked: credit limit = warn only, Faktur Pajak = deferred, allocation = auto oldest-first + manual adjust. Full spec in `ROADMAP.md`. Not yet manually verified in a browser (service + HTTP layers tested).
- 🔵 Phase D item 14 (Back Office — Purchasing, Inventory Cost Control, Accounts Payable, Cash & Bank, Recipe Costing) — scoped 2026-08-17 against both guestpro.id and the client's own prior system VHP (sindata.net), which independently converge on the same component set. Not started. Planned as a new `back_office` module, default **off** (paid-tier add-on, per the owner's modular-pricing goal) — not yet added to the live module table above since it doesn't exist in code. Full spec in `ROADMAP.md`; explicitly excludes full General Ledger/journal/budgeting/asset-depreciation from v1.
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
