# Zahill PMS — Project Planning Document

> Property Management System for Zahill <!-- TODO: property type and location -->
> Forked from Birdnest PMS's planning doc — adapt the specifics below (unit count, owner, location) for Zahill
> Status: Forked, pending Zahill-specific setup

---

## 1. Project Overview

A web-based Property Management System built to run <!-- TODO: unit count/type --> property <!-- TODO: location -->. The owner operates the business remotely and needs a live command center, while on-site staff use it daily for check-in, housekeeping, and operations.

**Two user roles:**
- **Owner** — Remote access, full visibility, dashboard-first, revenue and alerts
- **Staff** — On-site, operations-focused, mobile-friendly, task execution

**Core principles:**
- Simple enough for non-technical staff on a phone
- Rich enough to give the owner full situational awareness from anywhere
- Guest intelligence at its center — know guests deeply, serve them better
- Scalable: starts at 5 units, designed to grow

---

## 2. Tech Stack

Consistent with the existing Separuh POS project.

| Layer | Choice |
|---|---|
| Frontend | React 18 (JSX) |
| Build Tool | Vite 5 |
| PWA | vite-plugin-pwa (installable on mobile) |
| Backend | Node.js + Express 4 (CommonJS) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Database | PostgreSQL — raw SQL migrations |
| Security | helmet, cors, express-rate-limit |
| Dev | nodemon, uuid, nodemailer |
| Deployment | Nginx + PM2 |
| Target path | `/var/www/zahill/` |
| Server port | 4000 (behind Nginx) |

**Architecture:** Monorepo — React/Vite PWA frontend + Node/Express REST API backend + PostgreSQL

**Real-time:** Use short-interval polling or WebSocket (socket.io) for live dashboard updates — owner needs to see check-ins happen without refreshing.

**File uploads:** multer for passport/ID capture at check-in. Start with local disk storage, migrate to S3 later.

---

## 3. Modules

### Phase 1 — Core (Build First)

#### 3.1 Owner Dashboard
The remote command center. Loads on login for owner role.

- Tonight's occupancy (X/5 units)
- Arrivals today + departures today
- Live unit status grid (all 5 units, color-coded)
- Today's activity feed (housekeeping done, issues, guest messages)
- Revenue MTD + 7-day bar chart
- Pending payments alert
- Open maintenance issues badge
- Upcoming birthdays alert (within 30 days)

#### 3.2 Reservation Calendar
Timeline view — all units as rows, dates as columns. Core booking interface.

- Visual calendar: units × dates, color-coded by channel
  - Green = Direct booking
  - Pink/Red = Airbnb
  - Blue = Booking.com
  - Orange = Check-out day
  - Gray = Blocked/Maintenance
- Click empty cell → create booking
- Click existing booking → view/edit detail
- Month navigation
- "New Booking" button → opens booking form

#### 3.3 Booking / Reservation Management
Create and manage individual bookings.

- Guest info: name, WhatsApp, email, nationality, number of guests
- Unit selection (shows only available units for selected dates)
- Dates: check-in, check-out (auto-calculates nights)
- Booking source: Direct | Airbnb | Booking.com | Traveloka | Walk-in
- Special requests / notes
- Payment panel (see Section 3.4)
- Status: Confirmed | Pending | Cancelled | No-show
- WhatsApp confirmation button (opens wa.me link with pre-filled message)

#### 3.4 Payment Tracking
Per-booking payment tracker. No payment gateway. Manual recording only.

**Each booking has two payment events:**

**Deposit:**
- Amount (default 30% of total, editable)
- Status: Pending | Received
- Method: Bank Transfer | QRIS | Cash | OTA Managed | Wise
- Date received
- Received by (staff name)

**Balance:**
- Amount (total minus deposit)
- Status: Pending | Received
- Method: Bank Transfer | QRIS | Cash | OTA Managed
- Date received
- Received by

