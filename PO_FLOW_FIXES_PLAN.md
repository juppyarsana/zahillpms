# Purchase Order flow — fixes & additions

Reviewed 2026-11-02. Scope: the PO flow only (Purchasing → Purchase Orders, receiving,
Telegram approval, Make bill). "Buy without a PO" is untouched except where it shares code
(`nextPoNumber`). Follow CLAUDE.md house conventions (service holds transactional logic,
`logEvent` on every milestone, bilingual guides, additive migrations).

Next migration: **151_po_flow_fixes.sql** (last one is 150).

## Decisions already made (do not change)

- Receiving and billing always use the **PO price**. No actual-price entry at receiving.
- Receiving keeps the current **Purchasing** permission. No new "receive" permission.
- Approving stays tied to the **`approve_po` permission**. Do not block self-approval.
- New: **auto-approve limit** is a property **setting**, off by default.
- New: receiving records a **received date** and the **supplier's delivery note number (surat jalan)**.

---

## 1. Block cancelling a PO once anything was received  (bug)

Today `approved → cancelled` is allowed even after partial receipt. Stock stays in, but every
purchase-request query ignores cancelled POs, so the request shows those items as unordered
again (they can be ordered twice), and `payablesService.fromPurchaseOrder` still bills it.

- `purchasingService.setPurchaseOrderStatus`: when `newStatus === 'cancelled'` and any line has
  `received_quantity > 0` → error `"Some goods already came in — use Close (rest won't come) instead"`,
  code `RECEIVED`.
- `payablesService.fromPurchaseOrder`: refuse `status = 'cancelled'` (409).
- Cancel needs a **reason** (required, ≤ 255 chars): store on `purchase_orders.cancel_reason`,
  log `Cancelled: <reason>`. PMS: small reason prompt modal (not `window.prompt`).
- Telegram "Send back" stays as is (no reason).
- PMS "Back to Draft": optional reason → log `Reverted to draft: <reason>`.

## 2. Close short — "Close – rest won't come"  (bug: PO stuck open)

New PO status **`closed`** for an approved PO where part was received and the rest won't come.

Migration:
- Extend `purchase_orders.status` CHECK with `'closed'`.
- `purchase_orders`: `closed_at TIMESTAMPTZ`, `closed_by UUID → users`, `close_reason TEXT`, `cancel_reason TEXT`.
- `purchase_order_items.short_qty NUMERIC(10,3) NOT NULL DEFAULT 0` (what will never come).

Service `closePurchaseOrder(propertyId, poId, reason, userId)` (route `POST /purchase-orders/:id/close`, Purchasing):
- Only from `approved`, needs ≥ 1 line with `received_quantity > 0` (nothing received → use Cancel), reason required.
- In one transaction: `short_qty = quantity - received_quantity` per line, status `closed`, log
  `Closed — not coming: <item ×qty, …>. Reason: …`, then `purchaseRequestService.refreshAfterReceive`.
- Not allowed in the generic status PATCH (`STATUS_TRANSITIONS` unchanged except no path to `closed`).

Purchase requests must treat the short quantity as **not ordered** (the request stays open and
shows it as left to order; purchasing can re-order it or close the request):
- `LINES_SQL` `ordered_qty`: `SUM(i.quantity - i.short_qty)` (still excluding cancelled).
- `onOrder`: PO part uses `i.quantity - i.short_qty - i.received_quantity > 0`; request part uses `SUM(i.quantity - i.short_qty)`.
- `refreshAfterReceive`: unchanged (it compares received vs requested).

UI (`BackOffice.jsx`):
- `PO_STATUS_LABELS.closed = 'Closed (short)'`, badge colour, status filter option.
- Approved PO with some received: button **Close – rest won't come** → reason modal.
- Detail table: show short qty per line ("2 not coming") and the close reason.
- Make bill works on `closed` POs exactly as on `received`.

## 3. Receiving: received date + delivery note  (decision 2)

