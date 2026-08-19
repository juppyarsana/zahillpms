# ZHP PMS — Development Roadmap

Last updated: 2026-08-11

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
- Status: ✅ Implemented — Kitchen Display System and guest self-ordering
  shipped first (see write-ups below); table management and stock tracking
  shipped in the same pass as the final slice (see write-up below)

### 11. Concierge / Activities
- Activity catalog, tour bookings, transport scheduling
- Upsell revenue tracking
- Can surface through In-Room Media tablet
- Status: ✅ Implemented (migration 037) — see write-up below

### 13. Agent Accounts / Direct Billing (Company, Travel Agent, Wholesaler)

> Scoped 2026-08-17 after a client conversation: their property takes many
> group bookings placed by a *company*, not an individual — the defining
> difference from Group Bookings (#9) isn't room count, it's **who pays
> and when**. Revised the same day after checking a reference PMS
> (guestpro.id, Indonesian market): instead of a standalone `companies`
> table, generalize the **existing** `booking_sources` table (migration
> 005/027 — already per-property, already the thing `NewBooking.jsx`'s
> Source dropdown picks from) into a full "Agent" concept, matching
> GuestPro's model. Company becomes one `source_type` among several
> (`walkin`/`direct`/`booking_engine`/`ota`/`travel_agent`/`company`/
> `wholesaler`), and the billing behavior is a separate `payment_status`
> field on the same row:
> 1. `normal` — guest pays the property directly (today's only behavior)
> 2. `city_ledger` — guest pays the agent, agent remits to the property, AR posts automatically
> 3. `city_ledger_payment` — same, but AR requires manual confirmation
> 4. `commission` — guest pays the property, property pays the agent a commission
> 5. `commission_and_city_ledger` — agent pays the property, then receives a commission back
>
> This reuses the exact UI/data flow staff already know (picking a Source
> on a booking) instead of adding a parallel "Bill to Company" selector,
> and it means travel-agent/OTA commission billing — a real need for a
> Bali villa/glamping property selling through agents — rides the same
> machinery for free instead of needing a second system later. Deliberately
> **not** copying GuestPro's full accounting suite (chart of accounts,
> journal entries, AR/AP account linkage) — Zahill has no general-ledger
> module and doesn't need one for this; AR balance is just a derived sum
> over folios, not a posted journal entry.

- Migration: next available at time of implementation (037 as of this
  writing — confirm against `server/db/migrations/`). Extends
  `booking_sources` in place — no new table for the agent record itself:
  - `source_type VARCHAR(20) DEFAULT 'direct'` (keep `is_ota` as-is for
    the existing literal checks in `checkin.js`'s `OTA_SOURCES` array —
    don't remove it, `source_type` is additive)
  - `payment_status VARCHAR(30) NOT NULL DEFAULT 'normal'` (the 5 values above)
  - `billing_address`, `tax_id` (NPWP), `contact_name`, `contact_email`,
    `contact_phone`, `credit_terms_days`, `credit_limit` — nullable,
    only relevant for `travel_agent`/`company`/`wholesaler` rows
  - `commission_type` (`percent`/`amount`), `commission_value`
  - No FK/schema change needed on `bookings` — `bookings.source` already
    stores the `booking_sources.id` it was assigned at creation
- New table `agent_commissions` (booking_id, source_id, property_id,
  amount, status `unpaid`/`paid`, created_at) — simple ledger, not a
  journal entry, computed at checkout/night-audit time from the source's
  `commission_type`/`commission_value` when `payment_status` is
  `commission` or `commission_and_city_ledger`
- Folio/checkout: when a booking's source has `payment_status` of
  `city_ledger` or `city_ledger_payment`, the settlement screen offers
  "Bill to [Source Name]" instead of requiring guest payment — closes the
  folio as `pending_agent_invoice` rather than needing a `payments` row
- Extend `server/routes/settings.js`'s existing booking-source CRUD
  (`POST`/`PATCH /api/settings/booking-sources/:id`) with the new fields,
  plus new endpoints (same file or a new `agents.js` if it grows large):
  - `GET /api/settings/booking-sources/:id/statement` — outstanding
    balance + aging (current/30/60/90) across that source's bookings' folios
  - `POST /api/settings/booking-sources/:id/invoice` — consolidated PDF
    invoice across selected bookings/date range (reuses the existing
    `pdfkit` invoice code, different source query), marks those folios `invoiced`
  - `POST /api/settings/booking-sources/:id/payments` — record a payment
    against the outstanding balance (may span multiple bookings — needs
    an allocation strategy, oldest-first vs. manual)
- `Settings.jsx` — Booking Sources management gains the new fields,
  conditionally shown once `source_type` is `travel_agent`/`company`/
  `wholesaler` (channels like `direct`/`walkin`/`ota` don't need them)
- New tab or page — statement/aging view + "generate invoice" per agent,
  `financial` module gated, owner-only (matches `reports`/`nightAudit` convention)
- Reports — Accounts Receivable Aging (outstanding city-ledger balance by
  agent, bucketed), extends the existing Reports page
- **Indonesia-specific, confirm with client before building:** do
  companies/agents need Faktur Pajak-formatted invoices (NPWP + VAT
  breakout) instead of the current simple guest receipt? May need a
  second invoice template.
- **Open questions for client:** default credit terms (NET 15/30?);
  hard-block bookings over `credit_limit` or just warn; negotiated/
  discounted rates per agent (out of scope for v1 — flag for a later
  pass); who allocates a payment across multiple outstanding bookings
- Status: 🔵 Planned — not started, scope only

### 14. Back Office (Purchasing, Inventory Cost Control, Accounts Payable, Cash & Bank, Recipe Costing)

> Scoped 2026-08-17, validated against two independent references —
> GuestPro (Indonesian-market PMS) and VHP (the client's own prior system,
> via sindata.net) — which converge on the same component set despite
> different grouping: Purchasing/PO, Inventory Cost Control, Accounts
> Payable, Cash & Bank, General Ledger, Fixed Assets, plus an F&B-specific
> Standard Recipe Management feature. Scoped to the operationally useful
> pieces, not a full general-ledger rebuild — see "Explicitly out of
> scope" below.
>
> **New module: `back_office`**, gated the standard way
> (`server/modules.js` → `moduleGuard('back_office')`, `property_modules`
> row per property — same mechanism as every existing module). **Default
> off** — per the owner's modular-pricing goal, this is a paid-tier add-on
> for properties with real purchasing/F&B-cost operations, not forced on
> every client the way `reservations`/`financial` are. Not added to the
> live `server/modules.js` table in `CLAUDE.md` yet since it doesn't exist
> in code — that table only documents what's actually registered; update
> it in the same commit that implements this.

- New tables (migration: next available at implementation time — confirm
  order against #13 if both land close together):
  - `suppliers` (property_id, name, contact info, payment_terms_days)
  - `purchase_orders` (property_id, supplier_id, status
    `draft`/`pending_approval`/`approved`/`received`/`cancelled`,
    requested_by, approved_by, created_at) + `purchase_order_items`
    (product_id or raw-material line, quantity, unit_cost) — VHP's
    "purchase request" approval step is modeled as an early status on
    this same table rather than a separate PR entity, simpler until
    proven insufficient
  - `expenses` (property_id, category, amount, paid_via → cash/bank
    account, description, receipt attachment, created_by, created_at)
  - `cash_bank_accounts` (property_id, name, type cash/bank, running
    balance) + `cash_bank_transactions` (account_id, amount, direction,
    reference — expense / PO payment / manual adjustment)
  - `ap_bills` (property_id, supplier_id, purchase_order_id nullable,
    amount, status unpaid/paid, due_date) — simple derived-balance
    accounts payable, same lightweight pattern as the AR side of #13, not
    a full journal ledger
  - `recipes` (product_id → the sellable POS item) + `recipe_ingredients`
    (recipe_id, ingredient_product_id or raw-material row,
    quantity_per_unit) — Standard Recipe Management; `salesService
    .createSale` decrements ingredient stock via `stock_movements`
    instead of/alongside the finished product's own stock when a recipe
    exists for that product
- Extends existing `stock_movements` (migration 036) with a nullable
  `purchase_order_id` so PO receiving posts real stock-movement rows
  instead of only the current manual restock/adjustment/waste types
- New route files: `server/routes/purchasing.js` (suppliers, PO,
  receiving), `server/routes/expenses.js` (expenses, cash & bank
  accounts, AP bills), `server/routes/recipes.js` (recipe CRUD — this one
  needs **both** `sales` and `back_office` modules enabled, since it
  links a POS product to inventory cost — same two-module pattern
  `/checkin` already uses for `reservations`+`front_desk`)
- Frontend: new top-level "Back Office" nav section (one item, matching
  how VHP brands it as a single module rather than GuestPro's two-way
  split) with Purchasing / Expenses / Cash & Bank / Recipes tabs;
  owner-only, same access pattern as `financial`
- Reports: extend the existing Reports page with a Cost of Goods / F&B
  cost report once recipes exist — ties sales revenue to ingredient cost
  (VHP's "automatic F&B cost reconciliation")
- **Explicitly out of scope for v1** (real bookkeeping-software
  territory — recommend a separate accounting tool/bookkeeper for these
  until a client specifically asks): full General Ledger with journal
  entries and chart of accounts, monthly closing, budgeting, Fixed Assets
  depreciation schedules
- Status: 🔵 Planned — not started, scope only

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

## 🟡 Kitchen Display System (Phase D #10, first slice)

> First slice of F&B/Full POS. Originally shipped as a page inside the PMS
> client (`/kitchen`, described below) — later extracted into its own
> standalone kiosk app, see "Kitchen Display Extracted to Standalone Kiosk
> App" further down for the current architecture.
>
> "Table" kept deliberately loose (a free-text
> label on an order, not a seating/reservation system) so a fuller table
> management feature can be layered on later without reworking this.

- Migration 034: `sales` gained `order_type` (`dine_in`/`room_service`/
  `takeaway`), `table_number` (free text), and `kitchen_status`
  (`new`→`preparing`→`ready`→`served`, `NULL` for orders with no
  `food`/`drinks` items — nothing to cook). No new tables — pure extension
  of the existing `sales`/`sale_items` schema, gated under the existing
  `sales` module (no new module row).
- `POST /api/sales` now auto-detects whether an order needs the kitchen
  from its items' product categories and sets `kitchen_status='new'`
  accordingly, pushing a live update.
- New `server/routes/kitchen.js` (mounted without a blanket `auth`, mixing
  regular staff auth with `authQueryToken` for its SSE stream — same
  pattern as `calls.js`, and independent of it: KDS does **not** reuse
  `calls.js`'s channel/stream since that's gated behind `room_controller`,
  which Zahill doesn't have enabled): `GET /active` (ticket board data),
  `PATCH /:id/status` (advance a ticket), `GET /stream` (SSE push on
  `kitchen:{propertyId}`, reusing `server/sse/index.js`'s existing
  "refresh now" ping mode — clients just refetch `/active` on any message,
  no payload duplication).
- Frontend: `KitchenTicketsContext.jsx` (modeled on `CallContext.jsx`'s
  `EventSource` pattern) + `KitchenDisplay.jsx` page at `/kitchen`
  (New/Preparing/Ready columns, tap to advance). New `kitchen_display` menu
  key (Settings → Roles) gates it per staff role, same opt-in convention as
  `sales` itself. `Sales.jsx` POS gained an Order Type selector (+ table
  number for dine-in) feeding the new columns.
- Fixed a pre-existing bug found while verifying this: the POS "Order
  recorded!" success toast never actually rendered — clearing the cart on
  submit flipped the card to its "Cart is empty" branch before the
  `orderDone` toast branch was ever reached. Affected all Sales orders, not
  just kitchen ones.
- Verified end-to-end with a live dev server + browser: order creation
  correctly sets/omits `kitchen_status` based on item category, SSE pushes
  a new ticket to an already-open Kitchen Display tab with no manual
  reload, and a ticket advances New → Preparing → Ready → Served via real
  clicks against the running app.
- Status: ✅ Implemented (this slice). Table management and stock tracking
  remain open for a future pass.

---

## 🟡 Guest Self-Ordering from the Room Display

> Second slice of F&B/Full POS, building directly on the Kitchen Display
> System above. Lets a guest place a room-service order themselves from the
> in-room tablet instead of a staff member keying it in via the Sales POS.

- No new module: gated by the existing `sales` module (per-route
  `moduleGuard('sales')` inside `server/routes/display.js`, following the
  mixed-auth per-route pattern already established by `calls.js`/
  `kitchen.js` — the file's `app.use('/api/display', ...)` mount itself
  stays guard-free, matching its existing routes).
- Extracted the sale-creation transaction (validate products → compute
  total/kitchen-status → insert `sales`+`sale_items` → SSE-notify the
  kitchen) out of `routes/sales.js` and into `server/services/
  salesService.js` (`createSale`), now used by both the staff POS and the
  new guest endpoint — avoids duplicating that logic a second time.
- New `GET /api/display/room/:roomId/menu` (full product catalog —
  food/drinks/merchandise/tour, per owner decision) and `POST
  /api/display/room/:roomId/order` (`authDisplay`-only, no staff auth,
  resolves the room's current `checked_in` booking server-side the same
  way `GET /room/:roomId/state` already does). Orders are always
  `payment_method: 'room_charge'` / `order_type: 'room_service'`,
  `served_by: NULL`.
- **Security**: unlike the staff POS (which sends its own cached
  `unit_price` and is trusted since it's an authenticated staff member),
  the guest order endpoint looks up each product's price from the database
  itself and ignores any price the tablet might send — a guest device
  can't be trusted the same way.
- `GET /room/:roomId/state` gained an `orderingEnabled` flag (a
  `property_modules` check for `sales`) so the tablet knows whether to
  show the ordering tab at all.
- Frontend (`room-display/`): new "Order Food" tab in `GuestScreen.jsx`
  (only shown when `orderingEnabled`), new `OrderFoodTab.jsx` component
  (category-grouped menu + cart, styled to match the existing tablet
  theme). Per owner decision, it's a **simple confirmation** flow, not
  live order-status tracking — guest sees "Order placed!" and can order
  again; staff/kitchen track the rest via `/kitchen` as normal.
- Verified end-to-end with a live dev server + browser: menu loads and
  renders by category, placing a mixed order (a food item + a tour item)
  correctly charges the active booking's folio via `room_charge`, prices
  came from the server regardless of what the client sent, only the
  food/drink line item surfaced on the Kitchen Display (the tour item
  correctly did not), and the tab disappears entirely (and the endpoints
  403) when the `sales` module is disabled for the property.
- Status: ✅ Implemented

---

## ✅ Table Management & Stock Tracking (Phase D #10, final slice)

> Closes out F&B / Full POS. Table management turns the free-text
> `table_number` (added in migration 034) into real, occupancy-tracked
> entities; stock tracking reverses an earlier deliberate decision
> (`PLANNING.md`: "Zahill POS just records sales, no stock tracking") now
> that a client actually needs it. Both stay gated under the existing
> `sales` module — no new module row, consistent with how Kitchen Display
> was gated.

- Migration 035: `restaurant_tables` (property_id, name, capacity, status
  `available`/`occupied`) + nullable `sales.table_id` FK. `sales.table_number`
  is kept and now denormalized from the selected table's name at order
  time — existing rows and the Kitchen Display's read of `table_number`
  needed zero changes; `table_id` is the new source of truth for occupancy.
- Migration 036: `products` gained `track_stock` (bool, default off —
  existing products are unaffected), `stock_quantity`, `low_stock_threshold`.
  New `stock_movements` table is an audit ledger (house style — same shape
  as `folio_charges`) recording every change: `sale` (automatic),
  `restock`/`adjustment`/`waste` (manual, via the new stock-adjust endpoint).
- New `server/routes/tables.js`: `GET/POST/PUT/DELETE /api/tables`,
  `PATCH /api/tables/:id/status` (any staff can clear a table once bussed;
  create/edit/delete stay owner-only, matching `products.js`'s convention).
  Added to `modules.js`'s `sales` route list (mounted the same way as
  `products`/`sales`, not the mixed-auth per-route pattern `kitchen.js`
  needed) and to `server/index.js`.
- `salesService.createSale` (shared by the staff POS and guest
  self-ordering — see below) now, in the same transaction as before:
  row-locks (`FOR UPDATE`) every product in the cart, rejects the whole
  sale with `{ code: 'OUT_OF_STOCK', items: [...] }` if any tracked
  product's `stock_quantity` can't cover the requested quantity (**hard
  block**, no partial fulfillment — a race between two concurrent sales of
  the last unit is caught by the row lock, not just a pre-check), decrements
  stock and inserts a `stock_movements` row per tracked item on success,
  and — when a `table_id` is supplied for a dine-in order — resolves it to
  the table's current name and flips the table to `occupied`.
- `routes/products.js` gained `PATCH /:id/stock` (owner-only restock/
  adjustment/waste, also row-locked, rejects if it would take stock below
  0) and `GET /:id/stock/movements` (audit trail, last 50).
- `routes/display.js`'s guest menu endpoint
  (`GET /room/:roomId/menu`) now excludes any `track_stock` product at
  `stock_quantity <= 0` — a guest never sees an item they can't actually
  order. The guest order endpoint inherits the hard stock block for free
  since it goes through the same `salesService.createSale`.
- Frontend (`Sales.jsx`): new **Tables** tab (add/delete tables, see
  status, "Clear Table" to free one up after bussing). POS tab's table
  input is now a dropdown of real tables (occupied ones stay selectable —
  a table can have more than one round of orders — just labeled
  `(occupied)`) instead of free text; out-of-stock products are greyed out
  and disabled in the product grid; a 409 from the server surfaces the
  specific item(s) that ran out rather than a generic failure. Products tab
  gained an **Edit** action (there was previously no edit UI at all, only
  the `PUT` endpoint — also closes a pre-existing gap where `is_available`
  had no toggle anywhere in the UI) plus stock fields (track/quantity/low-
  stock threshold on add, an **Adjust Stock** modal for restock/waste/
  adjustment after) and a stock badge (in-stock count / low / out).
- `room-display/src/components/OrderFoodTab.jsx` (guest self-ordering)
  handles the same `OUT_OF_STOCK` response with a guest-appropriate message
  naming the item(s) and reloads the menu so it reflects current stock.
- Verified end-to-end against the dev database directly (bypassing HTTP
  auth, exercising `salesService.createSale` the same way both routes do):
  a dine-in sale against a real table denormalizes the table name onto
  `table_number`, sets `table_id`, and flips the table to `occupied`; a
  tracked product's stock decrements by the sold quantity and logs a
  `stock_movements` row with `reason='sale'`; an over-quantity sale against
  the now-reduced stock is rejected with `OUT_OF_STOCK` and rolls back
  cleanly (stock unchanged, no sale/stock_movements row created). Both the
  `client` and `room-display` apps build clean with no errors.
- Status: ✅ Implemented

---

## ✅ Kitchen Display Extracted to Standalone Kiosk App

> The Kitchen Display System (above) originally shipped as a page inside the
> PMS client (`/kitchen`, staff-JWT-gated, requiring a `kitchen_display`
> staff-role permission). A kitchen station doesn't need — and shouldn't
> need — a staff login just to see the ticket board, and a shared client
> device sitting in the kitchen logged in as a staff member is a weaker
> security posture than the device-token model already used by Room Display
> and TV Display. Extracted it to match that pattern, same rationale as the
> `half.kdai.cloud` module-subdomain scheme (see `CLAUDE.md`).

- New `kitchen-display/` app: React/Vite PWA, same shape as `room-display/`/
  `tv-display/` (setup screen storing the per-property `display_token` in
  localStorage, debug-tap reset, `vite-plugin-pwa` manifest, dev port 5177).
  `SetupScreen.jsx` accepts the same token already used by Room Display / TV
  Display; `TicketBoard.jsx` is the New/Preparing/Ready ticket board (ported
  from the old `KitchenDisplay.jsx`) with a live SSE subscription.
- `server/routes/kitchen.js`: swapped its previous mixed-auth pattern (staff
  `auth` on `/active`/`/status`, `authQueryToken` on `/stream`, matching
  `calls.js`) for `authDisplay` (per-property `display_token`) on all three
  routes — the same middleware `routes/display.js` uses. `authDisplay`
  already reads the token from either the `Authorization` header or
  `?token=`, so it covers the SSE endpoint for free without a separate
  query-token middleware. `moduleGuard('sales')` still applied per-route.
- `server/index.js` gained a `KITCHEN_URL` CORS origin (default
  `http://localhost:5177`), same pattern as `CLIENT_URL`/`DISPLAY_URL`/
  `TV_URL`.
- `server/.env.example`: added `KITCHEN_URL`; reworded the old
  `DISPLAY_TOKEN` placeholder line to clarify it isn't an env var at all —
  it's per-property (`properties.display_token`, migration 021), retrieved
  via the owner-only `GET /api/settings/display-token` (now surfaced in a
  new "Device Setup" card on `SettingsProperty.jsx`, shared by Room/TV/
  Kitchen Display setup).
- Removed from the PMS client: `pages/KitchenDisplay.jsx`,
  `context/KitchenTicketsContext.jsx`, the `/kitchen` route, the
  `kitchen_display` menu key (`SettingsRoles.jsx`), and its nav links
  (`Sidebar.jsx` desktop nav, `BottomNav` mobile nav in `App.jsx`).
- New `nginx/kitchen.conf`: serves `kitchen-display/dist` at
  `kitchen.half.kdai.cloud`, proxies `/api/` to the backend — same shape as
  `nginx/display.conf`/`nginx/tv-display.conf`. Not yet deployed (domain is
  decided, not live yet — see `CLAUDE.md`'s "What this is" section).
- Both `client` and `kitchen-display` verified to build clean with no
  errors after the extraction.
- Status: ✅ Implemented

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
| activities       | ✅                 | —             |

---

## Next migration number: 041

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

---

## ✅ Concierge / Activities (Phase D #11)

> A schedulable, capacity-limited, staff-confirmed booking concept for
> tours/transport/wellness — deliberately kept separate from two
> pre-existing, unrelated concepts: `products.category='tour'` (a flat
> instant-purchase POS item, unchanged) and `guest_board_cards.category
> ='activity'` (static "things to do" info cards on the Guest Board CMS,
> unchanged). Reused the guest self-ordering feature (F&B) as the closest
> existing template — same shape: staff-managed catalog → guest browses on
> the in-room tablet → server-priced order → revenue needs to land on the
> guest's bill.

- Migration 037: new `activities` (catalog: name, category
  `tour`/`transport`/`wellness`/`other`, price, duration, capacity per
  slot) and `activity_bookings` (schedule, participants, status
  `requested`→`confirmed`→`completed`/`cancelled`/`no_show`,
  `booked_via` `staff`/`guest_self`, nullable `booking_id` for walk-up/
  day-visitor bookings with no room stay) tables. New `activities` module
  (default **on** — a mainline feature, not a pricing-tier add-on like
  Back Office). Seeded enabled for every existing property in the same
  migration, not just new ones.
- **Guest self-bookings always start at `status='requested'`, never
  auto-confirmed** — capacity/guide/vehicle conflicts can't be verified
  from a tablet the way a drink order can. Staff desk bookings (from the
  new Activities page) skip straight to `confirmed`.
- **Fixes the room-charge → folio gap, for this feature only.** F&B
  room-charge sales (`salesService.createSale`) never post to
  `folio_charges` — a pre-existing gap, left as-is there. But since
  revenue tracking is an explicit goal here, `server/services/
  activityBookingService.js` posts a real `folio_charges` row
  (`type='activity'`, already a valid value from migration 028 — no folio
  migration needed) when a booking is confirmed with
  `payment_method='room_charge'`, and voids it if later
  cancelled/no-showed.
- Transport kept as a `category`, not a separate subsystem — a free-text
  `pickup_location` on the booking row is enough for v1, same "kept
  deliberately loose" call already made for restaurant tables.
- New `server/routes/activities.js`: catalog CRUD (owner-only write,
  any-staff read, same convention as `products.js`; no delete — toggle
  `is_available` instead), `GET /bookings` (date/status/booking_id
  filters), `GET /bookings/summary` (revenue by status, owner-only),
  `POST /bookings` (staff desk booking, auto-confirmed), `PATCH
  /bookings/:id/status`.
- `server/routes/display.js` gained `GET /room/:roomId/activities` and
  `POST /room/:roomId/activities/book` (both `authDisplay` +
  `moduleGuard('activities')`, mirroring the existing menu/order pair
  exactly — price always resolved server-side, never trusted from the
  tablet). `GET /room/:roomId/state` gained an `activitiesEnabled` flag.
- Frontend: new `client/src/pages/Activities.jsx` (`/activities`) with
  Catalog and Bookings tabs (a revenue/pending-requests summary card for
  owners); `BookingDetail.jsx` gained a read-only "Activities" tab; Room
  Display gained a new "Activities" nav entry + `BookActivityTab.jsx`
  (confirmation copy reads "Request sent — the front desk will confirm
  shortly," not "Order placed!," since it isn't guaranteed yet).
- No dedicated Reports page built (none existed to slot into —
  `client/src/pages/Reports.jsx` doesn't exist; `server/routes/
  reports.js`'s `/revenue` endpoint remains orphaned/unused by any
  client, a pre-existing gap bigger than this feature). The Bookings tab's
  summary card satisfies "upsell revenue tracking" instead.
- Full module wiring completed per CLAUDE.md's documented "two places
  must agree" bug class: `server/modules.js`, `server/index.js` mount,
  `App.jsx` route (`RequireMenu`+`RequireModule`), `Sidebar.jsx`,
  `App.jsx`'s `BottomNav()` `moreItems`, `PropertyDetail.jsx`'s
  `MODULE_LABELS`, `AuthContext.jsx`'s `ORDERED_PATHS`, and
  `SettingsRoles.jsx`'s `MENU_DEFS` (assignable menu key for
  non-owner staff roles).
- Verified: migration applied cleanly against the dev database (tables
  created, `activities` module row seeded `true` for both Zahill and
  Birdnest); `client` and `room-display` both build clean; backend module
  tree (including the new route/service files) loads without error.
  **Not yet verified live in a browser** — the running dev backend
  (plain `node index.js`, no hot reload) needs a manual restart to pick
  up the new routes; owner will do that and confirm.
- Status: ✅ Implemented
- Status: ✅ Implemented

---

## ✅ Guest Board ↔ Activities linking

> Concierge/Activities (above) and Guest Board (`guest_board_cards`,
> category `activity`) shipped as two disconnected concepts — staff had to
> enter the same tour twice (once as a promotional card, once as a
> bookable catalog item) with no link between them, risking price/
> description drift. Worse, this also meant **guests saw two separate,
> both-labeled-"Activities" menus** on Room Display — the Explore
> promotional carousel, and a standalone catalog-browsing booking tab.
> Caught during local testing after the first pass of this feature
> shipped. Revised design, agreed with the owner: Guest Board becomes the
> **single** guest-facing entry point for activities; the standalone
> booking-catalog nav tab is removed entirely.

- Migration 038: nullable `guest_board_cards.activity_id UUID REFERENCES
  activities(id) ON DELETE SET NULL` + index.
- `activities` stays the sole owner of commerce fields (price/duration/
  capacity) — single-writer principle. `server/services/
  activitiesService.js` holds the one `createActivity()`/
  `setAvailability()` write path, shared by `routes/activities.js`'s own
  `POST /` and the Guest Board paid-card path below (no duplicated
  INSERT).
- Guest Board card gets a Free/Paid toggle (`SettingsBoardCards.jsx`,
  gated on `hasModule('activities')`). Toggling Paid on a not-yet-linked
  card offers two paths:
  - **Create new** — one field, price — calls `activitiesService
    .createActivity()` (name/description from the card's title/body,
    category defaults to `'tour'`), storing the new activity's id back
    onto `activity_id`.
  - **Link an existing activity** — a dropdown of catalog activities not
    already linked to another card (`GET /api/activities`, filtered
    client-side against every card's `activity_id`). Added specifically
    for activities that already existed in the Catalog (created directly
    via `/activities`, e.g. pre-dating this feature) with no card of
    their own yet — without this, exposing them to guests would have
    meant re-creating a duplicate.
  - `server/routes/board.js`'s new `linkOrCreateActivity()` helper
    handles both, rejecting a `link_activity_id` already claimed by
    another card (409 `That activity is already linked to another
    card`).
  - Once linked (either path), price shows **read-only** with a "Manage
    full details →" link into `/activities` — no further commerce-field
    editing from Guest Board, ever.
- Unlinking (Paid → Free on an already-linked card) never deletes the
  `activities` row (an `ON DELETE RESTRICT` FK from `activity_bookings`
  would block it anyway once there's booking history) — instead sets
  `activities.is_available = false` and clears `activity_id`. Deleting a
  linked card does the same deactivation before removing the card.
- `server/routes/board.js`'s `GET /` and `routes/display.js`'s `GET /room/
  :roomId/state` cards query both gained a `LEFT JOIN activities`; the
  display endpoint only exposes `activity_id`/`activity_price` when the
  linked activity is still `is_available = true`, so a deactivated link
  silently stops showing a booking CTA without needing to touch the card.
- **Room Display nav collapse** (the fix for the two-menus problem):
  removed the standalone "Book Activities" sidebar nav entry and
  `BookActivityTab.jsx`'s catalog-grid browsing mode entirely. It's now
  reached only by tapping "Book Now" on a linked+available Guest Board
  card (`ExploreTab.jsx`'s card slideshow shows price + the CTA), which
  sets `GuestScreen.jsx`'s new `preselectedActivityId` state — that
  renders `BookActivityTab` as a focused single-activity booking panel
  (name/description/price + date/time/participants form for just that
  one activity, with a "Back" button), overlaid on top of whatever tab
  was showing underneath, regardless of `activeTab`. Deliberate
  consequence: an activity with **no** linked Guest Board card is no
  longer reachable by guests on Room Display at all — staff must link or
  create a card to expose it. Staff still manage the full raw catalog via
  `/activities` → Catalog tab as before; that page is unaffected.
- Status: ✅ Implemented — not yet manually verified in a browser (owner
  to confirm end-to-end: create a paid card via each path — new and
  linked — book it from Room Display, unlink it, delete a linked card).

---

## ✅ Room Display "Your Orders" status tab

> Both guest self-ordering (F&B) and guest activity booking end with a
> 4–5 second confirmation toast and then nothing — no way for a guest to
> check status afterward (is my order preparing? did the front desk
> confirm my tour?) short of calling the front desk. Raised right after
> the Guest Board ↔ Activities linking pass above, since that pass had
> just made booking a lot easier to reach — but checking on it afterward
> was still a dead end.

- New `GET /api/display/room/:roomId/orders` (`authDisplay`, no module
  guard — it's read-only, scoped to the guest's own current-stay
  `booking_id`, so there's nothing to gate). Returns `sales`/`sale_items`
  where `order_type='room_service'` (with `kitchen_status`) and
  `activity_bookings` (with `status`) for that booking, in one call.
- `GuestScreen.jsx` polls it every 15s, and also refetches immediately
  after a successful order or booking via new `onOrderPlaced` (
  `OrderFoodTab.jsx`) / `onBooked` (`BookActivityTab.jsx`) callback props,
  so the nav entry doesn't wait up to 15s to appear right after a guest
  orders something.
- New "Your Orders" sidebar nav entry (`YourOrdersTab.jsx`) — appears
  only once there's at least one order/booking for the stay, same
  conditional-visibility convention already used for the Explore tabs
  (only shown when there are cards) and Order Food (only shown when
  `sales` is on). Shows food orders and activity bookings together in one
  list, each with a status badge (New/Preparing/Ready/Served for food;
  Requested/Confirmed/Completed/Cancelled/No-show for activities).
- Small pulsing dot on the nav icon while anything is still "in flight"
  (a food order not yet `served`, an activity not yet past
  `requested`/`confirmed`) — new `zahill-pulse` keyframe in `index.css`,
  reused via a `badge` prop on the existing `NavBtn` component.
- Deliberately **not** built as a floating icon — considered and rejected
  in favor of staying consistent with the sidebar-nav + conditional-
  visibility pattern already established by Explore tabs and Order Food,
  rather than introducing a new floating-UI positioning concern across
  every screen.
- Status: ✅ Implemented — not yet manually verified in a browser.

---

## ✅ Two-way room-to-desk calling

> `calls`/`routes/calls.js` already had a full WebRTC voice-call system
> (offer/answer/ICE relayed over SSE, ring timeout, mute) — but only
> room -> staff (guest taps "Call Front Desk"). Staff had no way to call
> a room back. Undocumented in CLAUDE.md until this pass even for the
> original direction — added a proper write-up alongside the extension.

- Migration 039: `calls.direction` (`room_to_staff` default /
  `staff_to_room`) and `calls.initiated_by` (nullable FK to `users`, set
  for staff-placed calls).
- The signaling relay endpoints (`POST /:id/signal` staff->room,
  `POST /:id/signal-from-room` room->staff) were already direction-
  agnostic — they just forward whatever offer/answer/ICE payload to the
  other side's SSE channel. So the reverse direction only needed two new
  endpoints: `POST /api/calls/to-room` (staff places a call — validates
  the unit has a `controller_id`, inserts a `staff_to_room` row, 45s ring
  timeout same as before, notifies `room:{controllerId}`) and
  `POST /api/calls/:id/answer-from-room` (guest answers — marks
  `answered`, notifies the staff broadcast channel). `/end`,
  `/end-from-room`, `/signal`, `/signal-from-room`, and the missed-call
  timeout were all already generic enough to reuse verbatim. Added a
  defensive `direction` filter to the existing `/answer` (staff-answers)
  route so it can't accidentally answer a call meant for the room side.
- Both `room-display/src/callClient.js` and
  `client/src/services/callClient.js` were previously asymmetric (room's
  only knew how to offer, staff's only knew how to answer) — merged into
  one symmetric shape (`createOffer`/`createAnswer`/`handleAnswer`/
  `addIceCandidate`/`setMuted`/`close`) in both, since which side offers
  now depends on who placed the call. Kept as two near-identical files
  rather than a shared package — matches the existing convention of
  small per-app duplication already used for calls elsewhere in this
  codebase.
- Staff side: new "Call a Room" entry in `Sidebar.jsx` (shown whenever
  `room_controller` is on — not owner-gated, since answering an incoming
  call was never role-restricted either) opens `CallRoomModal.jsx`, a
  picker over `GET /api/iot/units` filtered to units with a controller
  assigned. Deliberately shows no online/offline badge — that endpoint's
  `connected` field is the ESP32 Room Controller's MQTT status, not the
  Room Display tablet's, and there's no tracked presence signal for the
  tablet app; an unreachable room's call just rings out and gets marked
  `missed` after 45s, same as an unanswered room->staff call already did.
  `CallContext.jsx` gained a `callRoom(unit)` action (creates the offer
  immediately, same as the room's own outgoing-call flow) and handling
  for the `answer` signal kind and `answered_from_room` event, neither of
  which the staff side ever needed to receive before. `CallBanner.jsx`
  now distinguishes `'calling'` (ringing out) from `'connecting'`/`'on
  call'` in its status text and switches its hang-up button to "Cancel"
  while still ringing.
- Room side: `App.jsx` gained an `'incoming'` `callState` status (new
  `incoming_call_from_staff` SSE event, guarded so a room already on/
  ringing a call ignores a second one) and a new `handleAnswerIncoming`
  handler — the room's first time ever creating a WebRTC *answer* rather
  than an offer. Declining reuses the existing `handleCancelCall`
  unchanged (already generic). `CallOverlay.jsx` gained a red ringing
  screen for `'incoming'` (Answer/Decline) and a `'connecting'` label for
  the gap between answering and ICE actually completing.
- Known limitation, mirrored deliberately from the pre-existing
  room->staff flow rather than solved differently: the offer/answer SDP
  is sent asynchronously right after the ring notification, so there's a
  small theoretical window where the callee could tap Answer before it
  arrives (silently no-ops if so). In practice a human needs a moment to
  notice and react, which is normally enough time — same accepted
  tradeoff the original implementation already made for room->staff.
- Status: ✅ Implemented and **verified live in production 2026-08-20**
  (real Room Display tablet + staff browser). Room -> staff direction
  worked as built. Staff -> room direction initially failed silently on
  Answer — found and fixed a real bug in the same session, see the
  dedicated section below ("Fix: staff-initiated call Answer button did
  nothing on an occupied room").
- **Follow-up, same day:** added a second entry point — `BookingDetail.jsx`
  now has a "Call Room" action too (calls `useCall()`'s `callRoom()`
  directly against `booking.unit_id`, no picker needed since the booking
  already names its room). Its page-header button row had grown to up to
  8 buttons once this was added on top of Amend Dates/Transfer Room/
  WhatsApp/Check In/Check Out/Confirm/Mark No-Show/Cancel, so it was the
  trigger for consolidating all of those (except the one status-driven
  primary CTA) into a new reusable "⋮" `ActionMenu.jsx` dropdown
  component — see `CLAUDE.md`'s "BookingDetail.jsx action menu" note.
- **Bug fix, caught in local testing:** the room's incoming-call screen
  was showing the individual staff member's name (`req.user.name`,
  whoever placed the call) — confusing/unprofessional on a guest-facing
  screen, and could even collide with the guest's own name coincidentally
  matching a staff member's. `CallOverlay.jsx`'s `'incoming'` state now
  always shows a fixed "Front Desk" label regardless of who called (the
  server still sends `staffName` in case it's useful later; the room app
  just no longer renders it). Went the other way on the staff side
  instead of removing information — `routes/calls.js`'s room-places-call
  handler (`POST /`) now looks up the unit's active booking's guest name
  and includes it in the `incoming_call` SSE payload, so `CallBanner.jsx`
  shows "Guest Name - Unit Name" instead of just "Room Unit Name" (falls
  back to unit-name-only for a vacant room calling, e.g. from
  `IdleScreen` — no guest to name). Threaded through `answerCall()` so
  the "On call" banner keeps showing it after answering, too.

---

## ✅ Decouple Room ID (controller_id) from the room_controller module

> Raised while onboarding a client without ESP32 relay hardware: they had
> no way to assign a Room ID at all, since the only UI/API for it
> (`SettingsRoomControllers.jsx` → `PUT /api/iot/units/:unitId/controller`)
> sits entirely behind `room_controller`, which correctly defaults off for
> hardware-less properties. But Room Display, TV Display, Kitchen Display,
> and calling all identify a physical device by `controller_id` regardless
> of whether there's any ESP32 attached — so a property with the module off
> couldn't configure *any* of its guest-facing displays. Separately caught:
> Room Display's relay/RGB/IR "Controls" tab showed unconditionally even
> after disabling `room_controller` for a property in Superadmin.

- `PUT /api/units/:id` (`server/routes/units.js`, always-on, no module
  guard) now also accepts `controller_id` — same validation/clear
  semantics as the gated `iot.js` endpoint (trim, max 10 chars, empty
  string clears it, unique-constraint violation → 409). `undefined` in the
  body leaves the column untouched, matching the existing COALESCE
  pattern for the other editable fields.
- New "Room ID" field on `/units` (`UnitSettings.jsx`) — editable from a
  page every owner can already reach, no module dependency. The gated
  `SettingsRoomControllers.jsx` page keeps its own controller-assignment
  UI too (writes the same column) — left in place since hardware-owning
  clients configuring relay labels still want it there; harmless overlap.
- `GET /room/:roomId/state` (`server/routes/display.js`) gained a
  `roomControllerEnabled` flag, same pattern as `orderingEnabled`/
  `activitiesEnabled`. Room Display's `GuestScreen.jsx`/`IdleScreen.jsx`
  now gate the Controls nav entry and content on it, and compute a
  sensible default initial tab (`controls` → `order` → first Explore
  category, whichever is actually visible) instead of hardcoding
  `'controls'` as the default regardless of whether it'll even show.
- Found and fixed the same duplicated 12-hour-clock formatting bug
  (raw `getHours()` shown next to an AM/PM suffix, e.g. "13:44 PM") a
  third time, in `IdleScreen.jsx`'s inline clock — missed in the earlier
  pass through `Clock.jsx`/`tv-display`'s `App.jsx` since this one was a
  separate un-shared copy of the same logic.
- Also fixed a dead end this surfaced during testing: Room Display's
  "Room not found" error screen (reached after a stale/wrong Room ID) had
  no interactive element at all, so the usual 5-tap-logo debug menu could
  never be reached from it — a tablet landing there was stuck with no way
  back to Setup short of manually clearing app storage. Logo is now
  tappable there too (`App.jsx`), same as every other screen.
- Status: ✅ Implemented — Room ID assignment via `/units` **confirmed
  working in production 2026-08-20** (it's what made the two-way calling
  test below possible at all). Controls-tab hiding and the stuck-error-
  screen tap fix specifically were not re-tested this session — still
  worth a manual check next time someone's on that tablet.

---

## ✅ Split `calling` out of the `room_controller` module

> Landed same day as the Room ID decoupling above, after actually hitting
> the next layer of the same problem in production: "Call Front Desk"
> 403'd with "Module not enabled for this property" because
> `routes/calls.js` was still entirely gated by `room_controller`, even
> though calling has zero ESP32/MQTT dependency — it only ever used
> `controller_id` as a room identifier. A hardware-less client could now
> set a Room ID (previous fix) but still couldn't get calling.

- Migration 040: seeds a new `calling` module, enabled `true`, for every
  existing property. New properties get it automatically via
  `seedPropertyDefaults.js`'s existing "enable everything except
  `room_controller`" default — no special-casing needed since `calling`
  isn't `room_controller`.
- `server/modules.js`: `room_controller`'s `routes` list is now just
  `['iot']` (relay/RGB/IR only); new `calling: { label: 'Calling', routes:
  ['calls'] }` entry.
- `routes/calls.js`'s `const gate = moduleGuard(...)` now points at
  `'calling'` instead of `'room_controller'` — the only line that actually
  changes call-gating behavior; everything else was rewiring the flag
  through UI.
- Rewired every `hasModule('room_controller')` check that was actually
  about calling specifically (not relay hardware) to `hasModule('calling')`:
  `Sidebar.jsx`'s "Call a Room" entry, `BookingDetail.jsx`'s "Call Room"
  action. Left `Sidebar.jsx`'s Room Controllers *settings link* and
  `App.jsx`'s `/settings/room-controllers` route alone — those are
  genuinely about the ESP32 config page, correctly still gated by
  `room_controller`.
- `GET /room/:roomId/state` gained a `callingEnabled` flag (same pattern
  as `roomControllerEnabled`); Room Display's `CallButton` (`GuestScreen
  .jsx`, `IdleScreen.jsx`) is now hidden when it's off, instead of showing
  a button that would 403 on tap.
- `PropertyDetail.jsx`'s `MODULE_LABELS` gained a `calling: 'Calling'`
  entry so Superadmin's module toggle list shows a real label instead of
  the raw key — the toggle list itself needed no other changes, it already
  renders whatever rows exist in `property_modules` for that property.
- Status: ✅ Implemented — core flow **confirmed working in production
  2026-08-20** ("Call Front Desk" no longer 403s; the full two-way call
  test below passed). Not specifically isolation-tested: disabling
  `room_controller` alone (confirm calling still works) and disabling
  `calling` alone (confirm Call buttons disappear everywhere, Room
  Controllers settings page still unaffected) — worth a quick check
  next time, low risk either way since the code path is simple.

---

## ✅ Fix: staff-initiated call Answer button did nothing on an occupied room

> Found via a live end-to-end test on a real tablet: staff called a room
> with an active guest booking, the tablet correctly showed the ringing
> "Incoming Call" screen, but tapping the green Answer button did
> nothing — no mic permission prompt, no screen change at all. Declining
> (red button) worked fine. Ruled out mic-permission and secure-context
> (HTTPS confirmed, permission re-granted and tested) before finding the
> real bug by re-reading the code.

- Root cause: `room-display/src/App.jsx` renders `<CallOverlay>` in two
  places — once under the vacant/`IdleScreen` branch, once under the
  occupied/`GuestScreen` branch. Only the `IdleScreen` one had
  `onAnswer={handleAnswerIncoming}` wired up; the `GuestScreen` one was
  missing it entirely, so `onClick={onAnswer}` on the Answer button was
  `onClick={undefined}` for any room with an active booking. Explains the
  exact symptom precisely — execution never reached `callClient
  .createAnswer()`'s `getUserMedia` call, hence no permission prompt.
- One-line fix, both `<CallOverlay>` instances now pass `onAnswer`.
- Status: ✅ Fixed and **verified working in production 2026-08-20**
  after redeploy — full two-way call cycle (staff calls occupied room,
  guest answers, both directions confirmed) now works end-to-end.
  Idle-room answering was not separately re-tested (it already had the
  prop and was presumably fine, but wasn't the room under test).
