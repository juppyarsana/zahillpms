# Purchase requests

A department asks for what it needs; **purchasing** orders it. It is the first tab of **[Operations → Purchasing → Requests](/purchasing?tab=requests)** — the buying cycle reads left to right: Requests → Purchase Orders → receiving. A department head with only the *Purchase requests* permission sees the menu item **Purchase requests**, which opens the same list.

- To **ask**, you need the **Purchase requests** permission.
- To **order**, decline or close a request, you need **Purchasing**. Owners have both.

## Asking (any department)

1. **+ New request**, or **🛒 Request to buy** on the Stock page (it starts with every item that is low or out).
2. Choose your **department**, and the date you need it by if there is one.
3. Add the items. Pick them from the stock list (it shows how much is left), or choose **Something else — type it** for anything not in the list (a spare part, a tool).
4. **Send to purchasing**. Purchasing gets a Telegram message.

Your request then shows how far it has got: **Waiting** → **Ordered** → **Partly received** → **Received**. It shows **Closed** or **Declined** with purchasing's reason if not everything will be bought. While nothing is ordered yet you can still **Cancel** it.

## The restaurant asks from its own app

The kitchen's ingredients are kept in the **restaurant app (POS)**, because its recipes take them off at each sale. The chef asks from there: **Inventory → Request to buy**. The request arrives here tagged **Restaurant app**, and the chef follows it in the POS.

## Ordering (purchasing)

1. **To order** lists every item still to order, from all open requests (**All requests** shows each request whole). Tick the items to buy. You can tick items from several requests if they come from one supplier.
2. **Make purchase order** → choose the supplier, check how many, and type the prices.
   - For an item that was typed in (not in the list), choose to buy it as typed (kept in no stock), or add it to a stock item.
3. A **draft PO** is made on the **[Purchase Orders](/purchasing?tab=purchase_orders)** tab. Submit and approve it as usual. The request shows the PO number.

**Approving on Telegram.** When a PO is submitted for approval, everyone with *Approve purchase orders* ticked in **[Settings → Notifications](/settings/reports)** (personal chats only) gets it on Telegram: supplier, every item with its price, and the total. A price well above the item's usual cost is marked ⚠️. A long PO comes in several messages, and the **✅ Approve / ↩️ Send back** buttons are under the total in the last one. The first person to press decides. The others' buttons disappear, with a line saying who did it. *Send back* returns the PO to draft: open it in **Purchase Orders** → **✏ Edit** (quantities, prices, supplier, add or remove lines), then **Submit for Approval** again. The PO in the PMS shows "by … on Telegram".

An item can go on more than one PO (split over suppliers). The request shows what is not ordered yet.

## Receiving

Receive the goods on the PO as usual (**Receive Items**).

- **Hotel items** go into the PMS stock.
- **Restaurant items** go into the **restaurant's stock in the POS**, at the PO's price, so its food cost is right. The PMS stock is not touched.
- If the POS could not be reached, the PO line says *Not sent to the POS*. Press **Send to the POS** on the PO once it is back. Sending again never adds the goods twice.

A request is **Received** by itself once everything on it has come in. If something will not be bought, **Close** it with the reason.

**Make bill** on the PO starts on the department of the request, so Costs by department stays right.
