# ZHP PMS — Development Roadmap

Last updated: 2026-07-20

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

## 🔵 Phase A — Close Critical Gaps (NEXT)

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

## 🟣 Phase C — Distribution & Direct Revenue

> Grows bookings, reduces OTA commission dependency.

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

## ⚪ Phase D — Polish & Advanced (Build when clients request)

### 8. Reviews & Feedback
- Post-stay survey auto-trigger (builds on Phase B email/WhatsApp)
- OTA review monitoring
- Reputation score dashboard

### 9. Group Bookings
- Multiple rooms under one reservation
- Master folio, group check-in
- Needed for villa/event properties

### 10. F&B / Full POS
- Table management, kitchen display system, stock tracking
- Existing sales module covers most small properties
- Only needed for properties with a restaurant

### 11. Concierge / Activities
- Activity catalog, tour bookings, transport scheduling
- Upsell revenue tracking
- Can surface through In-Room Media tablet

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

## Next migration number: 032
