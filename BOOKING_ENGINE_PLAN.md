# Booking Engine — Stage 1 (requests with a room hold, no payment)

Written 2026-11-02 with the owner. Follow CLAUDE.md house conventions (service holds the logic, bilingual
guides, additive migrations, `logEvent`-style history, Telegram alerts through smartReports).
ROADMAP.md Phase C item 6 ("Direct Booking Engine") is replaced by this plan for stage 1.

## Decisions (made with the owner — do not change)

1. **A request holds the room** as a *pending* booking, for **3 hours, day and night**. Not answered in time →
   released automatically.
2. **Price = the normal rate**, exactly what New Booking suggests (base rate + pricing periods incl. yield +
   meal plan), service & tax included. No direct-booking discount, no OTA ladder.
3. The guest picks a **room type**, not a room. A room is assigned automatically; front desk may change it.
4. Partners get a **link / embed** only (no partner API, no partner prices) — but every request records where it came from.
5. **Reply promise: 2 hours.** Reminder to the team at 1.5 h; hold ends at 3 h.

Defaults (adjustable on the setup page): up to **3 rooms per request**, minimum **1 night**, maximum 30 nights,
bookable up to **365 days ahead**, same-day arrival until **18:00 WITA**.

## Server constraints (1 vCPU / 1 GB RAM VPS — design for it)

- The booking page is a **static app served by nginx** on its own subdomain; only a small public API reaches Node.
- **Search cache**: 60 s in memory per property + dates + guests (small LRU, max 500 entries). The hold is still
  checked live inside a transaction, so a stale cache can never double-book.
- **Rate limits** (in addition to the global limiter): search 60 / 10 min per IP, request 5 / hour per IP and
  20 / day per email; nginx `limit_req` zone on `/api/public/booking/` too.
- **Photos**: resized on upload with `sharp` (already a dependency) to WebP 1600 / 800 / 400 px, **one at a time**
  (`sharp.concurrency(1)` for this path), upload limit 10 MB, max 12 per room type; served by nginx with 30-day cache.
- **Deploy**: the new app is built in `deploy.sh` like room-display; run its build with
  `NODE_OPTIONS=--max-old-space-size=512`. Keep the page bundle small (target < 150 KB gzip, no UI framework beyond React).
