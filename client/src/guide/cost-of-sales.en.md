# Cost of sales: food & drink through inventory

For the accountant. With this method on, food and drinks bought go to **inventory** first instead of straight to cost. They reach cost when they are used, once a month, so the food cost on the Profit & Loss matches that month's sales.

## Switching it on

**Accounting → Cost of sales** → choose the first day → **Switch on**. That day must not be closed yet. Use the first day of the books.

From that day:

- Expenses and supplier bills in category **Food** go to 130-00-001 Inventory — Food.
- Category **Drinks** goes to 130-00-002 Inventory — Beverage.
- Other categories don't change and go straight to cost.

The Reports and Costs pages still count purchases as a cost on the day bought. Only the books in Accounting use this method.

## Every month end

1. Do a **stock opname** in the PMS (Operations → Stock) and in the POS, as close to month end as you can.
2. Open **Accounting → Cost of sales** and pick the month.
3. Check the sum for Food and Drinks:

   **Stock at the start + bought − stock at the end = cost of sales**

4. Stock at the end fills in by itself: hotel stock plus restaurant stock at midnight after the month ends. You can type over it if your count differs.
5. Read any yellow warnings, then press **Post to the journal** → **Yes, post**.

The result is one ordinary journal entry under Journal entries, dated the month's last day. Post before closing that day. If it is already closed, choose a date that is still open.

## If something is wrong

Go to **Journal entries**: **Void** if the day is still open, **Reverse** if it is closed. Then post again from Cost of sales.

## Worth remembering

- **One bill, one category.** When a PO has both food and drinks, make two bills so the split is right.
- **Purchases not kept in stock** (market food for the day, say) are still recorded under Food. They aren't in the stock at the end, so they reach cost of sales at month end.
- **POS stock must be marked Food or Drink:** in the POS, Stock → **Set food or drink**. Unmarked items count as food, and this page warns you.
- **A negative result** means the stock at the end is more than the start plus purchases. Check the opening balance and the purchase categories.
- **Stock at the end is valued at today's average cost**, so post soon after the opname.
