# Kitchen handover — the chef confirms restaurant goods in the POS

Written 2026-11-02. Touches **two repos**: `zahillpms` (PMS) and `zahillpos` (POS). The same file is
in both repo roots. Do the work in the order at the bottom. Follow each repo's CLAUDE.md / house style.
Depends on nothing in PO_FLOW_FIXES_PLAN.md, but if section 3 there (receipts with `received_on`) is
already built, use the receipt date.

## Why

Today, when hotel purchasing receives a restaurant line on a PO in the PMS, `posPurchases.sendToPos`
(PMS) posts it to the POS `POST /api/hotel/purchase-batches`, and `hotelPurchases.receive` (POS) adds it
to stock at once. The kitchen never confirms. If 10 kg is received from the supplier but 9 kg reaches the
kitchen, the POS shows 10 kg and nobody sees where the 1 kg went.

## Decisions (made with the owner — do not change)

1. **Shortfall:** the kitchen stock gets **only what the chef accepted, at the PO unit price**. The rest is
   recorded in the PMS as a **handover shortfall** on the PO line (qty × PO unit cost) — visible, not hidden in food cost.
   The supplier bill is unchanged (the hotel received the full amount from the supplier).
2. **Not confirmed:** **reminders only** — no automatic acceptance. Goods stay out of the POS stock until the chef confirms.
3. **Scope:** restaurant (POS) lines only. Hotel stock items are not part of this.

## Contract between the apps

**PMS → POS** (existing call, one new field):
`POST /api/hotel/purchase-batches { ref, po_number, supplier, received_on, by, section, handover: true, items: [{ inventory_id, qty, total_cost }] }`
- `handover: true` → the POS keeps it **pending** (no stock change). Without the flag (old PMS) → booked at once as today.
- `ref` stays `'<PO line id>:<received so far>'` — still the replay key.
- Response adds `{ pending: true }` when kept pending.

**POS → PMS** (new, POS key auth like the other `/api/pos/*` routes, `prGate` permission set):
`POST /api/pos/purchase-handovers { ref, accepted_qty, note, by, confirmed_at }`
- Idempotent per `ref` (same ref again → 200, nothing changes).
- If the PMS is down when the chef confirms, the POS keeps the confirmation and retries (see POS side).

## PMS side (zahillpms)