Migration:
```
purchase_order_receipts (id, purchase_order_id → CASCADE, property_id, received_on DATE NOT NULL,
  delivery_note VARCHAR(100), created_by → users, created_at)
purchase_order_receipt_lines (id, receipt_id → CASCADE, po_item_id → purchase_order_items, quantity NUMERIC(10,3))
```
- `receivePurchaseOrder(propertyId, poId, { received_on, delivery_note, items }, userId)`:
  `received_on` defaults to today (WITA, `todayWITA()`), may not be in the future; delivery note optional.
  Insert one receipt + its lines in the same transaction. Log
  `Received <items> on <date> · surat jalan <no>`.
- `getPurchaseOrder`: return `receipts` (date, note, by, lines) and show them as a "Deliveries" list in the PO detail.
- `ReceiveModal`: add **Date received** (date input, default today) and **Delivery note no.** fields.
- `posPurchases.send`: use the latest receipt's `received_on` for `received_on` instead of today
  (fallback today).
- Make bill (`fromPurchaseOrder`): also return the delivery notes and latest received date, so the
  bill form can prefill supplier ref / bill date (check what `Payables.jsx` `from_po` prefill accepts and wire it).

## 4. Refuse over-receiving instead of silently trimming

`receivePurchaseOrder` currently clamps to outstanding. Change to: any line with
`receive_quantity > outstanding` (beyond rounding, e.g. 0.0005) → 400
`"<item>: only <outstanding> still to come"`. Products: refuse non-whole numbers instead of
`Math.floor`. `ReceiveModal`: `max` on inputs + inline red text.

## 5. PO numbers: no clashes, WITA month  (bug)

`nextPoNumber` (shared with directPurchaseService):
- `SELECT pg_advisory_xact_lock(hashtext('po_no:' || $1))` with the property id first.
- Prefix from the WITA date (`todayWITA()` from roomChargeService), not `new Date()` in Node's TZ.
- Next number = `MAX` of the numeric suffix for that prefix + 1 (not `COUNT`).

## 6. Exact line totals for kg/L prices  (bug)

Prices typed per kg/L are converted to per g/ml and rounded to 2 decimals, so totals drift.
- Migration: `purchase_order_items.unit_cost` → `NUMERIC(14,4)`.
- PO create/edit: accept `line_total` per line (client sends quantity-as-typed × price-as-typed);
  server stores it (`line_total` column already exists from migration 135). Fallback
  `round2(quantity × unit_cost)` when absent. `total_amount = SUM(line_total)`.
- Everywhere a PO line amount is shown or billed, use `line_total`
  (`fromPurchaseOrder`: `round2(line_total × received_quantity / quantity)`; PO detail "Line total"; Telegram already prefers `line_total`).
- `NewPOModal` and `EditPOModal`: send `line_total`.
- Existing rows: backfill `line_total = round2(quantity × unit_cost)` where null.

## 7. "Not billed" indicator

- `listPurchaseOrders`: add `received_value` (sum of received line value) and `billed_amount`
  (non-voided `supplier_bills` for the PO), only for non-direct POs.
- PO list: badge **Not billed** / **Part billed** on received/closed/approved-with-receipts POs when
  billed < received value. Show only when the user `can('payables')` and the accounting module is on.
- Add filter option "Not billed yet".
- CSV export: add `Direct` and `Billed` columns.

## 8. Auto-approve limit setting  (decision 5)

Migration: `property_settings.po_auto_approve_below NUMERIC(14,2)` (NULL/0 = off, every PO needs approval).
Extend `purchase_orders.approved_via` CHECK to include `'auto'`.

- On **Submit for Approval** (`setPurchaseOrderStatus` → `pending_approval`): if the limit is set
  and `total_amount < limit`, go straight to `approved` with `approved_via = 'auto'`,
  `approved_by_name = 'Auto (under Rp X)'`, `approved_at = NOW()`; log
  `Submitted and approved automatically — under the Rp X limit`. No Telegram approval message.
- Settings UI: next to the "Purchases without a PO" amounts in **Settings → Notifications**
  (`SettingsReports.jsx`, same save path as `direct_purchase_alerts`), a field
  **"Approve purchase orders automatically under Rp ___"** with hint "Leave empty: every PO needs approval".
  Owner only.
- PO detail: "Approved automatically (under Rp X)".

## 9. Small fixes

