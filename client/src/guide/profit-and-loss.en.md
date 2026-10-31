# Profit & Loss

**[Accounting](/accounting?tab=pl) → Profit & Loss** shows the month's result: revenue, the costs of each department, gross operating profit (GOP) and net profit. You need the **Accounting** permission (owners always have it).

## Reading it

- Three columns: **the chosen month** (this month = the month so far), **the month before**, and **the year to date**.
- **%** is of total revenue. For a department's expenses and profit it is of **that department's own revenue** (Rooms profit 95% = 95% of room revenue).
- Click a line (▸) to see the accounts behind it, or **Show all accounts**.
- **⬇ Excel** and **⬇ PDF** download the same figures.

| Part | What is in it |
| --- | --- |
| Revenue | Rooms, food & beverage (meal plans + restaurant), other departments (extras, activities, meeting room) |
| Departmental expenses | Costs of each department: payroll, commission, laundry, cost of food |
| Undistributed expenses | Admin & general, sales & marketing, maintenance, utilities |
| GOP | Departmental profit − undistributed expenses |
| Fixed charges | Rent, insurance, PBB, depreciation |

> Amounts are net. Service charge (paid to staff) and tax (PB1) are not revenue.

## Where the figures come from

- **Revenue**: the guests' bills, night by night — the same as the Daily journal.
- **Costs**: [Finance → Expenses](/back-office), agent commission, and the accountant's [journal entries](/guide/journal-entries) (payroll, depreciation, rent…). A cost entered in none of these is not on the P&L.
- A month is final once its days are closed (**Daily journal → Close days**). Before that, a correction changes the figures.

## Moving an account to another line

1. **Accounting → Accounts** → **Chart of accounts**.
2. **Edit** on the account.
3. Choose **Line on the Profit & Loss** → **Save**.

The P&L uses the new line straight away, for every month.

## Restaurant revenue by meal period

Restaurant revenue in the books is split into **food / drinks** and **breakfast / lunch / dinner**: accounts 410-21-001 to 003 (food) and 410-21-101 to 103 (drinks).

- The meal period follows the POS session, the one in which the bill was paid.
- Food or drink follows the mark on the menu item in the POS: **Menu → Set food or drink**. An unmarked item counts as food, and the Daily journal page warns about it.
- A bill whose session hasn't been sent from the POS sits on **410-21-004** first, and moves by itself once the session is sent. A closed day doesn't change.
- Breakfast included in a room's meal plan stays on 410-21-001.

## Discount report

Revenue in the books is **net**, after discounts. To see the discounts: **Accounting → Discounts**, then choose a period.

- **Summary:** before discount, discount and net revenue, for rooms and the restaurant.
- **Rooms:** every booking with a discount. It is shared evenly over the nights and counted for the nights in the period, shown including tax (as typed on the booking) and net.
- **Restaurant:** every bill with a discount, from the sessions the POS has sent. A session not sent yet isn't counted.
- **Excel** has the same data.

A price simply typed lower, without using the discount field, doesn't appear here.
