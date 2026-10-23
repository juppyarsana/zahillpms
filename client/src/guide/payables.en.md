# Payables — supplier bills

**[Finance → Payables](/payables)** keeps the bills suppliers send and what the hotel still owes them. You need the **Payables** permission (owners always have it).

**Payables or Expenses?** Ask: *has the money already left the cash box or the bank?*

- **No, the hotel still owes it** → **Payables**. Record the bill on the day it **arrives**, then press **Pay** on that same bill on the day the money goes out — never an expense for it.
- **Yes, it is already paid** → **[Expenses](/expenses)**. One line, nothing owed.
- A proper invoice from a regular supplier that is already paid may also go here with **Paid already** ticked — it keeps that supplier's history in one place. The books come out the same either way; just never both.
- **Stock** (rice, eggs, bottled water…) goes through **Purchasing & Stock** instead, so the stock goes up — see [Buying: which page to use](/guide/purchasing). A stock purchase paid later makes its bill here by itself (marked with its PO number); change or void it in Purchasing & Stock.

## Record a bill

1. **New bill**.
2. Choose the **Supplier** (or **+ New supplier…** at the bottom of the list).
3. **Their invoice number**, as printed on the bill.
4. **Bill date** = the date on the bill. The **Due date** fills itself in from the supplier's payment terms (you can change it).
5. **What it is for** (Food, Drinks, Laundry, Utilities, Maintenance…) — the same list as Expenses. It fills itself in when the supplier has a usual category.
6. **Department** — who the cost was for (Front Office, Housekeeping, F&B, Engineering / Maintenance, Activities, Sales & Marketing, Admin & General). It fills itself in from the supplier or the category; change it when needed (e.g. a repair of the kitchen stove = F&B).
7. **Amount** = the total on the bill, tax included.
8. **Save bill**.

**Paid before you entered it?** (e.g. the supplier was paid at delivery and the invoice reached the office later) Tick **Paid already** before saving, choose **Paid with**, the **Date paid** (the day it was really paid) and a transfer reference if there is one. The payment is recorded with the bill, so it is paid at once and never shows as owed.

A bill that mixes things (e.g. a market bill with food and soap): choose what most of it is, or record it as two bills.

The PMS warns you when the same invoice number of that supplier is already recorded.

> Food and drinks bought for the store go straight to cost. At month end the accountant adjusts for what is still in the store with one journal entry.

## From a purchase order

On a received purchase order (**Operations → Purchasing & Stock → Purchase Orders**) press **Make bill**. The supplier and the amount are filled from what was received and not billed yet (the items go in the notes). Add the invoice number, correct the amount if the bill differs, then save.

## Pay a supplier

1. **Pay a supplier** (or **Pay** on the supplier's row, or **Pay this bill** inside a bill).
2. Choose the supplier. Their unpaid bills are listed, oldest due first.
3. Type the **Amount paid**: it is spread over the bills, the oldest first. Or type each bill's **Paying now** yourself. Part of a bill is fine — the rest stays owed.
4. **Paid with** (e.g. Bank Transfer), **Date paid**, the transfer number under **Reference**.
5. **Record payment**.

## See what is owed

- **Suppliers** tab: per supplier what is owed, not due yet, 1–30 / 31–60 / over 60 days late, and the next due date. **Edit** sets the supplier's payment terms (days) and what it usually bills for.
- **Bills** tab: Not paid / Overdue / Paid / Voided / All, by supplier, search by bill number or invoice number. Click a bill to see its lines and payments.
- **Payments** tab: every payment and the bills it paid.

## Mistakes

- A bill with nothing paid on it: open it → **Edit**, or **Void** (with a reason).
- A payment recorded wrong: **Payments** tab → **Void** (with a reason). Its bills are owed again; record the right payment.
- A bill with a payment on it: void the payment first.

Nothing is deleted: voided bills and payments stay listed with who voided them and why.

## Which department costs the most

**Reports → Money → Costs by department**: every expense and supplier bill of the period by department, its share, what it spent on and the change against the same number of days before. Also in the Excel and PDF report.

## In the books

- A bill: the cost on the **bill date** (on the Profit & Loss and on Reports → Costs that month), owed under **2150 Accounts payable — suppliers**. Which account each category goes to is set once in **Accounting → Accounts** (the same as Expenses).
- A payment: 2150 goes down, the money leaves cash / bank on the **date paid**.
- The balance sheet's 2150 = what the Suppliers tab shows as owed.
