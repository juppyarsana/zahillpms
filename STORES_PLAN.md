# Stores — plan (2026-11-06)

Purchasing staff and the owner want stock kept **per store**: Main Store, Kitchen,
Resto, Engineering, Housekeeping. Everything bought goes into Main Store first, and
items are moved from there to the store that uses them. Example: 10 orange syrups
come in → Main Store. The bar has little room, so only 3 go to Resto and 7 stay in
Main Store.

## Decisions (owner, 2026-11-06)

| Question | Answer |
|---|---|
| Engineering / Housekeeping | **Counted stores.** They hold stock, count it at stock opname and record what they use. |
| Who confirms a transfer | **The receiving store.** Stock leaves Main Store when sent and counts in the receiving store only after it is confirmed (like the kitchen handover). |
| Receiving from a supplier | **Main Store by default.** Purchasing can pick another store (e.g. fresh vegetables straight to Kitchen). |
| Which department pays | **At purchase, as now.** The PO / bill department. Costs by department and the books don't change. |
| Kitchen vs Resto in the POS | **Stays one figure per item** in the POS. The split is the existing Kitchen / Resto mark on requests and handovers. |

## Where each store lives

| Store | App | Why |
|---|---|---|
| Main Store | PMS | Purchasing and receiving are in the PMS |
| Engineering | PMS | |
| Housekeeping | PMS | |
| Kitchen | POS | Recipes and Kitchen use take stock off there |
| Resto | POS | Same POS stock figure as Kitchen, marked Resto |

Kitchen and Resto are rows in the PMS's store list (so they can be picked when
receiving or as a transfer target), but their quantities live in the POS. Sending
to them is today's "send to the POS" + kitchen handover.

## Data (migration 156)

- `stores` (property, name, `kind` main / pms / pos, `section` kitchen / resto for
  the POS ones, sort order, is_active). Seeded per property with the five above.
  Exactly one `main` per property.
- `store_stock` (store, item kind `rm` / `p`, item id, quantity) — the quantity
  per PMS store. **`raw_materials.stock_quantity` / `products.stock_quantity` stay
  as the total over the PMS stores**, kept equal by the same code that writes
  `store_stock` (one helper, `moveStock`). So everything that reads the total
  today keeps working: Stock value, Cost of sales `fnbValueAt`, low stock,
  Sales deducting a tracked product, Inventory value.
- Every movement row (`raw_material_movements`, `stock_movements`) gets a
  `store_id`. A transfer writes two rows (out of one store, into another) with
  reason `transfer`, which nets to zero in the total.
- `raw_materials.pos_item_id` — a PMS item that stands for a POS item, so Main
  Store can hold restaurant goods. Made by itself the first time a POS item is
  received into Main Store (name, unit, food / drink from the POS item).
- `stock_transfers` (TR-0001, from store, to store, sent by / at, note, status
  sent / confirmed / cancelled) + `stock_transfer_lines` (item, sent qty, unit
  cost = Main Store average when sent, accepted qty, note, confirmed by / at).
- `stock_opnames.store_id` — one open opname per store instead of per property.
- Deploy: every item's current stock goes into Main Store.

## Flows

**Receiving a PO / Buy without a PO.** The Receive window gets a *Store* per line,
default Main Store.
- PMS item → that store.
- POS item into Main Store → its PMS mirror item (made if missing), Main Store
  quantity and average cost. Nothing goes to the POS yet.
- POS item into Kitchen / Resto → today's flow: sent to the POS, waits in Incoming.

**Transfer.** Stock → *Move stock*: from store, to store, items + quantities.
- Leaves the sending store at once (`in transit`).
- To a PMS store (Engineering / Housekeeping / back to Main Store): that store
  confirms in the PMS (received quantity, note required when short).
- To Kitchen / Resto: sent to the POS as a purchase batch with handover, at Main
  Store's average cost, ref = the transfer line. The chef / bar confirms in POS
  Incoming exactly as today; the PMS hears back through the existing handover call.
- A shortfall goes back to the sending store, with the note (most often a
  miscount when sending; a real loss shows at the next opname).
- The sender can cancel a transfer nobody has confirmed yet; the stock goes back.

**Adjust, opname, usage, stock value** — the Stock page gets a store picker.
- Adjust: per store.
- Opname: per store; expected = that store's quantity.
- Usage: one store, or all PMS stores (transfers between them net out); a single
  store's view shows transfers in / out as their own columns.
- Stock value: by store, plus goods in transit.

**Purchase requests.** Low stock and "already on order" are judged on Main Store
+ the PMS stores, as today on the total. The POS's Request to buy shows how much
of each item is in Main Store, so the bar asks for a transfer rather than a purchase.

**Money.** Unchanged: cost is booked at purchase to the PO / bill department. A
transfer is never a purchase (the POS batch it creates already books no POS
expense). Cost of sales must count goods in transit at Main Store's cost, or they
drop out of the month-end stock value.

## Permissions

- `stock` — every store: move, adjust, opname, confirm.
- New `store_transfers` ("Receive transfers") — for HK / Engineering heads:
  see their stores' stock, confirm transfers coming in, count their store's
  opname. Which stores a role covers is ticked in Roles & Permissions.

## Order of work

1. **Stores + Main Store (PMS only)** — built 2026-11-06 (migration 156). The store list is managed from Stock → Stores (owner), not Settings. Migration, store list in Settings, stock per
   store on the Stock page, Receive / Buy without a PO into a PMS store, adjust and
   opname per store. Restaurant goods still go straight to the POS.
2. **Transfers between PMS stores** — built 2026-11-06 (migration 157); `store_transfers` covers every store for now (no per-role store list yet). (Main → HK / Engineering) with confirmation,
   `store_transfers` permission, Telegram alert for transfers waiting.
3. **Restaurant goods through Main Store.** Mirror items, receiving POS items into
   Main Store, transfers to Kitchen / Resto through the POS handover, Main Store
   quantity in the POS's Request to buy, in-transit in Cost of sales.
4. **Later, if asked:** stores asking Main Store for items (a pull request), not
   just Main Store sending.

## Not changing

Suppliers, PO approval, sending POs to suppliers, Payables, the journal, POS recipes,
sales and Kitchen use, the Kitchen / Resto split inside the POS.