**Dashboard widget:** "Pending Payments" — shows all bookings with unpaid deposit or balance, sorted by arrival date.

**Payment methods:**
- Bank Transfer (BCA / Mandiri / BNI / BRI)
- QRIS (covers GoPay, OVO, Dana, ShopeePay)
- Cash
- OTA Managed (Airbnb/Booking.com handles it — no action needed)
- Wise (for international guests)

#### 3.4b Pricing Periods (Dynamic Pricing)
Owner defines named date periods with price overrides. When creating a booking, the system auto-suggests the correct rate based on check-in date.

**How it works:**
- Each unit keeps a `base_rate` (default price)
- Owner defines periods: name, date range, and either a **fixed price** or a **% multiplier** (e.g. Weekend = ×1.3)
- Periods can apply to **all units** or **specific units only**
- If a booking falls in multiple periods, the **highest priority** (sort_order) wins
- No automatic charging — system suggests the price, staff can still override

**Pricing Period fields:**
- Name (e.g. "Weekend", "Eid Holiday", "Peak Season")
- Date from / Date to
- Type: `multiplier` (e.g. 1.3 = +30%) or `fixed` (flat price per night)
- Value: the multiplier or fixed price
- Applies to: All units or specific unit IDs
- Priority (sort_order): higher = takes precedence when periods overlap
- Color label (for visual reference)

**New Booking integration:**
- On date + unit selection, auto-calculate suggested price using active periods
- Show which period is being applied (e.g. "Weekend rate ×1.3 applied")
- Staff can still manually override the total

**Database table:**
```sql
pricing_periods (
  id, name, color,
  date_from, date_to,
  type,        -- 'multiplier' | 'fixed'
  value,       -- e.g. 1.3 or 500000
  unit_ids,    -- JSONB array of unit UUIDs, empty = all units
  sort_order,
  is_active,
  created_at
)
```

#### 3.4c Unit Settings (Owner Only)
Manage the 5 glamping nests from the UI — no need to touch the database directly.

- Edit unit name, type, description
- Set base rate per night (IDR)
- Set max guests
- Update unit status (available / occupied / maintenance / blocked)
- Accessible via sidebar: Settings → Units (owner role only)

#### 3.5 Room Allotment Manager
Control which units are available on which channels.

- Assign each unit to a channel: Direct | Airbnb | Booking.com | Buffer
- Visual bar chart showing allocation split
- Buffer unit rule: always keep at least 1 unit unallocated to prevent double-booking during OTA sync delay
- Release buffer to open channels at T-3 days if still empty
- Strategy notes visible to owner (configurable)
- Edit assignments per month

#### 3.6 Check-in / Check-out Flow
Staff-facing. Mobile-optimized.

**Check-in:**
- "Arriving Today" list sorted by ETA
- Tap guest → open check-in flow
- Step indicator: Guest Info → ID Verify → Unit Handover → Complete
- Handover checklist (configurable per property):
  - Unit clean & ready (confirms housekeeping)
  - Welcome amenities in place
  - WiFi code given
  - Check-out time communicated
  - House rules explained
  - ID/Passport captured (photo upload via multer)
  - Emergency contact shared
- "Complete Check-in" → updates unit status to Occupied
- "Send WhatsApp Welcome" → opens wa.me with welcome template

**Check-out:**
- "Departing Today" list
- Confirm balance paid
- Unit condition notes
- "Complete Check-out" → updates unit to Available, triggers housekeeping task

---

### Phase 2 — Operations + Guest Intelligence

#### 3.7 Operations Board
Daily task management for staff.

- Kanban: To Do → In Progress → Done
- Task types: Housekeeping | Maintenance | Supplies | Grounds | Guest Request
- Priority: High | Medium | Low
- Assign to staff member
- Due time
- Link to unit or booking (optional)
- Staff on duty panel
- Auto-generate housekeeping tasks on check-out

#### 3.8 Guest Intelligence (CRM)
Full guest profiles — the memory of the property.

