# ZHP PMS — Development Roadmap

Last updated: 2026-08-09

---

## ✅ Foundation (Complete — migrations 001–026)

- Core PMS: Reservations, Front Desk, Rate Management, Guest CRM, Payments, Reports, Night Audit
- Operations kanban (housekeeping, maintenance, tasks)
- Sales / ancillary products
- Loyalty tiers
- Market Insights (competitor tracking, Google Trends, AI briefing via Claude)
- In-Room Media: Room Display tablet PWA, TV screensaver APK, Guest Board CMS
- Room Controller: ESP32 IoT, MQTT, relay/RGB/IR control, room-to-desk calls
- Multi-tenancy: property_id on all tables, all routes scoped (019–021)
- Module system: property_modules table, moduleGuard middleware, module-aware frontend nav (022)
- Superadmin: authSuperAdmin, /api/admin routes, seedPropertyDefaults, Superadmin UI (023–026)

---

## ✅ Phase A — Close Critical Gaps

> These are the biggest gaps vs. market-standard PMS (Cloudbeds, Mews, Little Hotelier).
> Build all three together — they share the same data model.

### 1. Guest Folio
Running charge ledger per booking. Post room charges, F&B, sales, and activities
to one place. Settle everything at checkout.

- New table: `folio_charges` (booking_id, type, description, amount, quantity, posted_by, posted_at)
- Migration: 028 (027 was already taken by `027_fix_namespaced_role_source_method_ids.sql`)
- New route file: `server/routes/folio.js`
- Endpoints:
  - `GET /api/folio/:bookingId` — full charge list + running total
  - `POST /api/folio/:bookingId/charge` — post a manual charge
  - `DELETE /api/folio/charge/:id` — void a charge (soft delete / is_voided flag)
- Wire sales charges and payment records into folio view
- Frontend: Folio tab on BookingDetail.jsx
- Status: ✅ Implemented

### 2. Invoice & Receipt PDF
Generate a PDF invoice per booking from folio charges. Required by every hotel client.

- Library: pdfkit (already in ecosystem) or puppeteer
- Endpoint: `GET /api/folio/:bookingId/invoice` — returns PDF
- Include: property name/logo, guest name, booking dates, itemized charges, tax, total, payment status
- Frontend: "Download Invoice" button on BookingDetail.jsx
- Status: ✅ Implemented (pdfkit; logo not yet included — text header only)

### 3. Tax & Service Charge Config
Per-property tax and service charge rates, applied on folio and invoice.

