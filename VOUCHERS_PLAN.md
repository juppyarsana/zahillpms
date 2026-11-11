# Vouchers — plan (2026-11-11)

Zahill sells a voucher for a fixed stay (for example 2 nights, Deluxe Pool View, with
breakfast, for Rp X). The buyer gets a document with terms and conditions and uses it
whenever they want, within the terms. Today FO makes the voucher by hand in a docx and
nothing in the PMS knows about it. This plan builds it end to end: setup, sale, booking,
check-in and check-out, the books, expiry and reports.

## Decisions (owner, 2026-11-11)

| Question | Answer |
|---|---|
| What is sold | **A fixed stay** bought at a set price (nights, room type, meal plan). No rupiah-value vouchers and no partial use in v1. |
| Refunds | **Not refundable.** Unused vouchers become breakage income at expiry. A refund is a manager exception, with a reason. |
| Rules | **Blackout dates** and other rules per voucher type. A manager can override with a reason. |
| Tax and service charge | **Configurable per voucher type** (see "Tax settings"). Not decided: the accountant has not been asked. |
| The "2%" FO mentions | **Not in the PMS code.** Probably a card / QRIS fee. Modelled as an optional extra fee on the sale (see below). Confirm what it is. |
| Third parties (agents, companies buying in bulk) | **Not in v1.** |

## Money rule

Selling a voucher is **not revenue**. The hotel has the cash and still owes a stay.

| Event | Journal | Effect |
|---|---|---|
| Voucher sold | Dr bank / cash / QRIS · Cr **Vouchers outstanding** (liability) | Money received. No revenue, no occupancy. |
| Voucher used on a stay | Dr Vouchers outstanding · Cr Guest ledger | The voucher is a payment on the booking. Revenue comes from the normal night-by-night folio posting. |
| Voucher expires unused | Dr Vouchers outstanding · Cr **Voucher breakage income** | One-time income on the expiry date. |
| Voucher voided or refunded (exception) | Dr Vouchers outstanding · Cr cash (if money goes back) | Liability removed. |

**Revenue is the voucher price, not the normal rate.** A voucher sold at Rp 3.000.000 for a
stay whose normal rate is Rp 4.000.000 books the stay at Rp 3.000.000 (the booking's price
is set to what the voucher covers). No discount line, so ADR and revenue show what the
hotel actually earned.

The standard chart already has **250-00-005 Deferred Income (vouchers)** (optional account).
`voucher.liability` maps to it, and it turns on by itself the first time the PMS posts to it
(add the key to `autoCodes`, see `standardChart.js`).

## Tax settings (per voucher type)

Set on the template and **copied onto each voucher when it is sold**, so later changes never
touch vouchers already sold (same idea as an Event's stamped rates).

| Setting | Options |
|---|---|
| Price entered | Including service & tax (all-in) / before service & tax (++) |
| Service charge | Property rate / custom % / none |
| Tax (PPN) | Property rate / custom % / none |
| Tax is charged | **At redemption** / **At sale** |
| Extra fee on the sale (the 2%) | Off, or a label + % + who pays (guest / hotel) |

How the combinations behave (`F` = (1 + service) × (1 + tax) with the stamped rates):

| Price entered | Tax charged | Guest pays at sale | Liability held | Booking price | Voucher covers | Guest pays at the desk |
|---|---|---|---|---|---|---|
| All-in | At redemption | price | price | price | price | nothing |
| Before tax | At redemption | price | price | price × F | price | service + tax |
| All-in | At sale | price | price less its tax part | price | price | nothing |
| Before tax | At sale | price × F | price (net) | price × F | price × F | nothing |

"At sale" rows also book the service / tax part to Service charge payable / Tax payable on the
sale day. When the voucher is used, the voucher payment entry debits that tax part again so
the folio's own tax credit is not double counted. Net effect: tax is recorded on the sale
day, once.

**Build order:** "At redemption" is the default and is built in phase 1. "At sale" is phase 2
(the setting exists from day one, the option is switched on once the accountant confirms).

The extra fee is a separate line on the **sale** only (card / QRIS charge). It is paid on top
of the price, never reduces the stay, and posts as fee income (`voucher.fee`, default
470-60-001 Miscellaneous Income). If the hotel absorbs it, it is not added to what the guest pays.

## Update 2026-11-11 — accountant's answers

- **A voucher carries no tax.** Defaults for a new template: service charge **none**, tax **none**,
  "tax charged at redemption". The guest pays the price, and the stay is **fully covered** for the
  room and meal plan. Extras the guest buys are paid by the guest, at the property's normal rates.
- **How "no tax" is built:** do NOT set the booking's bill rates to 0 (they apply to every folio
  line, extras included). Post the voucher booking's `room` / `fnb` lines with `tax_mode = 'none'`
  (the per-line setting the folio already uses: it adds service + tax only to `added` lines).
  Check `roomChargeService` / `folioService.chargeTotals` at build time; the journal must then show
  no service charge or tax for those nights.