**Guest Profile contains:**
- Personal: Name, nationality, WhatsApp, email, birthday, anniversary
- ID: Passport/ID on file (captured at check-in)
- Stay history: Every visit with dates, unit, source, spend, review
- Lifetime stats: Total stays, total nights, total spend, avg rating
- Preferences (tagged, editable):
  - Dietary / Allergies (e.g., "Son: peanut allergy", "No spicy food")
  - Room preferences (e.g., "Prefers Nest 2", "Extra blankets always")
  - Habits (e.g., "Always arrives late 17:00+", "Early checkout")
  - Special notes (e.g., "Honeymoon anniversary trip", "Loves stargazing")
- Staff notes: Per-stay notes added by any staff member
- Communication log: WhatsApp message notes per booking
- Loyalty tier: Auto-assigned based on program rules
- Quick actions: Send birthday invite, new booking, manual perk override

**Guest List view:**
- Search by name, phone, email
- Filter by tier, nationality, date of last stay
- Upcoming birthdays panel (next 30 days) with one-click WhatsApp invite
- Lifetime value displayed

**Birthday / Special Date System:**
- Dashboard alert: "X guests have birthdays in the next 30 days"
- Per-guest: countdown to birthday
- Quick action: "Send Birthday Invitation via WhatsApp"
- Template message pre-filled with guest name and a special offer

#### 3.9 Loyalty Program (Dynamic)
Fully configurable by owner. No hardcoded tiers.

**Tier structure (owner configures):**
- Tier name (e.g., "Wanderer", "Explorer", "Adventurer", "Zahill Member")
- Threshold type: Total nights stayed | Total spend (Rp) | Number of visits
- Threshold value (e.g., 7 nights)
- Perks list (owner writes free-text perks, e.g., "Free sunrise Mount Batur trip")
- Tier color / emoji (for display)
- Sort order

**System behavior:**
- On every checkout, recalculate guest tier automatically
- Tier badge + applicable perks shown on check-in screen so staff knows what to offer
- Owner can manually override a guest's tier
- "Change anything anytime" — modifying tiers re-assigns all guests instantly

**Guest-facing preview:**
- Loyalty card style summary (for sending via WhatsApp): tier name, perks, progress to next tier

---

### Phase 2b — Night Audit

#### 3.11 Night Audit
End-of-day process that closes the business date, catches discrepancies, and produces the daily summary. Runs automatically at 23:55 each night via a scheduled backend job (node-cron). Owner or staff can also trigger it manually from the PMS.

---

**What the audit does (in order):**

1. **Guard — duplicate run check**
   Before doing anything, check if an audit has already been run for today's business date. If yes, abort and return early. This prevents accidental double-posting.

2. **No-show detection**
   Query all bookings where `status = 'confirmed'` AND `check_in_date = today`. These guests were expected but never checked in. Flag each one as `status = 'no_show'` and include them in the audit report. Owner can reverse a no-show manually if the guest arrives late.

3. **In-house revenue tally**
   Count all bookings with `status = 'checked_in'` and sum up their nightly rate (derived from `total_amount / nights`). This becomes the "room revenue today" figure in the daily summary. No new charge rows are written — Zahill uses a fixed booking total, not a live folio — but the tally feeds the daily report.

4. **Ancillary revenue tally**
   Sum all `sales` records created today (both room-charge and walk-in) for the "ancillary revenue today" figure.

5. **Pending balance alert**
   Find all bookings with `check_out_date = tomorrow` whose balance payment is still `status = 'pending'`. Include them in the audit report so staff see them at the top of tomorrow's departures list.

6. **Housekeeping task auto-generation**
   For every booking with `check_out_date = tomorrow`, auto-create a housekeeping task (type: `housekeeping`, title: "Prep [unit name] for checkout", due: check-out time) if one doesn't already exist for that booking/unit on that date.

