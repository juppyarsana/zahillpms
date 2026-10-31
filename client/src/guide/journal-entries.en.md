# Journal entries, balance sheet & trial balance

The PMS posts what happens at the hotel by itself: guests' bills, payments, agents, the restaurant, expenses. **Journal entries** are for everything else the accountant books: payroll, depreciation, rent, service charge paid to staff, bank fees, money moved between accounts.

All of it is in [Accounting](/accounting?tab=entries). You need the **Accounting** permission (owners always have it).

## Before the first entry: the first day of the books

1. **Accounting → Journal entries** → **First day of the books**.
2. Choose the day the books move from the old system to the PMS → **Save**.
3. **Opening balances…** → type each account's balance from the old system's balance sheet at the end of the day before.

| Account | Where the figure comes from |
| --- | --- |
| Cash, bank | The old system's balance sheet |
| Accounts marked ★ (guests, deposits, agents, service charge, tax, commission) | Usually the PMS figure: **Use the PMS figures for ★ accounts** |
| Fixed assets, suppliers owed, capital | The old system's balance sheet |

> Any difference goes to 310-00-003 Opening Balance Equity, so the books always balance. The opening balances can be saved again until the first day is closed.

## Making an entry

1. **+ New entry**.
2. Date, description (e.g. *Payroll October*), reference (optional).
3. One line per account: debit **or** credit. Type amounts without dots.
4. Debits must equal credits. **=** puts the difference on that line.
5. **Save entry**.

> Monthly entries (payroll, depreciation): open last month's entry → **Copy as a new entry** → change the date and amounts.

## Correcting an entry

An entry is never edited.

| The entry's day is | What to do |
| --- | --- |
| Still open | Open it → **Void** → reason. It stays in the list, struck through. |
| Closed (🔒) | Open it → **Reverse** → a date. A new entry posts the opposite. Then make the right entry. |

## Balance sheet & trial balance

- **⚖ Balance sheet**: what the hotel owns and owes at the end of a day. ✓ means assets = liabilities + equity. Excel or PDF.
- **🧮 Trial balance**: every account's balance before a period, its debits and credits, and its balance at the end. Excel.
- Revenue and expense accounts start each year at zero; earlier years' profit shows under equity.

## The standard chart of accounts

Account codes read **GGG-DD-NNN**: group, department, number. In department costs the same number is the same cost (002 = guest supplies: Housekeeping 602-12-002, Restaurant 622-21-002). The full list is in **Accounting → Accounts**; accounts not in use are hidden, tick *Show accounts not in use* to see them, then **Use again**.

- **Expenses and Payables** pick the account from the category and department. Guest supplies, laundry, supplies and other follow the cost's department. Choosing an account for that category at the top of the Accounts page overrides this.
- **Payment methods** naming a bank (*EDC BCA*, *QRIS BCA*) go to the *EDC/QRIS Settlement – BCA* account when it exists.
- **Bank interest** sits below GOP, on the Non-operating line of the Profit & Loss.
- **Service charge split** (Accounts page): the Loss & Breakage and HR Development parts, as a % of the service charge. With a 10% charge, 3 points = 30%. Applies to days not closed yet.