Migration (next free number):
```
pos_handovers (id, property_id, po_item_id → purchase_order_items ON DELETE CASCADE, ref TEXT UNIQUE,
  sent_qty NUMERIC(10,3), unit_cost NUMERIC(14,4), sent_at TIMESTAMPTZ,
  accepted_qty NUMERIC(10,3), note TEXT, confirmed_by VARCHAR(120), confirmed_at TIMESTAMPTZ,
  last_reminded_at TIMESTAMPTZ, reminders_sent INT NOT NULL DEFAULT 0)
property_settings.kitchen_handover_reminder_hours INT DEFAULT 3
```
- `posPurchases.send`: include `handover: true`; when the POS answers OK, insert a `pos_handovers` row
  (`sent_qty` = the qty sent, `unit_cost` = the line's unit cost, `sent_at = NOW()`), `ON CONFLICT (ref) DO NOTHING`.
  If the POS answers without `pending` (old POS), set `accepted_qty = sent_qty`, `confirmed_by = 'POS (no handover)'`.
- New route in `routes/posIntegration.js`: `POST /purchase-handovers` → `services/posHandover.js confirm()`:
  find the row by `ref` (404 if unknown), refuse `accepted_qty < 0` or `> sent_qty`; set accepted / note / by / confirmed_at;
  log on the PO (`logEvent`): `Kitchen confirmed <item>: 9 of 10 kg — <note>` (or `… all 10 kg`).
  Shortfall > 0 → send the alert below.
- `getPurchaseOrder`: per restaurant line return `handovers` (sent, accepted, note, by, when) and a summary:
  *Waiting for the kitchen* / *Kitchen got all* / *Kitchen got 9 of 10 kg · <note>* (shortfall in red, with Rp value).
  PO list: badge **Waiting for kitchen** while any handover is unconfirmed.
- Telegram, new alert key **`alert_kitchen_handover`** in `smartReports.js` REPORTS (type alert, Telegram, default roles
  owner + manager, group `purchasing`):
  - **Reminder** — scheduled check every 15 min on the existing alerts/scheduler loop: unconfirmed handovers older than
    `kitchen_handover_reminder_hours`, and `last_reminded_at` null or older than that many hours → one message per
    property listing them (PO, item, qty, sent how long ago, For Kitchen / Resto). Only between 07:00 and 22:00 WITA.
  - **Shortfall** — at confirmation when accepted < sent: item, sent vs accepted, Rp value, the chef's note.
- Settings → Notifications: under the new alert, "Remind after __ hours" (`kitchen_handover_reminder_hours`, 1–24).
- Guides `purchasing.*.md` / `purchase-requests.*.md`: restaurant goods wait for the chef's confirmation in the POS; reminders; shortfall.

## POS side (zahillpos)

Migration (`server/src/db/migrate_<date>_hotel_handover.sql`, wire into `scripts/apply-schema.js` as the others):
```
hotel_deliveries (id, ref TEXT UNIQUE, po_number, supplier, section, received_on DATE, sent_by,
  inventory_id → inventory, qty NUMERIC, total_cost NUMERIC, created_at,
  accepted_qty NUMERIC, note TEXT, confirmed_by, confirmed_at, batch_id → purchase_batches,
  pms_synced_at TIMESTAMPTZ, pms_error TEXT)
```
- `hotelPurchases.receive`: when `body.handover` → insert one `hotel_deliveries` row per item (ref per item:
  `<ref>` when one item, which is what the PMS sends today), **no stock change**, return `{ pending: true }`.
  Same ref again → replay (return the existing row). Without the flag → unchanged behaviour.
- `confirm(deliveryId, { accepted_qty, note }, user)` (route under `/api/inventory/hotel-deliveries`, staff auth,
  same permission as managing inventory / purchases):
  - `0 ≤ accepted_qty ≤ qty`; note required when accepted < qty.
  - In one transaction: if accepted > 0, book a purchase batch exactly as `receive` does today but for
    `accepted_qty` at `total_cost × accepted/qty` (PO unit price) — stock, avg cost, `stockLedger.record`,
    `restock_history`, `hotel_ref = ref`, note `Bought by the hotel — PO · supplier · for Kitchen` + `· 9 of 10 accepted` when short.
    Accepted 0 → no batch. Mark the delivery confirmed.
  - After commit: `pms.confirmHandover({ ref, accepted_qty, note, by, confirmed_at })` (new in `pms.js`).
    On failure keep `pms_error`; a retry loop (every 5 min, and on server start) resends unsynced confirmations.
- `GET /api/inventory/hotel-deliveries?status=pending|recent` for the screen.
- Client (`App.jsx`, Inventory page): new tab **📦 Incoming** next to the hotel requests tab, with a count badge
  (also on the Inventory nav item). Grouped by PO, For Kitchen / For Resto label, sent qty and unit, how long ago.
  Per line: qty received (prefilled with the sent qty), note, **Confirm**; plus **Confirm all as sent** per PO.
  Confirmed ones move to a "Recent" list (accepted vs sent, by, when). A banner on the Inventory page while
  anything is waiting: "N deliveries from purchasing waiting for you to check".
- Purchase history: a hotel batch made from a short handover shows "9 of 10 accepted".

## Order of work

1. POS: table + `receive` with `handover` flag + confirm + Incoming tab + PMS sync (old PMS keeps working — no flag).
2. PMS: `pos_handovers` + send the flag + `/api/pos/purchase-handovers` + PO display + alert/reminder + setting.
3. Deploy POS first, then PMS.

## Acceptance checks

1. PMS receives 10 kg chicken (For Kitchen) → POS stock unchanged; Incoming shows 10 kg; PO shows *Waiting for kitchen*.
2. Chef confirms 9 kg with note "1 kg spoiled" → POS stock +9 at the PO unit price, avg cost right; PMS PO line shows
   "Kitchen got 9 of 10 kg · 1 kg spoiled" with the Rp value; shortfall Telegram sent; supplier bill unchanged.
3. Confirm all as sent → stock +10, PMS shows *Kitchen got all*, no shortfall alert.
4. Unconfirmed for 3 h (setting 3) → one reminder; again 3 h later if still waiting; none at night (22:00–07:00 WITA).
5. PMS sends the same ref twice → one delivery. Chef confirms while the PMS is down → POS stock updated,
   confirmation reaches the PMS after it is back; confirming twice changes nothing.
6. Old PMS (no flag) against new POS → booked at once as before. New PMS against old POS → stock booked, PMS marks the handover as confirmed by "POS (no handover)".
7. Accept 0 → no batch, full shortfall recorded. Accept more than sent → refused.