7. **Business date rollover**
   Update `business_date` in `property_settings` to tomorrow. This is the canonical "what day is it in the PMS" value — used for daily revenue grouping, arrivals/departures lists, and report queries.

8. **Write audit log**
   Insert a row into `night_audit_runs` with the closed business date, counts, revenue figures, list of flagged no-shows, list of pending balances due tomorrow, and the run timestamp.

9. **Owner notification**
   Send a summary email (via nodemailer) to the owner's configured email address. Subject: `[Zahill] Night Audit — {date}`. Body includes: occupied units, no-shows flagged, revenue for the day, payments due tomorrow.

---

**Database additions:**

```sql
-- Tracks current business date and last audit run time
-- Add columns to property_settings:
ALTER TABLE property_settings ADD COLUMN business_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE property_settings ADD COLUMN last_audit_at TIMESTAMPTZ;

-- Night audit run log
night_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date       DATE NOT NULL UNIQUE,   -- the date being closed
  run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_by        TEXT NOT NULL,          -- 'auto' | 'manual:{user_id}'
  units_occupied      INTEGER,
  no_shows            JSONB,                  -- [{booking_id, guest_name, unit_name}]
  room_revenue        NUMERIC(12,2),
  ancillary_revenue   NUMERIC(12,2),
  pending_balances    JSONB,                  -- [{booking_id, guest_name, amount, unit_name}]
  tasks_created       INTEGER,
  summary             TEXT                    -- human-readable one-line summary
)
```

**Migration file:** `server/db/migrations/007_night_audit.sql`

---

**Backend job:**

File: `server/jobs/nightAudit.js`

```js
// Scheduled via node-cron: '55 23 * * *'
// Also callable directly (for manual trigger from API)
async function runNightAudit(triggeredBy = 'auto') { ... }
module.exports = { runNightAudit };
```

Registered in `server/index.js` alongside the MQTT client startup.

---

**API routes** (add to `/api/night-audit`):

```
POST   /api/night-audit/run           — manually trigger audit (owner only)
GET    /api/night-audit/history       — list past audit runs (owner only)
GET    /api/night-audit/latest        — most recent audit summary
GET    /api/night-audit/:date         — audit report for a specific date (YYYY-MM-DD)
```

---

**PMS Frontend — Night Audit UI:**

**Owner Dashboard widget:**
- Shows last audit time (e.g. "Last audit: Today 23:55") with a green checkmark
- If audit hasn't run today: shows an amber warning badge "Audit not run today"
- "Run Audit Now" button → calls `POST /api/night-audit/run`, shows spinner, then refreshes widget

**Night Audit History page** (`/night-audit`, owner only):
- Table of past audit runs: date, occupied units, no-shows, room revenue, ancillary revenue, payments flagged
- Click any row → expand to show full details (no-show list, pending balances list)

**Folder additions:**
```
server/
  jobs/
    nightAudit.js     ← audit logic
    index.js          ← registers all scheduled jobs (cron setup)
client/src/pages/
  NightAudit.jsx      ← history + manual trigger page
```

---

**Key design decisions:**

- **No live folio posting** — Zahill uses fixed booking totals, so there's no need to post individual nightly charge rows. The audit tallies revenue from existing booking data rather than building a running folio.
- **Idempotent guard** — the `UNIQUE` constraint on `night_audit_runs.business_date` prevents double-runs at the database level, in addition to the application-level check.
- **No-show is reversible** — `no_show` is a booking status, not a deletion. Owner can manually flip it back to `confirmed` or `checked_in` if a guest arrives after midnight.
- **Email is best-effort** — audit runs even if the email send fails. Email errors are logged but do not roll back the audit.
- **node-cron** — add as a dependency (`npm install node-cron`). Does not require a separate worker process; runs inside the existing PM2-managed Express process.

---

