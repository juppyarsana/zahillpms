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

## Buy without a PO

For stock bought at the market or a shop, with no purchase order. You need **Purchasing** or the **Buy without a PO** permission.

1. **[Operations → Purchasing](/purchasing)** → **Bought without a PO** → **+ Buy without a PO**.
2. **Bought from**: a regular supplier from the list, or leave *Not a regular supplier* and type where (e.g. Pasar Kintamani).
3. **Date bought** = the date on the receipt. **Receipt / nota number** if it has one.
4. **What it is for** (Food, Drinks, Guest supplies…) and the **Department** (fills itself in).
5. One line per item: the **stock item**, **how many** (in its unit — kg, pcs…) and the **price paid** for that line, as on the receipt. The price per unit is worked out, with the item's usual price next to it (red when it is 20% or more above).
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
