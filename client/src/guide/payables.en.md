# Payables — supplier bills

**[Finance → Payables](/payables)** keeps the bills suppliers send and what the hotel still owes them. You need the **Payables** permission (owners always have it).

**Payables or Expenses?**

- **Payables**: the bill comes now and is paid later (the supplier gives 14 / 30 days, or sends one bill a month). Record the bill on the day it **arrives**, the payment on the day it is **paid**.
- **[Expenses](/expenses)**: paid on the spot (cash, or a transfer the same day). One line, nothing owed.

Never record the same bill in both places.

## Record a bill

1. **New bill**.
2. Choose the **Supplier** (or **+ New supplier…** at the bottom of the list).
3. **Their invoice number**, as printed on the bill.
4. **Bill date** = the date on the bill. The **Due date** fills itself in from the supplier's payment terms (you can change it).
5. One line per kind of cost: the **Account** (e.g. *5220 F&B — cost of food*, *6220 Laundry cost*), a description, the **amount**. Tax included, as printed. A discount on the bill = a line with a minus amount.
6. **Save bill**.

The PMS warns you when the same invoice number of that supplier is already recorded.

> Food and drinks bought for the store go straight to cost. At month end the accountant adjusts for what is still in the store with one journal entry.

## From a purchase order

On a received purchase order (**Operations → Purchasing & Stock → Purchase Orders**) press **Make bill**. Supplier and lines are filled from what was received and not billed yet. Add the invoice number and correct the prices if the bill differs, then save.

## Pay a supplier

1. **Pay a supplier** (or **Pay** on the supplier's row, or **Pay this bill** inside a bill).
2. Choose the supplier. Their unpaid bills are listed, oldest due first.
3. Type the **Amount paid**: it is spread over the bills, the oldest first. Or type each bill's **Paying now** yourself. Part of a bill is fine — the rest stays owed.
4. **Paid with** (e.g. Bank Transfer), **Date paid**, the transfer number under **Reference**.
5. **Record payment**.

## See what is owed

- **Suppliers** tab: per supplier what is owed, not due yet, 1–30 / 31–60 / over 60 days late, and the next due date. **Edit** sets the supplier's payment terms (days) and usual account.
- **Bills** tab: Not paid / Overdue / Paid / Voided / All, by supplier, search by bill number or invoice number. Click a bill to see its lines and payments.
- **Payments** tab: every payment and the bills it paid.

## Mistakes

- A bill with nothing paid on it: open it → **Edit**, or **Void** (with a reason).
- A payment recorded wrong: **Payments** tab → **Void** (with a reason). Its bills are owed again; record the right payment.
- A bill with a payment on it: void the payment first.

Nothing is deleted: voided bills and payments stay listed with who voided them and why.

## In the books

- A bill: the cost on its account on the **bill date** (on the Profit & Loss that month), owed under **2150 Accounts payable — suppliers**.
- A payment: 2150 goes down, the money leaves cash / bank on the **date paid**.
- The balance sheet's 2150 = what the Suppliers tab shows as owed.