#### 3.10 Ancillary Sales / Mini POS
Simple sales module for non-room revenue. NOT a full POS (that's Separuh). Just enough to track extras sold on-property.

**Two modes:**

**Charge to Room:**
- Select active booking (guest currently staying)
- Browse product catalog by category
- Tap items + quantity
- Add to booking tab
- Items appear on booking's final bill at checkout

**Walk-in Sale:**
- No booking attached
- Select items
- Payment method: Cash | QRIS
- Quick receipt / print / WhatsApp

**Product Catalog:**
- Categories: Drinks | Food & Snacks | Merchandise | Tour Packages | Other
- Each product: name, price (IDR), category, available (toggle)
- Owner can add/edit/remove products
- Tour packages can have description and booking lead time note

**Revenue:**
- Ancillary sales feed into owner dashboard revenue
- Separate line in monthly report: Room Revenue vs. Ancillary Revenue

---

## 4. Database Schema (Outline)

### Core Tables

```sql
-- Users (staff + owner)
users (id, name, email, password_hash, role, created_at)
-- role: 'owner' | 'staff'

-- Units (glamping nests)
units (id, name, type, description, base_rate, max_guests, status, created_at)
-- status: 'available' | 'occupied' | 'maintenance' | 'blocked'

-- Guests
guests (
  id, name, nationality, whatsapp, email,
  birthday, anniversary,
  id_document_url,      -- passport/ID photo
  loyalty_tier_id,      -- FK to loyalty_tiers (nullable, auto-assigned)
  tier_override,        -- boolean: true if manually set
  notes,                -- general notes
  created_at
)

-- Guest Preferences (flexible tags)
guest_preferences (id, guest_id, category, value, created_at)
-- category: 'dietary' | 'room' | 'habit' | 'special'

-- Bookings
bookings (
  id, guest_id, unit_id,
  check_in_date, check_out_date, nights,
  num_guests,
  source,               -- 'direct' | 'airbnb' | 'booking_com' | 'traveloka' | 'walkin'
  status,               -- 'confirmed' | 'pending' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'
  total_amount,
  special_requests,
  internal_notes,
  created_by,           -- user_id
  created_at, updated_at
)

-- Payments
payments (
  id, booking_id,
  type,                 -- 'deposit' | 'balance'
  amount,
  status,               -- 'pending' | 'received'
  method,               -- 'bank_transfer' | 'qris' | 'cash' | 'ota_managed' | 'wise'
  received_at,
  received_by,          -- user_id
  notes,
  created_at
)

-- Checkin Records
checkin_records (
  id, booking_id,
  checkin_time, checkout_time,
  id_captured,          -- boolean
  checklist_data,       -- JSONB: {unit_clean: true, wifi_given: true, ...}
  condition_notes,
  processed_by          -- user_id
)

-- Room Allotment
allotments (
  id, unit_id, channel, month, year, notes, updated_at
)
-- channel: 'direct' | 'airbnb' | 'booking_com' | 'traveloka' | 'buffer'

-- Operations Tasks
tasks (
  id, title, description,
  type,                 -- 'housekeeping' | 'maintenance' | 'supplies' | 'grounds' | 'guest_request'
  priority,             -- 'high' | 'medium' | 'low'
  status,               -- 'todo' | 'in_progress' | 'done'
  assigned_to,          -- user_id
  unit_id,              -- nullable
  booking_id,           -- nullable
  due_time,
  created_at, updated_at
)

-- Staff Notes (per booking)
booking_notes (id, booking_id, author_id, content, created_at)

-- Loyalty Tiers (owner configures)
loyalty_tiers (
  id, name, emoji, color,
  threshold_type,       -- 'nights' | 'spend' | 'visits'
  threshold_value,
  sort_order,
  created_at
)

-- Loyalty Perks
loyalty_perks (id, tier_id, description, sort_order)

-- Products (Ancillary Sales)
products (
  id, name, category, price, description,
  is_available,         -- boolean
  created_at
)
-- category: 'drinks' | 'food' | 'merchandise' | 'tour' | 'other'

-- Ancillary Sales
sales (
  id, booking_id,       -- nullable (null = walk-in)
  payment_method,       -- 'cash' | 'qris' | 'room_charge'
  total_amount,
  served_by,            -- user_id
  created_at
)

-- Sale Items
sale_items (id, sale_id, product_id, quantity, unit_price, subtotal)
```

---

## 5. API Structure (REST)

```
POST   /api/auth/login
POST   /api/auth/logout

GET    /api/units
GET    /api/units/:id

GET    /api/bookings
POST   /api/bookings
GET    /api/bookings/:id
PUT    /api/bookings/:id
DELETE /api/bookings/:id
GET    /api/bookings/today/arrivals
GET    /api/bookings/today/departures

GET    /api/guests
POST   /api/guests
GET    /api/guests/:id
PUT    /api/guests/:id
GET    /api/guests/upcoming-birthdays

POST   /api/checkin/:bookingId/start
PUT    /api/checkin/:bookingId/complete
PUT    /api/checkout/:bookingId/complete

GET    /api/payments/pending
POST   /api/payments
PUT    /api/payments/:id

GET    /api/allotments
PUT    /api/allotments

GET    /api/tasks
POST   /api/tasks
PUT    /api/tasks/:id
DELETE /api/tasks/:id

GET    /api/loyalty/tiers
POST   /api/loyalty/tiers
PUT    /api/loyalty/tiers/:id
DELETE /api/loyalty/tiers/:id

GET    /api/products
POST   /api/products
PUT    /api/products/:id

GET    /api/sales
POST   /api/sales

GET    /api/dashboard/summary
GET    /api/reports/revenue?month=&year=

POST   /api/night-audit/run
GET    /api/night-audit/history
GET    /api/night-audit/latest
GET    /api/night-audit/:date
```

---

## 6. Folder Structure

```
zahill-pms/
├── client/                    # React + Vite frontend
│   ├── public/
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   │   ├── ui/            # Base: Button, Card, Badge, Modal, etc.
│   │   │   ├── calendar/      # Booking calendar
│   │   │   ├── checkin/       # Check-in flow
│   │   │   └── loyalty/       # Loyalty builder
│   │   ├── pages/             # Route-level pages
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Reservations.jsx
│   │   │   ├── NewBooking.jsx
│   │   │   ├── Allotment.jsx
│   │   │   ├── CheckIn.jsx
│   │   │   ├── Operations.jsx
│   │   │   ├── Guests.jsx
│   │   │   ├── GuestProfile.jsx
│   │   │   ├── Loyalty.jsx
│   │   │   └── Sales.jsx
│   │   ├── hooks/             # Custom React hooks
│   │   ├── services/          # API call functions
│   │   ├── context/           # Auth context, etc.
│   │   ├── utils/
│   │   └── main.jsx
│   ├── vite.config.js
│   └── package.json
│
├── server/                    # Node.js + Express backend
│   ├── routes/
│   │   ├── auth.js
│   │   ├── bookings.js
│   │   ├── guests.js
│   │   ├── units.js
│   │   ├── payments.js
│   │   ├── checkin.js
│   │   ├── tasks.js
│   │   ├── allotments.js
│   │   ├── loyalty.js
│   │   ├── products.js
│   │   ├── sales.js
│   │   ├── dashboard.js
│   │   ├── reports.js
│   │   └── nightAudit.js
│   ├── jobs/
│   │   ├── index.js           # registers all cron jobs
│   │   └── nightAudit.js      # audit logic (also called by route)
│   ├── middleware/
│   │   ├── auth.js            # JWT verification
│   │   └── role.js            # Owner vs staff guard
│   ├── db/
│   │   ├── index.js           # pg Pool setup
│   │   └── migrations/        # SQL migration files
│   ├── uploads/               # Passport/ID files (local for now)
│   ├── index.js               # Express app entry
│   ├── ecosystem.config.cjs   # PM2 config
│   └── package.json
│
├── PLANNING.md                # This file
└── zahill-pms-mockup.html  # UI reference mockup
```

---

## 7. Build Phases

### Phase 1 — Core Reservation System
1. Project setup (monorepo, Vite, Express, PostgreSQL connection)
2. Auth: login, JWT, role guard (owner / staff)
3. Database: migrations for units, guests, bookings, payments
4. Units API + basic unit management
5. Bookings API (CRUD)
6. Reservation Calendar UI
7. New Booking form
8. Payment tracking (per booking)
8b. Pricing periods (dynamic pricing — multiplier or fixed override)
9. Room Allotment manager
10. Check-in / Check-out flow
11. Owner Dashboard (occupancy, arrivals, payments widget)

### Phase 2 — Operations + Guest Intelligence
12. Operations board (Kanban tasks)
13. Guest profiles (full CRM)
14. Preference tags system
15. Stay history view
16. Birthday alert system
17. Loyalty tier builder (dynamic)
18. Auto tier assignment on checkout
19. Staff notes per booking
20. Night Audit — scheduled job, manual trigger, history page, owner email summary (migration 007)

### Phase 3 — Ancillary + Growth
21. Product catalog management
22. Ancillary Sales mini-POS (charge to room + walk-in)
23. Revenue reports (room vs. ancillary)
24. Direct booking page (public-facing)
25. WhatsApp message templates (wa.me links)
26. OTA channel sync (manual → automated)

---

## 8. Design Decisions & Notes

- **No payment gateway** in Phase 1–2. Payment tracking only (manual record of what was received, how, when).
- **WhatsApp integration**: All guest communication is wa.me links (no API needed). Templates pre-filled. WhatsApp Business API is a Phase 3 consideration.
- **PWA**: Enable from day 1. Staff need to install on phone. Offline caching for operations board is a nice-to-have.
- **Real-time**: Start with 30-second polling on the dashboard. WebSocket upgrade if polling feels sluggish.
- **ID capture**: multer upload, stored locally in `/server/uploads/`. Files served via a protected API route (not public).
- **Multi-currency**: Display IDR by default. USD conversion rate configurable in settings. No automatic FX — just informational.
- **OTA bookings**: Entered manually by staff. Source field tracks which channel. OTA payment = mark as "OTA Managed" in payment tracker.
- **Loyalty tier recalculation**: Triggered on every checkout event. Queries total nights/spend/visits for that guest and assigns highest matching tier.
- **No inventory management** in mini-POS — that's Separuh POS territory. Zahill POS just records sales, no stock tracking.
- **Design language**: Earthy, natural tones. Forest green (#2D5016) primary. Warm cream background. Mobile-first. Reference: `zahill-pms-mockup.html`

---

## 9. Reference Files

- `zahill-pms-mockup.html` — Interactive UI mockup (7 screens, open in browser)
- `PLANNING.md` — This document

---

## 10. Post-Launch Addition: Market Insights (July 2026)

Not part of the original phased plan above — added ad-hoc after Phase 1 shipped, in response to the owner wanting competitive/market awareness on the dashboard.

**Three dashboard cards:**
- **Competitor Ratings** — owner manually adds competitors by name; resolved via Google Places API, refreshed daily.
- **Search Interest** — Google Trends data for "kintamani glamping" / "bali glamping", refreshed weekly.
- **AI Weekly Briefing** — Claude API synthesizes the above (plus upcoming holidays) into a structured weekly summary for the owner.

See `CLAUDE.md` → "Market Insights (Dashboard)" for full technical detail (routes, tables, cron schedule, env vars). This section exists only to flag that the feature is live and where it diverges from the original Phase 1–3 roadmap above.

---

*Start building in VSCode with Claude Code. Open the project folder, reference this document, and begin with Phase 1 Step 1: project setup.*