- `routes/purchasing.js` PATCH `/purchase-orders/:id/status`: move the `is_direct` lookup inside the `try`.
- `updatePurchaseOrderItems`: recompute `department` with `poDepartment` when lines change (keep a chosen one).

## 10. Guides

Update `client/src/guide/purchasing.en.md` + `.id.md` and `purchase-requests.en.md` + `.id.md`:
Close (rest won't come), cancel needs a reason and is refused after receiving, date + surat jalan on
receiving, over-receiving refused, Not billed badge, auto-approve limit.

## 11. Printable receiving checklist (PDF)

For checking a supplier's delivery on paper before it is entered, and for the handover of
restaurant goods to the kitchen / resto. Reuse the stock opname count-sheet pattern
(`services/stockExport.js` + `pdfHeader.drawDocumentHeader`, opened with the same `openPdf` blob helper as `Stock.jsx`).

- Route `GET /api/purchasing/purchase-orders/:id/checklist` (Purchasing), new `services/poChecklistPdf.js`, A4 portrait.
- Allowed for `approved`, `received`, `closed` POs (not draft / pending / cancelled / direct).
- Header: property, **Receiving checklist**, PO number, supplier, approved date, printed at; blank lines to
  fill: **Date received ____  Surat jalan no. ____** (match the receive fields of section 3).
- Rows: No · Item · Unit · **Still to come** (quantity − received − short, so a second delivery prints only what
  is outstanding; lines fully in are left out, with "N lines already received" under the table) ·
  blank **Qty received** · blank **OK / Damaged / Wrong** · blank **Note**. Quantities in kg / L for g / ml items, like the screens.
- **No prices** anywhere on the sheet.
- Lines grouped: Hotel stock · Not kept in stock · **Restaurant — For Kitchen** · **Restaurant — For Resto**
  (restaurant without a section → "Restaurant").
- Footer: **Received from supplier by** (name, signature) · **Checked by** (name, signature).
- When the PO has restaurant lines, an extra block: **Handed to kitchen / resto** — by (purchasing), received by
  (chef), date & time, signatures. (The chef's count itself is confirmed in the POS — see KITCHEN_HANDOVER_PLAN.md.)
- UI: **🖨 Print checklist** button in the PO detail for those statuses; after approving in the PMS the success
  toast offers it too.
- Guides: mention it in the receiving part of `purchasing.*.md` and `purchase-requests.*.md`.

Acceptance: approved PO with hotel + kitchen + resto lines prints grouped, no prices; after a partial
receive it prints only what is still to come; a draft PO → 409; PDF looked at as an image.

## 12. The PO for the supplier: PDF + Send by email / WhatsApp / Download

A formal PO document **with prices** for the supplier, and three ways to get it to them.
Only for `approved`, `received` and `closed` POs (not draft / pending / cancelled / direct purchases).

### The PDF — `services/poPdf.js`, A4 portrait, shared `pdfHeader.drawDocumentHeader`
- Title **PURCHASE ORDER / PESANAN PEMBELIAN** (labels bilingual EN / ID throughout — suppliers are local).
- PO number, PO date (= `approved_at`, WITA), payment terms (supplier `payment_terms_days` → "30 days" / "Cash"),
  needed by (earliest `needed_by` of its purchase requests, if any).
- **Supplier** block: name, contact name, phone, email, address. **Deliver to**: property name, address, phone.
- Lines: No · Item · Qty · Unit · Unit price · Amount (`line_total` from section 6; kg / L for g / ml items, price per kg / L).
  Total at the bottom. **No internal details**: no PR numbers, no For Kitchen / Resto, no "usual cost" warnings.
- PO notes (if any), "Approved by <name>", and the line *"Please put this PO number on your delivery note
  (surat jalan) and invoice."*
- Route `GET /api/purchasing/purchase-orders/:id/pdf` (Purchasing) — inline, filename `PO-2611-004.pdf`.

### Public link (needed for WhatsApp — wa.me cannot attach a file)
- Migration: `purchase_orders.share_token VARCHAR(64)` (random, 32 bytes base64url, made the first time it is sent),
  `sent_to_supplier_at TIMESTAMPTZ`.
- Public route, no login: `GET /po/:token` (mounted outside `/api`, rate-limited like other public routes) → the same PDF.
  Unknown token → 404. PO cancelled afterwards → a one-page PDF "This purchase order was cancelled" instead of the PO.
  Link stops working 90 days after `approved_at`.

### Buttons in the PO detail (`BackOffice.jsx`)
A **Send to supplier** group, shown for the statuses above:
1. **✉ Email** — enabled only when the supplier has `contact_email` (else disabled, tooltip
   "Add the supplier's email in Suppliers"). Opens a small window: To (prefilled, editable — saving a corrected address
   back to the supplier is a checkbox), CC (optional, default the property's own email), subject
   `Purchase Order PO-… — <property name>`, a short editable message. Send → `POST /purchase-orders/:id/send-email`
   → `mailer.resolveSmtp(property_settings)` (same two-tier SMTP as guest emails), PDF **attached**,
   reply-to = the property's email. Errors (no SMTP, rejected address) shown as they are; nothing logged as sent.
2. **WhatsApp** — enabled only when the supplier has `contact_phone`. Normalise the number to 62… the same way
   `BookingDetail.jsx` does for guests (move that helper to `client/src/lib/` and reuse). Opens
   `https://wa.me/<number>?text=<message>` in a new tab — on a phone this opens the WhatsApp app, on a computer
   WhatsApp Web / Desktop. Message (Indonesian): greeting with the contact name, "Berikut PO <no> dari <property>
   — total Rp …", the public link, "Mohon cantumkan nomor PO di surat jalan dan invoice. Terima kasih."
   The server makes the token first: `POST /purchase-orders/:id/share-link` → `{ url, message }`.
3. **⬇ Download PDF** — opens / downloads the PDF to send any other way.

- Each send is logged on the PO (`logEvent`): `Sent to supplier by email to a@b.com`, `WhatsApp opened for +62…`,
  `PDF downloaded`. Email or WhatsApp sets `sent_to_supplier_at` (first time only); the PO list shows a small
  **Sent** badge on approved POs that have it and a "Not sent yet" filter.
- After approving in the PMS, the success toast offers **Send to supplier**.
- Telegram approval: when a PO is approved on Telegram, the approval reply adds "Send it to the supplier from the PMS".
  (No sending from Telegram.)
- Suppliers tab: show a hint on suppliers with neither email nor phone ("can only be sent by download").
- Guides `purchasing.*.md`: a short "Sending the PO to the supplier" part.

Acceptance: approved PO → PDF has supplier, deliver-to, lines with prices, total, no internal labels; email arrives with
the PDF attached and reply-to the hotel; supplier without email → Email disabled; WhatsApp opens wa.me with the
number in 62… form and a link that opens the PDF without logging in; the link of a cancelled PO shows "cancelled";
a random token → 404; draft PO → the buttons are not shown and the routes return 409; each send appears in Activity.

## Acceptance checks

1. Approve a PO, receive part, press Cancel → refused with the Close hint. Close with reason →
   status Closed (short); request shows the missing qty as left to order; Make bill bills only what came in.
2. Cancel a PO with nothing received → needs a reason; request lines become free again.
3. Two POs created in parallel (script, 10 concurrent) → all get distinct numbers, no 500.
   A PO created at 01:00 WITA on the 1st gets the new month's prefix.
4. Line typed as 7 kg × Rp 12,345/kg → line total and PO total Rp 86,415 exactly; bill the same.
5. Receive with date yesterday and surat jalan "SJ-123" → shown in Deliveries and activity log; future date refused.
6. Receive 12 of 10 outstanding → refused with "only 10 still to come".
7. Limit Rp 500,000: submit a Rp 400,000 PO → approved automatically, no Telegram message;
   a Rp 600,000 PO → pending approval and Telegram as today. Limit empty → all pending.
8. Received PO with no bill shows **Not billed**; after Make bill for the full amount the badge goes.
9. Restaurant (POS) lines: receive, close short, re-send to POS all still work; POS gets the receipt date.
10. Existing POs (pre-migration) still open, show correct totals, and bill correctly.
11. Receiving checklist — see the acceptance line in section 11.
12. Supplier PO PDF and sending — see the acceptance line in section 12.