- Recommended (owner's call, outside the code): 2 GB RAM before launch; Cloudflare (free) in front of the booking subdomain.

## Module and permissions

- New module **`booking_engine`** (default off, same pattern as `back_office`).
- New permission **`booking_requests`** (Roles & Permissions → Front Desk): see and handle requests. Owners always.
  Setup page: owner only.

## Data (migration — next free number)

```
room_types: + public_description TEXT, + amenities TEXT[] DEFAULT '{}', + size_m2 NUMERIC(6,1),
             + bed_info VARCHAR(120), + bookable_online BOOLEAN NOT NULL DEFAULT false, + online_sort INT
room_type_photos (id, property_id, room_type_id → CASCADE, path_large, path_medium, path_small,
                  caption VARCHAR(160), sort_order INT, created_at)
booking_engine_settings (property_id PK → properties, enabled BOOL DEFAULT false,
   hold_hours NUMERIC(4,1) DEFAULT 3, reminder_after_hours NUMERIC(4,1) DEFAULT 1.5,
   reply_promise_text VARCHAR(200),               -- e.g. "We reply within 2 hours"
   min_nights INT DEFAULT 1, max_nights INT DEFAULT 30, max_days_ahead INT DEFAULT 365,
   same_day_cutoff TIME DEFAULT '18:00', max_rooms_per_request INT DEFAULT 3,
   rate_plan_ids UUID[],                         -- meal plans offered online (NULL = all active)
   cancellation_policy TEXT, child_policy TEXT, terms TEXT,
   payment_instructions TEXT,                    -- bank account / QRIS text for the confirmation email
   notify_email VARCHAR(200),                    -- reservation team inbox (copy of every request)
   updated_at, updated_by)
booking_engine_closed_dates (id, property_id, date_from, date_to, room_type_id NULL = whole hotel, note)
booking_engine_partners (id, property_id, code VARCHAR(40) UNIQUE per property, name, is_active, created_at)
booking_requests (id, property_id, request_no INT (BR-0001 per property), public_token VARCHAR(64) UNIQUE,
   status: held | confirmed | declined | alternative_offered | expired | cancelled_by_guest,
   check_in, check_out, guest_name, email, phone, country, special_requests, arrival_time,
   channel: page | embed | partner | chat | whatsapp,  partner_id NULL, referrer_url,
   quoted_total NUMERIC(14,2), currency 'IDR', lang 'en'|'id',
   held_until TIMESTAMPTZ, reminded_at, expired_at,
   handled_by, handled_at, decline_reason, offer_message, guest_id NULL (set on accept),
   ip_hash, user_agent, created_at)
booking_request_rooms (id, request_id → CASCADE, room_type_id, rate_plan_id, adults, children,
   quoted_total NUMERIC(14,2), nightly JSONB, booking_id NULL → bookings)   -- the held / confirmed booking
booking_request_events (id, request_id, note, created_by, created_at)      -- history, like purchase_order_events
bookings: + booking_request_id UUID NULL → booking_requests
booking_sources: per property a 'website' source "Website" (source_type direct), created by the migration and by seedPropertyDefaults
```

## Public API — `routes/bookingPublic.js`, mounted at `/api/public/booking`, no login

All logic in **`services/bookingEngine.js`** as plain functions (`config`, `search`, `quote`, `createRequest`,
`getRequest`, `cancelByGuest`) — the HTTP routes are thin, so stage 3's chatbot calls the same functions as tools.

- `GET /:slug/config` — name, logo, colours (from branding), check-in / out times, policies, offered meal plans
  (name, what's included), limits, reply promise, languages. 404 when the module or `enabled` is off.
- `GET /:slug/search?check_in&check_out&adults&children&rooms` — per **bookable room type** with rooms free:
  name, description, amenities, size, bed info, photos, max guests, **how many are free (capped display "Only 2 left"
  when ≤ 2)**, and per offered meal plan the stay total + per-night amounts, all-in (service & tax incl.).
  Uses `availabilityService.searchAvailability(..., { includeGuests: false })` + `pricingService` + `ratePlanService`
  so the number equals New Booking's. **Never returns room names / numbers or any guest data.**
  Validation: dates within the limits, closed dates, same-day cutoff, min / max nights, guests ≤ max_guests.
- `POST /:slug/requests` — `{ check_in, check_out, rooms: [{ room_type_id, rate_plan_id, adults, children }],
  guest: { name, email, phone, country }, special_requests, arrival_time, lang, partner_code?, channel, hp_field, form_ms }`
  - Spam: `hp_field` must be empty, `form_ms` ≥ 3000, email + phone format (phone → 62… form, same helper as the
    WhatsApp buttons), rate limits above.
  - **One transaction:** re-quote every room (price shown must still match within Rp 1; if it changed → 409
    `PRICE_CHANGED` with the new quote); for each room lock that type's units (`SELECT … FOR UPDATE`), pick a free unit
    with the same overlap rule as everywhere (`occupancySql`), prefer the unit that leaves the fewest gaps (else lowest
    sort order); none free → 409 `SOLD_OUT` naming the type. Find-or-create the guest by email (+ phone), then create one
    **`pending`** booking per room through `bookingCreateService.createBooking` (source `website`, the quoted price,
    rate plan, adults / children, special requests, `booking_request_id`; internal note "Website request BR-0001 — held
    until 14:30"). `held_until = now + hold_hours`.
  - After commit: guest email "request received", team email copy, Telegram `alert_booking_request`, Channex sync for the
    property (`channelSync.syncProperty`, not waiting). Response: `{ request_no, public_token, held_until, status_url }`.
- `GET /:slug/requests/:token` — the guest's own request (status, rooms, total, held until, policies). For the status page.
- `POST /:slug/requests/:token/cancel` — guest cancels while `held` → holds released, team alerted.

## Holds — job in `server/jobs/index.js` (every 5 min, existing cron)

- `held` and `now ≥ held_until − (hold_hours − reminder_after_hours)` and not reminded → Telegram reminder
  ("BR-0001 waiting 1 h 30 m — hold ends 14:30"), `reminded_at` set.
- `held` and `now ≥ held_until` → in one transaction cancel its pending bookings (status `cancelled`, reason
  "Website request — hold expired"), request `expired`; then Telegram "hold expired, room released", Channex sync.
- **Holds never count as real cancellations:** cancelled bookings with a `booking_request_id` whose request was never
  confirmed are excluded from cancellation counts / rates in Reports, Insights, Forecast and the Dashboard
  (find every place that counts cancelled bookings — `git grep "'cancelled'"` in services/routes — and add the filter).
  Pending holds DO block availability and DO count as sold for Channex (that is the point of the hold), but are **not**
  counted as booked revenue / occupancy in reports until confirmed (same check: request status).

## PMS — Booking requests inbox (`client/src/pages/BookingRequests.jsx`, `/booking-requests`)

- Nav item under Front Desk with a badge = requests `held`; a pop-up on every page like the OTA bookings notice
  (`otaInbox` pattern) when a new request arrives.
- List: BR no., guest, dates, rooms (type × meal plan × guests), total, channel / partner, **time left on the hold**
  (amber < 1 h, red < 30 min), status. Filters: Waiting / Confirmed / Declined & expired / All.
- Detail: guest contact (tap-to-WhatsApp / email), special requests, arrival time, per room the held booking (room
  assigned, link to the booking), quoted price per night, history. Actions:
  - **Confirm** → pending bookings → `confirmed`, request `confirmed`, guest email (existing `booking_confirmed`
    template via `mailer.sendBookingEmail`, plus the setup page's payment instructions and the request number).
    Staff can change room / price on the booking first, as for any booking.
  - **Offer an alternative** → message (free text, e.g. other dates or type) emailed to the guest; holds released;
    status `alternative_offered`. (The guest replies by email / WhatsApp; staff book it normally.)
  - **Decline** (reason) → holds released, polite email, status `declined`.
  - **Extend hold +3 h** (once or more, logged) — when the team needs time to call the guest.
  - Expired request: **Hold again & confirm** — re-runs the hold check live; refused if the type is now full.
- Booking detail: a line "From website request BR-0001" linking to the request; New/pending booking badge "Website hold".

## PMS — Booking Engine setup (`client/src/pages/BookingEngineSetup.jsx`, owner)

Tabs: **General** (on/off, hold / reminder hours, reply promise, limits, same-day cutoff, notify email) ·
**Room types** (bookable online, order, public description, amenities picker + custom, size, bed info, photos —
upload, reorder, caption, delete) · **Meal plans** offered · **Policies** (cancellation, children, terms, payment
instructions) · **Closed dates** · **Share & embed** (links and snippets below, copy buttons, live preview iframe) ·
**Partners** (name + code → their own link `…/zahill?ref=<code>`; requests per partner, last 90 days).
Email templates: add triggers `booking_request_received`, `booking_request_declined`, `booking_request_alternative`
to `communications.js` TRIGGERS (+ migration for the CHECK) so wording is editable like the existing ones; EN + ID defaults.

## Guest booking page — new app `booking/` (Vite + React, like room-display)

- URL: `https://book.<domain>/<slug>` (nginx `nginx/booking.conf`, `server_name book.zahill.kdai.cloud`, root
  `/var/www/zahill/booking/dist`, proxy only `/api/public/` and `/room-photos/`). Status page: `/<slug>/r/<token>`.
- Steps: **Dates & guests** (calendar, adults, children, rooms) → **Choose rooms** (cards with photo carousel,
  amenities, "Only 2 left", each meal plan with total + "incl. service & tax"; add up to the room limit; running summary)
  → **Your details** (name, email, WhatsApp number, country, arrival time, special requests, accept policies)
  → **Request sent**: number, held until, reply promise, "we'll contact you by WhatsApp or email", link to the status page.
- EN / ID switch (browser language default), IDR formatting, hotel branding (logo, `brand_color`), mobile-first,
  works inside an iframe. Handles `PRICE_CHANGED` / `SOLD_OUT` gracefully (show the new price / go back to rooms).
- **Embed** (`booking/public/embed.js`, < 5 KB, no dependencies):
  `<script src="https://book.zahill.kdai.cloud/embed.js" data-property="zahill" data-ref="website" data-lang="id" async></script>`
  → adds a "Book now" button (or binds to any element with `data-zahill-book`) that opens the page in a full-screen
  modal iframe; `data-mode="inline"` renders it inline with auto-height via `postMessage`. A partner's snippet carries
  its own `data-ref`. Plain link and plain iframe snippets are offered too.
- Privacy: a short privacy note; no cookies besides language; IP stored only as a salted hash.

## Telegram — new alert `alert_booking_request` (smartReports REPORTS, group `front_desk`, Telegram + email,
default roles owner + manager + front desk)

New request (guest, dates, rooms, total, channel / partner, held until, link) · reminder · hold expired · cancelled by guest.

## How stages 2 and 3 plug in (build nothing for them now, but keep these seams)

- **Payment (stage 2):** `booking_requests.status` gains `awaiting_payment` / `paid`; `createRequest` gets a
  `payment` option; the gateway webhook confirms the request through the same Confirm function. Hold length per channel.
- **Chatbot (stage 3):** the bot's tools are `bookingEngine.search`, `quote`, `createRequest`, `getRequest` with
  `channel: 'chat' | 'whatsapp'` — same rules, same holds, same inbox. Reuse the assistant pattern
  (`services/assistant.js`: the model only calls tools; every price comes from a tool). WhatsApp = a channel adapter
  (Meta WhatsApp Cloud API webhook → conversation store → bot), nothing else changes.

## Guides

New chapters `booking-requests.en.md` / `.id.md` (handling requests, holds, reminders) and
`booking-engine.en.md` / `.id.md` (setup, photos, embedding, partners).

## Order of work

1. Migration + `bookingEngine` service (config / search / quote / createRequest / holds) + public routes + job, with tests.
2. PMS inbox + booking-detail link + Telegram + emails.
3. Setup page (photos last).
4. `booking/` app + embed.js + nginx conf + deploy.sh step.
5. Report exclusions for unconfirmed holds; guides.

## Acceptance checks

1. Search for 2 adults, 2 nights → each bookable type with free rooms, price per meal plan = what New Booking suggests
   for the same dates incl. service & tax; no room names or guest data in the JSON.
2. Request 2 rooms → 2 pending bookings on free units, request `held`, held_until = +3 h; guest + team email; Telegram;
   Channex shows those rooms closed after the sync.
3. Two requests at the same moment for the last room → one held, the other 409 `SOLD_OUT`.
4. Price changed between search and send (pricing period added) → 409 `PRICE_CHANGED` with the new price.
5. No action: reminder at 1.5 h, at 3 h the bookings are cancelled, request `expired`, room free again, Channex reopened;
   the expired hold is not counted as a cancellation in Reports / Insights.
6. Confirm → bookings `confirmed`, confirmation email with payment instructions; counts in occupancy / revenue from then.
7. Decline / Offer alternative / Extend hold / Hold again & confirm / guest cancel — each does what it says and is in the history.
8. Limits: past date, beyond 365 days, same day after 18:00, under min nights, too many guests, closed dates → clear 400s.
9. Spam: filled honeypot or < 3 s form → refused; 6th request in an hour from one IP → 429.
10. Embed: script on a plain HTML test page opens the modal; inline mode resizes; `data-ref` partner recorded on the request.
11. Page at 390 px and 1280 px, EN and ID, inside an iframe; bundle < 150 KB gzip; photos served as WebP from nginx.
12. Module off → public routes 404, nav hidden.