- **Revenue timing:** by the night stayed, as for every booking. The voucher payment moves the
  liability to Advance deposits on the booking day and to Guest ledger on the arrival day (the
  existing journal rule). Accountant to confirm.
- **Tax borne by the hotel** (accountant's earlier "tax as expense" description): not built, since
  the tax is now none. Left as a later template setting (`tax_treatment`) if it ever applies.
  The "at sale" tax timing stays in phase 2 and may never be needed.
- Still to ask the accountant: breakage account / is breakage taxable, and the per-night revenue
  timing above.

## Data model — migration 167

New module `vouchers` (default off, backfilled to every property, add-on tier).

- **`voucher_templates`**: property, name, description, `nights`, `room_type_id`, `rate_plan_id`,
  `max_guests`, `price`, `price_includes_tax`, service mode + rate, tax mode + rate,
  `tax_timing` (`redemption` / `sale`), `fee_label` / `fee_pct` / `fee_payer`, `validity_months`,
  `terms` (text printed on the voucher), `blackout` JSONB `[{ from, to, label }]`,
  `allowed_weekdays` (check-in days), `min_notice_days`, `no_show_consumes` (default true),
  `transferable` (default true), `is_active`, `sort_order`.
- **`vouchers`**: property, `voucher_no` (running, V-0001, advisory lock), `code` (12 characters,
  unambiguous alphabet from `crypto.randomBytes`, globally unique), `template_id`, **`snapshot`
  JSONB** (nights, room type, plan, terms, blackout, rules as sold), the stamped amounts and rates
  (`price`, `covers_amount`, `liability_amount`, `service_amount`, `tax_amount`, `fee_amount`,
  `sold_total`), buyer (`buyer_guest_id` or typed name / email / phone), `recipient_name`,
  `status` (`active` / `reserved` / `redeemed` / `expired` / `voided`), `sold_on`, `sold_by`,
  sale `payment_method` / `received_at` / `reference`, `expires_on`, `booking_id`, `reserved_at`,
  `redeemed_at`, `expired_on`, `void_reason` / `voided_by` / `voided_at`, `refunded_amount`.
- **`voucher_events`**: append-only log (sold, sent, reserved, released, redeemed, extended,
  expired, voided, override).
- `bookings.voucher_id` (FK) and `payments.voucher_id`.
- Payment method **`voucher`** ("Voucher") for the template and every property (same pattern as
  `ota_vcc`, migration 126). Staff never pick it by hand: every place that filters
  `id <> 'ota_managed'` (grep it) must also exclude `voucher`.
- Permission **`vouchers`** (sell, view, resend). Void, extend, refund and rule overrides are
  owner or `corrections`. Templates are owner only.

## Operational flow

1. **Setup (owner):** Sales → Vouchers → Templates. Paste the terms from the current docx.
2. **Sell (FO or sales):** pick a type, buyer (guest picker or typed), recipient, payment method,
   date, reference. The window shows the price, service, tax, fee and total using the stamped
   rules. Saving creates the voucher and its code, then offers **PDF**, **Email** and **WhatsApp**.
   The PDF replaces the docx: branded header, code, QR of the code, what it covers, validity,
   terms printed from the snapshot.
3. **Book with a voucher:** New Booking → **Voucher code** → *Check*. The server validates and
   shows exactly why a code is refused. Checked: status active; expiry (check-in on or before
   `expires_on`); room type and nights as sold; guests within the maximum; **every night** against
   blackout dates; check-in weekday; minimum notice; real availability. On success the booking's
   price becomes what the voucher covers and the rate plan is the voucher's. A manager (owner or
   `corrections`) can override a rule with a reason; it is logged and alerted.
