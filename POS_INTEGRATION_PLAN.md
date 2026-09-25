# External POS Integration (guest lookup + charge-to-room)

This plan has two halves: **Part 1** is the PMS-side API (`zahillpms`, this repo) already designed below. **Part 2** is the matching change on the POS side (`zahillpos` / "Separuh", a separate repo cloned to a sibling folder) — the actual "Charge to Room" button, room picker, and outbound sync that calls Part 1's endpoints.

---

> **Status 2026-09-25:** Part 1 built on `zahillpms` `dev`; Part 2 built on `zahillpos` branch
> `pms-integration` (not pushed). See the POS repo README's "Hotel PMS link" section for how the POS side works.

# Part 1 — PMS side (`zahillpms`) — ✅ built 2026-09-25

> Built as designed, with three changes: the migration is **070** (068/069 were taken); `sales.description` was added (POS sales have no `sale_items`, so the Sales list and folio need the POS's own text); `POST /transactions` accepts a typed `room` (name or Room ID) **or** a `booking_id`, and `balance_due` is the whole-stay estimate (`computeProforma`) rather than the posted ledger. `amount` is NET (before service/tax — the folio adds them). See `CLAUDE.md`'s POS Integration write-up.

## Context

The property already runs a separate, fully-featured POS product (its own recipes, inventory, kitchen/table operations). Rather than building that out inside the PMS's own `resto_ordering`/`back_office` modules, the owner wants to **replace** `resto-display`/`kitchen-display` at this property with the external POS, and connect it to the PMS for exactly two things:

1. The POS needs to know **who's in which room** (for a "charge to room" picker at checkout).
2. When a POS sale is charged to a room, the PMS needs to **post it to that guest's folio** — and, per the owner's confirmation, have it show up in the PMS's own Sales list / revenue Reports / Night Audit F&B totals, the same as any other room-charge sale today.

Everything else (menu, recipes, inventory, kitchen tickets, cash/card payment) stays entirely inside the POS and is untouched by this integration — the PMS only ever sees the *subset* of transactions that get charged to a room.

This is a new, narrow integration surface — not an extension of `resto_ordering` (that module assumes the PMS owns the menu/table/kitchen flow, which is no longer true here) and not a reuse of `salesService.createSale` (that function hard-requires every line item to reference a real row in the PMS `products` table with stock tracking — forcing the POS to mirror its whole menu into PMS `products` would recreate exactly the duplication the owner is trying to avoid). Instead this follows the precedent already set by `restoSettleService.settleAndClose`, which posts a `sales` + `folio_charges` pair *without* going through `createSale`'s item-validation path.

## Design

**New module: `pos_integration`** (default off, like `resto_ordering`/`back_office`) — added to `server/modules.js` (`{ label: 'POS Integration', routes: ['posIntegration'] }`), `server/db/seedPropertyDefaults.js`'s `DEFAULT_OFF` list, and backfilled for existing properties via the new migration (same `INSERT ... ON CONFLICT DO NOTHING` pattern as migration 061). Also add it to `client/src/pages/admin/PropertyDetail.jsx`'s `MODULE_LABELS`.

**New migration `070_pos_integration.sql`:**
- `properties.pos_api_key VARCHAR(64) UNIQUE` (nullable — unset until the owner generates one). Structurally mirrors `properties.display_token` (single credential per property), but unlike `display_token` this one gets a **regenerate** endpoint (new ground — `display_token` has none today), because this credential sits in third-party software the PMS doesn't control the deployment of and must be rotatable if it leaks.
- Widen the `sales.order_source` CHECK constraint (currently `IN ('pos','room_display','guest_qr','resto_staff')`, migration 048) to add `'external_pos'` — keeps it distinguishable from `'pos'` (the PMS's own internal staff POS).
- `sales.external_ref VARCHAR(100)` nullable + partial unique index `(property_id, external_ref) WHERE external_ref IS NOT NULL` — lets the POS pass its own transaction id so a network retry is safe (replay returns the original sale instead of double-charging the folio).
- Backfill `property_modules` for existing properties with `pos_integration = false`.

**New middleware `server/middleware/authPos.js`** — modeled directly on `authDisplay.js`: reads a Bearer token from the `Authorization` header (POS backends can set headers, so no `?token=` fallback is needed unlike the SSE-driven `authDisplay`), looks it up against `properties.pos_api_key`, sets `req.propertyId`. Plain-string compare, consistent with every other device credential in this codebase (`display_token`, `qr_token`).

**New service `server/services/posIntegrationService.js`:**
- `async function postTransaction(propertyId, { bookingId, amount, description, externalRef })`:
  - Idempotency check first: if `externalRef` is set and a `sales` row already has it for this property, return that existing sale/folio charge instead of inserting again.
  - Validates the booking belongs to `propertyId` and is `status = 'checked_in'` (same guard `restoSettleService` uses for room_charge).
  - Inserts one `sales` row directly (`payment_method='room_charge'`, `order_source='external_pos'`, `total_amount=amount`, `external_ref`) — **no `sale_items` rows**, since there's no real PMS `product_id` to attach (the POS's menu stays out of PMS `products` entirely).
  - Inserts one `folio_charges` row (`type='sale'`, linked via `sale_id`), same shape as `createSale`'s existing folio-posting block (`server/services/salesService.js:138-148`) and `restoSettleService`'s equivalent — description comes straight from the POS's `description` field rather than a joined product name.
  - Returns `{ sale, folio_charge }`.
- `async function lookupRoom(propertyId, roomId)` — resolves a unit by `controller_id` (Room ID) scoped to the property, joins the current `checked_in` booking + guest name (same join shape as `GET /api/resto/rooms` in `server/routes/resto.js:66-84`, but keyed by the human-readable Room ID instead of iterating every occupied room, since a POS till workflow types/scans a room number rather than picking from a list).
- `async function listInHouseRooms(propertyId)` — same query as `GET /api/resto/rooms`, for a POS that wants a full picker instead of a single lookup.

**New route file `server/routes/posIntegration.js`**, mounted with `authPos` + `moduleGuard('pos_integration')` (per-route, same convention as `resto.js`/`kitchen.js`, not at the `app.use` mount):
- `GET /api/pos/rooms` → `listInHouseRooms`
- `GET /api/pos/rooms/:roomId` → `lookupRoom` (404 if no in-house booking for that Room ID)
- `POST /api/pos/transactions` → body `{ room_id, amount, description, external_ref }`; resolves `room_id` → `booking_id` via `lookupRoom` internally, then calls `postTransaction`; returns `{ sale_id, folio_charge_id, balance_due }` — `balance_due` comes from `folioService.loadFolio(bookingId, propertyId)` (`server/services/folioService.js`) so the POS can show an up-to-date folio total on its own receipt without a second call.

**Settings UI — new "POS Integration" card in `client/src/pages/SettingsProperty.jsx`**, next to the existing "Device Setup" card (`display_token`), same visual shape (read-only monospace field + Copy button), plus a new **Regenerate** button (confirm dialog — regenerating immediately breaks the currently-configured POS until re-entered):
- `GET /api/settings/pos-api-key` (owner-only, mirrors `GET /api/settings/display-token` in `server/routes/settings.js`)
- `POST /api/settings/pos-api-key/regenerate` (owner-only) — `crypto.randomBytes(32).toString('hex')`, same generation approach `routes/resto.js`'s `POST /tables/:id/qr/reset` already uses for table QR tokens.

**Docs:** update `CLAUDE.md`'s migrations table (070), module table, and "Next migration number" line; add a short new subsection alongside the other display/kiosk write-ups describing this integration and the deliberate "no menu/inventory sync" boundary; update `ROADMAP.md` per the repo's own "Working Across Multiple Machines" convention, same commit as the code.

## Explicitly out of scope (flagged, not built)

- Any sync of menu items, recipes, or stock from the POS into PMS `products`/`raw_materials` — the whole point is the POS keeps owning those.
- Refund/void of a POS-charged-to-room transaction from either side — first pass is charge-only; note as a known gap in the docs write-up.
- Multiple POS terminals/keys per property — one `pos_api_key` per property, same cardinality as `display_token`. If the owner later needs per-terminal attribution, that's a follow-up (would move from a `properties` column to its own table).

## Files touched

- `server/db/migrations/070_pos_integration.sql` (new)
- `server/modules.js`, `server/db/seedPropertyDefaults.js`
- `server/middleware/authPos.js` (new)
- `server/services/posIntegrationService.js` (new)
- `server/routes/posIntegration.js` (new), mounted in `server/index.js`
- `server/routes/settings.js` (2 new owner-only endpoints)
- `client/src/pages/SettingsProperty.jsx` (new card)
- `client/src/pages/admin/PropertyDetail.jsx` (`MODULE_LABELS` entry)
- `CLAUDE.md`, `ROADMAP.md`

## Verification

1. Run the migration locally (`npm run migrate` in `server/`); confirm `properties.pos_api_key`/`sales.external_ref` exist and `property_modules` has `pos_integration=false` for every existing property.
2. Toggle `pos_integration` on for a test property via superadmin, generate a POS API key from `SettingsProperty.jsx`.
3. `curl` end-to-end against a real running server: `GET /api/pos/rooms` with the key → confirm it lists only `checked_in` bookings for that property; `GET /api/pos/rooms/:roomId` for one of them; `POST /api/pos/transactions` with a `room_id` + `amount` + `external_ref` → confirm 200 with `balance_due` reflecting the new charge.
4. Re-send the exact same `POST` with the same `external_ref` → confirm it returns the same `sale_id` rather than creating a second folio charge (idempotency).
5. Load that booking's Folio tab in the PMS client → confirm the new charge appears with the POS-supplied description, and the Sales page / `GET /api/reports/revenue` for that month include it in the ancillary/F&B total.
6. Confirm `moduleGuard` actually 403s `GET /api/pos/rooms` when `pos_integration` is off, and that a wrong/missing API key 401s.

---

# Part 2 — POS side (`zahillpos` / Separuh)

## Context

Separuh is an existing, working POS (Node/Express + Postgres server in `server/`, one large React/Vite client in `client/src/App.jsx`, PM2 + Nginx deploy, no CI/CD — `git pull` + `pm2 restart` per the README). It currently has no concept of a "room" or "booking" anywhere in its schema; payment methods are already data-driven (`settings.value` under key `'paymentMethods'`, edited via `PaymentMethodsSetup` in `App.jsx`), so "Charge to Room" slots in as a new payment method rather than a schema change to the method itself.

Confirmed with the owner: if the PMS is unreachable when a cashier charges to room, **the POS sale still completes locally immediately** (never blocks a cashier mid-shift) and syncs to the PMS folio in the background with retry — not a hard block on the transaction.

The POS's own backend (not the browser client) will hold the PMS API key (`PMS_API_KEY`), per the earlier confirmed security decision — the browser-side POS client never talks to the PMS directly.

## Design

**New payment method entry**: add `{ id: "room_charge", name: "Charge to Room", icon: "🏨", mdr: 0 }` to `DEF_PAYMENT_METHODS` (`client/src/App.jsx:42-46`) — no `accountId`, so `postSaleToAccount()` (`server/src/routes/transactions.js:41-65`) correctly no-ops for it (the money isn't received yet, it's added to the guest's folio until they check out).

**New migration `server/src/db/migrate_pms_room_charge.sql`** (same idempotent `ADD COLUMN IF NOT EXISTS` style as the existing `migrate_*.sql` files, auto-applied on server boot per the README):
- `transactions.pms_room_id TEXT` — the human Room ID the cashier picked.
- `transactions.pms_booking_id UUID` — resolved from the PMS at charge time (fresh lookup, not reused from an earlier picker fetch, in case occupancy changed).
- `transactions.pms_sale_id UUID`, `transactions.pms_synced BOOLEAN NOT NULL DEFAULT false`, `transactions.pms_synced_at TIMESTAMPTZ`, `transactions.pms_sync_error TEXT` — sync state, only meaningful when `method = 'Charge to Room'`.

**New env vars** (`server/.env.example`): `PMS_API_URL`, `PMS_API_KEY` — the property's `pos_api_key` from Part 1's Settings card.

**New server module `server/src/services/pmsClient.js`** — thin wrapper around native `fetch` (Node 18+, no new dependency — matches the PMS's own house style for outbound calls, e.g. its `telegramService.js`/`googlePlaces.js`), all calls authed with `Authorization: Bearer ${PMS_API_KEY}`:
- `listRooms()` → `GET {PMS_API_URL}/api/pos/rooms`
- `lookupRoom(roomId)` → `GET {PMS_API_URL}/api/pos/rooms/:roomId`
- `postTransaction({ roomId, amount, description, externalRef })` → `POST {PMS_API_URL}/api/pos/transactions`, using the Separuh `transactions.id` (already a client-generated UUID, per `POST /api/transactions` in `transactions.js:170-224`) directly as `external_ref` — no new id needed, and it makes retries naturally idempotent on the PMS side.

**New route `GET /api/pms/rooms`** (proxy, `server/src/routes/` — new file or added to `transactions.js`), `auth`-gated same as everything else, calls `pmsClient.listRooms()` server-side so the browser never sees `PMS_API_KEY`. This is what the client's room picker calls.

**`transactions.js` changes** (`server/src/routes/transactions.js`):
- `POST /` and `PATCH /:id/pay`: when `method === 'Charge to Room'`, require `pmsRoomId` in the body; call `pmsClient.lookupRoom(pmsRoomId)` to resolve a fresh `booking_id`, store it, then attempt `pmsClient.postTransaction(...)` **inline, synchronously, but non-blocking on failure** — on success, store `pms_sale_id`/`pms_synced=true`/`pms_synced_at`; on failure (network error, PMS down), store `pms_sync_error` and leave `pms_synced=false`, but still return `201`/success to the cashier exactly as today (per the confirmed "let it through, sync later" decision).
- New internal `syncRoomCharge(transactionId)` function, reused by both the inline attempt above and the retry sweep below.

**Retry sweep** — an in-process `setInterval` (e.g. every 60s) started once in `server/src/index.js`, not a new crontab entry: queries `transactions WHERE method='Charge to Room' AND pms_synced=false AND status='paid'`, calls `syncRoomCharge()` for each. In-process (not a standalone script like `daily-report.js`) because it needs sub-minute-friendly, frequent retries rather than a once-a-day cadence — a good fit for the long-running PM2-managed process rather than a cron-spawned one.

**Client UI (`client/src/App.jsx`, `POSPage`)**: today, tapping any non-Cash payment button calls `processPayment(name)` immediately (`App.jsx:1984`). For `"Charge to Room"` specifically, that tap instead opens a new small room-picker modal (search/list in-house rooms via `api.pms.rooms()` → new `GET /api/pms/rooms` entry in `client/src/api.js`, filter-as-you-type over `room_name`/`guest_name`); selecting a room calls `processPayment("Charge to Room", { pmsRoomId })`, which threads `pmsRoomId` into the `api.transactions.create()` / `api.transactions.pay()` payload alongside the existing fields. If the PMS returned a sync error, no special UI is needed beyond what "Charge to Room" already shows as a completed payment — reconciliation happens via the Transactions/Sales page.

**Sales/Transactions page visibility**: `formatTxn()` (`transactions.js:463-495`) gains `pmsSynced`/`pmsSyncError` in its output; `TransactionsPage` shows a small "⏳ syncing" or "⚠ sync failed" badge next to any `Charge to Room` row where `pms_synced` is false, so staff have visibility into anything still pending without needing to check server logs.

## Explicitly out of scope (matches Part 1)

- No menu/recipe/inventory sync in either direction.
- No refund/void path yet if a room-charge sale is later corrected at the POS — flag as a known gap.
- No manual "retry now" button — the 60s sweep is expected to catch everything within a minute of the PMS coming back; add one later only if this proves annoying in practice.

## Files touched

- `server/src/db/migrate_pms_room_charge.sql` (new)
- `server/.env.example`
- `server/src/services/pmsClient.js` (new)
- `server/src/routes/transactions.js` (charge-to-room handling, `syncRoomCharge`, `formatTxn` fields)
- `server/src/routes/pmsRooms.js` (new, or folded into `transactions.js`) + mounted in `server/src/index.js`
- `server/src/index.js` (retry `setInterval`)
- `client/src/App.jsx` (`DEF_PAYMENT_METHODS`, room-picker modal, `POSPage`'s payment-method tap handler, `TransactionsPage` sync badge)
- `client/src/api.js` (`api.pms.rooms()`, extend `transactions.create`/`transactions.pay` payload)
- `README.md` (new env vars, brief mention of the PMS integration)

## Verification

1. Run the POS server locally against a local PMS instance with `pos_integration` on and a real API key; confirm the migration adds the new columns on boot.
2. Take a normal cash sale — confirm nothing about the existing flow changed (payment methods list, receipt, account posting).
3. Tap "Charge to Room," pick a room from the picker, complete the sale — confirm it completes immediately in the POS UI, and check the PMS booking's Folio tab for the new charge.
4. Stop the PMS server, repeat step 3 — confirm the POS sale still completes locally (not blocked), `pms_synced=false` in the DB, then restart the PMS and confirm the retry sweep picks it up within ~60s and the folio charge appears.
5. Confirm the Transactions page shows a pending/failed sync badge while step 4's charge is unsynced, and that it clears once synced.
6. Confirm a wrong/missing `PMS_API_KEY` produces a clear `pms_sync_error` rather than crashing the transaction flow.
