# Buying: which page to use

Every cost goes in **one** place only. Two questions decide which:

1. **Does it add stock?** (rice, eggs, vegetables, bottled water, soap… — the things on **[Operations → Stock](/stock)**)
2. **Has the money already left the cash box or the bank?**

| | Paid now | Paid later |
|---|---|---|
| **Adds stock** | **Purchasing → Bought without a PO**, *Paid already* (or a purchase order) | **Purchasing → Bought without a PO**, *Pay later* (or a purchase order → **Make bill**) — then pay it in **Payables** |
| **No stock** (internet, water, repairs, laundry…) | **[Finance → Expenses](/expenses)** | **[Finance → Payables](/payables)** → New bill |

Three rules:

- **Payables is where every bill paid later is paid**, wherever the bill came from.
- **Expenses holds every cost paid on the spot.** A stock purchase paid already shows up there by itself (marked with its PO number) — don't type it again.
- **Never record the same receipt twice.** If it went through Purchasing, it doesn't also go into Expenses or Payables.

A receipt with stock and other things on it (e.g. eggs and gas): the eggs in *Bought without a PO*, the gas in Expenses, with the same receipt number on both.

## Purchase orders: from approval to the bill

1. **Approve.** Every PO needs approval, in the PMS or on Telegram.
2. **Send it to the supplier.** Open the approved PO → **Send to supplier**:
   - **✉ Email**: the PDF is attached and replies come back to the hotel. Needs the supplier's email.
   - **WhatsApp**: opens WhatsApp with the message typed and a link to the PDF. **Press send there.** The PO shows *Sent* as soon as WhatsApp opens, so check it really went. Needs the supplier's phone.
   - **⬇ Download PDF**: to send it any other way. This does not mark the PO as sent.
   The list has a *Not sent yet* filter. The supplier's link stops working after 90 days. If the PO is cancelled, the link says so, but **you still need to tell the supplier**.
3. **Check the delivery on paper (optional).** **🖨 Print checklist** lists what is still to come, without prices, with boxes to tick and signature lines.
4. **Receive.** **Receive Items** → **Date received**, **Delivery note no.** (surat jalan), and how many came. You can't receive more than is still to come. The date is only a record: the stock moves when you confirm, so enter deliveries on the day they come. Each delivery is listed under **Deliveries** on the PO.
5. **Bill.** **Make bill** starts with what came in, at the PO's price, with the surat jalan and the date filled in. Once everything that came in is billed, the button goes and **View bill** opens the bill, paid or not.

**Not billed / Part billed.** A PO with goods in and no full bill shows this badge, and the list has a *Not billed yet* filter. If the supplier's bill really is lower (a discount, say), press **Mark as fully billed** with the reason. POs received before this feature don't show the badge.

**The rest isn't coming.** On an approved PO with some goods in, press **Close – rest won't come** with the reason. What came in stays. What is missing goes back on its purchase request as not ordered, so you can order it again or close the request.

**Cancel** needs a reason, and only works while nothing has come in. After that, use Close.

## Buy without a PO

For stock bought at the market or a shop, with no purchase order. You need **Purchasing** or the **Buy without a PO** permission.

1. **[Operations → Purchasing](/purchasing)** → **Bought without a PO** → **+ Buy without a PO**.
2. **Bought from**: a regular supplier from the list, or leave *Not a regular supplier* and type where (e.g. Pasar Kintamani).
3. **Date bought** = the date on the receipt. **Receipt / nota number** if it has one.
4. **What it is for** (Food, Drinks, Guest supplies…) and the **Department** (fills itself in).
5. One line per item: the **stock item**, **how many** and the **price paid** for that line, as on the receipt. Items kept in g or ml are typed in **kg or L** (switch next to the box). The price per unit is worked out, with the item's usual price next to it (red when it is 20% or more above).
   - For the kitchen or bar, choose kind **Restaurant (POS)**: the goods wait in the POS for the chef to confirm, then go into the restaurant's stock, not the PMS. Once the POS has them the purchase can't be voided — the chef corrects the POS stock with a stock opname. If the POS couldn't be reached, open the purchase and press **Send to the POS**.
6. **The money**:
   - **Paid already** → choose **Paid with** (Cash…). It goes into Expenses by itself.
   - **Pay later** → needs the supplier. A bill is made in Payables, due by the supplier's terms (or type a due date). Pay it there when the money goes out.
7. **Save**.

Saving adds the stock and updates each item's average cost (**Stock → Stock value**), exactly like receiving a purchase order.

The PMS asks when the same receipt number is already recorded.

## Mistakes

Open the purchase → **Void…** with a reason. The stock is taken back out and its expense or bill is voided. Then enter it again correctly.

- Refused when the stock has already been used (less is left than was bought) — correct it first with **Stock → Adjust** or the stock opname if it really was used.
- Refused when something is already paid on its bill — void that payment in Payables first.

Its expense and bill can't be changed or voided in Expenses / Payables — always here, so the stock follows.

## Telegram and the Daily Close

The owner gets a Telegram message only when a purchase needs a look: a big amount, a price well above the item's usual price, a date well in the past or on a day already closed in Accounting — and when one is voided. The amounts are set in **Settings → Notifications → Purchases without a PO**. Every purchase is counted in the Daily Close.