4. **Redeeming:** in the booking's transaction the voucher goes `active → reserved`
   (`UPDATE … WHERE status = 'active'`, so two bookings can never take one code). A received
   payment line with method `voucher` for the covered amount is recorded through the same helper
   that marks room lines received (`folio.payRoomLines`), so status, balance and folio work as
   for any booking. The booking page shows **Paid by voucher V-0001** and Edit History records it.
5. **Check-out:** the voucher goes `reserved → redeemed`. Extras are paid by the guest as normal.
6. **Booking cancelled:** the voucher goes back to `active` and the payment line goes back to
   pending (the same path as Undo payment). The expiry does not move.
7. **No-show:** if the template says `no_show_consumes`, the voucher is consumed (becomes
   `redeemed`). Otherwise it returns to active. A no-show fee does not apply to a voucher booking.
8. **Exceptions (all with a reason, in `voucher_events`):** extend validity, void, resend, replace
   a lost code (voids and re-issues the same terms, no money), change the recipient if
   transferable, refund (owner; creates a refund entry in the books).

Other edits on a voucher booking: Edit Price and Make Complimentary are refused (the price is the
voucher's). Amend Dates re-runs the voucher rules and refuses what breaks them unless overridden.
Change Room to the same room type is free; another type charges the difference through the normal
Change Room flow.

## The books — the risky part

Existing code that must stay in step (the "keep these in step" list):

- `services/dailyClose.js` `collected()`, `services/cashierClosing.js`, `services/journalService.js`
  money checks:
  - **Voucher sale = money received** (union a `vouchers` source in all three: `sold_total` + fee,
    by sale method, by WITA day of `received_at`).
  - **A payment with method `voucher` is not money**: leave it out of `collected()` and Cashier
    Closing totals. Otherwise the same cash is counted at the sale and again at the stay. Cashier
    Closing shows an information line "Vouchers redeemed (not money)". Verify the journal's
    "money received = Daily Close" check skips `pay.voucher`, or it will show a difference.
- **Journal** (`journalService`, nothing stored):
  - New entry *Vouchers sold* on the sale day.
  - New entry *Expired vouchers* on the expiry day (breakage).
  - Redemption is the existing *Money received from guests* path, with `pay.voucher` mapped to
    `voucher.liability` (special-case in `accountForMethod`).
  - New map keys: `voucher.liability` → 250-00-005, `voucher.breakage` → new account
    **470-60-004 Voucher breakage income** (revenue, `rev.misc`; check the number is free in
    `standardChart.js`), `voucher.fee` → 470-60-001.
- **Closed days:** the generic `pendingCorrections` handles a voucher voided after its day closed,
  so it needs no special code. Add a test.
- **Reports:** `getReport` is unchanged, because the sale is never revenue and the stay posts its
  normal revenue. Reports → Money received by method will list voucher sales; the Voucher method
  line must not appear from redemptions.

## Screens

- **Sales → Vouchers** (`/vouchers`, `pages/Vouchers.jsx`, nav item under Sales, `RequireModule
  vouchers`, permission `vouchers`; follow `lib/navItems.js` and `App.jsx`, also
  `SettingsRoles.jsx` `MENU_DEFS` and `AuthContext.jsx` `ORDERED_PATHS`). Tabs: **Vouchers**
  (search by code, buyer or recipient; filters Active / Reserved / Redeemed / Expired / Voided;
  *Sell voucher*), **Templates** (owner), **Report**.
- **Voucher window:** details, the booking it is on, PDF / Email / WhatsApp, history, and the
  exception actions.
- **New Booking:** the Voucher code field with *Check*, and the booking summary showing what the
  voucher pays. Single room in v1. A group booking is refused with a clear message.
- **Booking page:** "Paid by voucher" chip and line.
- **Report:** outstanding liability (count and rupiah by status and by expiry month), sold /
  redeemed / expired in a period, expiring in 30 / 60 days, and a **check line**: outstanding
  total on this page = the ledger balance of `voucher.liability` (when accounting is on). Add it
  to the Reports library and an Excel export.
- **Guide chapter `vouchers`** (ID + EN) in `client/src/guide/` and `index.js`, written for front
  desk: how to sell, how to book with a code, what to do when it is refused.

## Server pieces

- `services/voucherService.js` (templates, sell, `checkStay`, reserve / release / consume /
  expire, extend, void, refund), `services/voucherPdf.js` (pdfkit, shared
  `pdfHeader.drawDocumentHeader`; QR via the `qrcode` package, add it to `server/package.json` if it
  is not there), `routes/vouchers.js` at `/api/vouchers` (`auth` + `moduleGuard('vouchers')` +
  `requireOwnerOrMenu('vouchers')`; the PDF path ends in `/pdf` so the app never caches it).
- `modules.js`: `vouchers: { routes: ['vouchers'] }`; `seedPropertyDefaults.js` DEFAULT_OFF; the
  superadmin `MODULE_LABELS`.
- `bookingCreateService.createBooking` takes `voucher_code` and does steps 3–4 inside the
  caller's transaction. `routes/bookings.js` cancel / no-show / check-out call the voucher hooks.
- Nightly job (cron 03:40 WITA, `jobs/index.js`): mark `active` vouchers with `expires_on` in the
  past as `expired`. Reserved vouchers never expire.
- Telegram, free alert `alert_voucher`: sold, rule override, void, refund. Plus a weekly list of
  vouchers expiring within 30 days (owner and sales). Existing recipients must tick it.

## Phases

**Phase 1 (laptop, this afternoon):** migration 167, module / permission / payment method,
templates, sell with PDF, redeem at New Booking (single room, tax "at redemption"), cancel and
check-out hooks, `collected()` / Cashier Closing / journal changes with the keys, liability
report with its check line.

**Phase 2:** expiry job and breakage entry, void / extend / replace / refund, "tax at sale" journal
(after the accountant), email and WhatsApp send, Telegram alerts, Amend Dates re-check, Guide.

**Later:** group bookings with a voucher per room, value vouchers with partial use, sale through
agents or companies, a public "check my voucher" page, online purchase.

## Acceptance checks (write them as a script before calling it done)

1. Sell → liability +price, no revenue; Daily Close money includes the sale; journal balanced.
2. Book with the code → booking price = covered amount, payment line `voucher`, status confirmed,
   code `reserved`; a second booking with the same code at the same moment is refused.
3. Every refusal reason: expired, wrong room type, wrong nights, blackout on the last night only,
   weekday, minimum notice, too many guests, unavailable, already used, unknown code.
4. Check-out → `redeemed`; Daily Close and Cashier Closing do not count the voucher payment as
   money; the journal's money check still shows no difference.
5. Cancel → back to `active`, payment line pending. No-show with `no_show_consumes` → consumed.
6. Expiry → breakage entry on the right day; liability total = sum of active + reserved vouchers.
7. All four tax combinations: sale amounts, liability, booking price, desk balance, journal
   balanced, folio tax equals the stamped rates. Extra fee on and off.
8. Void after the day was closed → shows as a correction in the next close.
9. Staff without `vouchers` get 403; Edit Price and Make Complimentary refused on a voucher
   booking; module off → 403.
10. Check the PDF as an image, and the screens in headless Chrome at 1366px and 390px.

## To confirm

- **The 2%:** ask FO which payment method it was charged on and what it was called. If it is a card
  fee, the extra-fee setting covers it.
- **Accountant (before launch):** liability until used; PPN at sale or at redemption; the breakage
  account; whether breakage is taxable.
- Bring the current voucher docx so the terms text and layout can be copied.
- Housekeeping after the build: bump "Next migration number" to 168 in `CLAUDE.md` and
  `ROADMAP.md`, add the migration row, the module row, and a short write-up.