- Add to `property_settings`: `tax_rate NUMERIC(5,2)`, `service_charge_rate NUMERIC(5,2)`
- Migration: 029 (renumbered — see #1 above)
- Indonesian standard: 11% VAT + optional service charge (5–10%)
- Applied automatically when generating folio totals and invoice
- Config UI in Settings page
- Status: ✅ Implemented

---

## 🟡 Phase B — Guest Communication

> High value for every hotel client. Drives repeat bookings and OTA ranking.

### 4. Automated Email (Pre-arrival & Post-stay)
- Trigger emails on: booking confirmation, T-1 day pre-arrival, 1 day post-checkout
- nodemailer already installed
- New table: `email_templates` (property_id, trigger, subject, body_html)
- Migration: 030 (029 was already taken by tax config), plus 031 for per-property SMTP config
- New route: `server/routes/communications.js`
- Frontend: template editor in Settings
- Status: ✅ Implemented

### 5. WhatsApp Messaging
- Send WhatsApp at key booking moments
- Critical for Indonesian market — primary communication channel
- Provider: Fonnte (local ID, cheap) or Twilio WABA
- Two-way messaging support
- Per-property WABA credentials stored in property_settings

---

## 🔵 Phase D — Selected Modules (NEXT)

> Reprioritized ahead of Phase C (2026-08-09) — group bookings, F&B/POS, and
> concierge/activities matter more right now than distribution channels.
> Reviews & Feedback and Subscription Billing stay in Phase D but are
> deprioritized back to "build when requested" alongside Phase C.

### 9. Group Bookings
- Multiple rooms under one reservation
- Master folio, group check-in
- Needed for villa/event properties
- Status: ✅ Implemented (migration 033) — see write-up below

### 10. F&B / Full POS
- Table management, kitchen display system, stock tracking
- Existing sales module covers most small properties
- Only needed for properties with a restaurant
- Status: 🔵 Next

### 11. Concierge / Activities
- Activity catalog, tour bookings, transport scheduling
- Upsell revenue tracking
- Can surface through In-Room Media tablet
- Status: 🔵 Next

---

## ⚪ Phase C — Distribution & Direct Revenue (deprioritized — build after Phase D's selected modules)

> Grows bookings, reduces OTA commission dependency. Moved after Phase D
> (2026-08-09) — not urgent until the selected Phase D modules are done.

### 6. Direct Booking Engine
- Embeddable JS widget (one script tag) for client websites
- Public availability API (no auth required)
- Midtrans / Xendit inline checkout
- Auto-creates reservation in PMS on payment success
- Availability synced with Beds24 (when Phase C2 is live) to prevent doubles

### 7. Channel Manager (Beds24)
- Real-time availability push to Booking.com, Airbnb, Traveloka, Tiket.com, Agoda
- Webhook-driven (API V2), invite code auth per property (one-time setup)
- Rate push from Rate Management module
- Per-property Beds24 credentials stored in property_settings
- Migration: new `channel_sync_log` table

---

## ⚪ Phase D — Remaining (build when clients request)

### 8. Reviews & Feedback
- Post-stay survey auto-trigger (builds on Phase B email/WhatsApp)
- OTA review monitoring
- Reputation score dashboard

### 12. Subscription Billing (Stripe)
- Automate SaaS billing per property per plan
- Manual invoicing is fine until client count justifies the complexity

---

## Module Registry (for reference)

| Module           | Enabled by default | Optional for  |
|------------------|--------------------|---------------|
| reservations     | ✅                 | —             |
| front_desk       | ✅                 | —             |
| guest_crm        | ✅                 | —             |
| financial        | ✅                 | —             |
| operations       | ✅                 | —             |
| sales            | ✅                 | —             |
| in_room_media    | ✅                 | —             |
| room_controller  | ❌                 | Birdnest ✅, Zahill ❌ |
| insights         | ✅                 | —             |

---

## Next migration number: 034

---

## ✅ Superadmin Property Branding

> Superadmin could create/manage properties but every property looked
> identical (single shared logo + hardcoded name on login/nav). Onboarding a
> real second/third client needed per-property branding.

- Migration 032: `property_settings.logo_url`, `property_settings.brand_color`
- Superadmin Property Detail: new Branding card (logo upload, color, contact
  fields) — owner keeps their own edit access on the same fields, both write
  the same row
- Login screen resolves branding pre-auth via an optional property slug
  (`GET /api/public/properties/:slug/branding`, cosmetic only — doesn't
  change how `/api/auth/login` authenticates)
- Logo threaded through: client nav, invoice PDF, Room Display, TV Display,
  guest emails
- Status: ✅ Implemented

---

## ✅ Sidebar Navigation + Module-Aligned Route Guards

> The staff nav was a horizontal top bar with flyout dropdowns; disabled
> modules were hidden from the nav but their pages were still directly
> reachable by URL (403s from the API instead of a clean redirect).

- New `client/src/components/Sidebar.jsx` replaces `TopNav` on desktop
  (mobile `BottomNav` unchanged); `AdminLayout.jsx` (superadmin) intentionally
  kept its own top-bar pattern, out of scope
- Every module-gated route in `App.jsx` now wrapped in `RequireModule`
  (extended to accept an array of modules); added `RequireOwner` for the two
  routes that had no guard at all (`/settings/roles`, `/night-audit`)
- Follow-up while reviewing the new sidebar: `/settings` ("Sources & Methods")
  turned out to mix four unrelated concerns (property/tax details, SMTP +
  email templates, booking sources, payment methods). Split into
  `/settings/property`, `/settings/communications`, and a trimmed `/settings`
  that now actually matches its label — all three `RequireOwner`
- Checked the resulting grouping against Cloudbeds/Mews (both keep
  Settings/Configuration structurally separate from daily-use nav, not
  nested inline — Cloudbeds under a distinct "System" menu, Mews as its own
  admin-only top-level item). Moved the sidebar's Settings section out of
  the scrollable daily-use list into its own visually distinct block
  (divider + dark tint) pinned above the footer, rather than building a full
  separate settings hub page — proportionate to this app's ~9 settings items
  vs. Cloudbeds' enterprise scale
- Fixed a real flex-sizing CSS bug from that pass (outer `.sidebar` and the
  new settings block both had competing `overflow`/`max-height` rules,
  starving the daily-use nav of space). Also added collapsible/expandable
  groups (`SidebarSection` in `Sidebar.jsx`, state persisted per-section in
  `localStorage`) for Rates & Channels and three Settings sub-groups
  (General / Guest & Booking / Admin), collapsed by default so rarely-used
  config doesn't dominate the sidebar visually
- Status: ✅ Implemented

---

## ✅ Group Bookings (Phase D #9)

> First Phase D module built — chosen over F&B/POS and Concierge/Activities
> for the best effort-to-value ratio: it extends existing data/UI
> (bookings, folio, check-in) rather than introducing a new module or a
> new real-time UI paradigm.

- Migration 033: `reservation_groups` table (property_id, primary_guest_id,
  shared check_in/check_out dates, group-level discount/deposit,
  `active`/`cancelled` status) + nullable `bookings.reservation_group_id`
  FK (house style for optional cross-cutting relations — every existing
  booking stays `NULL`, zero migration risk). Also widened
  `email_templates.trigger` and dynamically seeded a `group_booking_confirmed`
  template for every existing property.
- A group = **one primary guest + one shared date range**, multiple
  units/rooms. Group-level discount/deposit are entered once and prorated
  server-side across child bookings proportional to each room's own price
  (last room absorbs the rounding remainder so both sums stay exact).
- **Single-room bookings are completely untouched** — `NewBooking.jsx`
  only calls the new group endpoint once a 2nd room is added
  (`POST /api/bookings/group`, rejects `rooms.length < 2` server-side).
  No "invisible group of 1" is ever created.
- New endpoints, all inside the existing gated route files (no new module
  needed — gating is per-file): `POST/GET/DELETE /api/bookings/group/:id`,
  `POST /api/checkin/group/:id/start`, `GET /api/folio/group/:id`.
- Group check-in is **best-effort/partial**: each room is attempted
  independently (`checkinOneBooking()` extracted as a shared helper from
  the original single-room route in `checkin.js`); a failing room (e.g.
  unpaid balance) is flagged in the response, not rolled back with the
  others. Group *creation*, by contrast, stays fully atomic.
- Master folio (`GET /api/folio/group/:id`) aggregates each room's own
  folio — `folio_charges.booking_id` stays `NOT NULL`, charges are still
  always posted per-room; the group view is a rollup only, no schema
  change to that table.
- Multi-room groups get one combined confirmation email
  (`sendGroupBookingEmail` in `mailer.js`, new `group_booking_confirmed`
  trigger editable in Settings → Communications) instead of N per-room
  emails.
- Frontend: `NewBooking.jsx` gained a repeatable "+ Add Another Room" line;
  new `GroupDetail.jsx` page at `/reservations/group/:groupId` (rooms list,
  payment rollup, "Check In Whole Group", "Cancel Group", Master Folio tab);
  `BookingDetail.jsx` shows a "Part of a group booking" banner linking to
  it; `CheckIn.jsx`/`QuickCheckIn.jsx` cluster same-group arrivals under one
  header with a "Check In Whole Group" action, reusing the existing
  single-room modal for anyone who wants to do one room at a time.
- Verified end-to-end: proration math (discount/deposit sums exact),
  best-effort partial check-in (one room blocked on unpaid deposit while
  its sibling succeeds), master folio rollup, and — critically — that the
  pre-existing single-booking create/view/checkin flow is byte-for-byte
  unaffected.
- Status: ✅ Implemented
