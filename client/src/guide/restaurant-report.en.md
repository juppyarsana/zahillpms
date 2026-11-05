# Restaurant report

To check restaurant revenue: how much was paid at the restaurant, how much was charged to rooms and events, and whether every session from the POS arrived.

## Opening the report

1. Go to **Restaurant → Report** ([open](/restaurant?tab=report)).
2. Pick a period: **This month**, **Last month**, **Last 7 days**, or type your own dates (up to one year).
3. Click **⬇ Download Excel** for every detail.

The accountant can also download it from **Insights → Export / Print → Restaurant report**.

Who can open it: the owner, staff with the **Restaurant** permission, or staff with the **Accounting** permission.

## What the page shows

- **Restaurant revenue (net)** — exactly the restaurant F&B figure on the Summary page and in the journal.
- **Revenue** — split three ways: paid at the restaurant, charged to rooms, charged to events. Each with net, service + tax and total.
- **Paid by** — totals per payment method (Cash, QRIS, banks, Room Charge).
- **By session** — Breakfast, Lunch, Dinner.
- **Not revenue** — discounts, complimentary by department, bills still open when a session was sent.
- **Checks** — what to look at before the figures are final.
- **Day by day** — a total per day. **Show sessions** lists each session; click one to open it.

## Checks

| Message | Meaning | What to do |
|---|---|---|
| Sessions sent: 64 of 66 | The POS didn't send some sessions | Ask the cashier. If the restaurant was open, send it from POS → Transactions → Send to hotel |
| Session whose totals don't add up | Bills, payment methods and the breakdown disagree | Open the session and check with the cashier |
| Amounts differ | The POS amount differs from the guest's folio | Check the bill in the POS and the guest's folio |
| Folio line voided | Front desk voided the restaurant line on the folio | Make sure the bill was paid another way or really cancelled |
| Not in the PMS | The POS charged a room but the PMS never got it | Open **Room charges** and send it again from the POS |

> Bills paid at the restaurant count on the session's day. Room and event charges count on the day the PMS got them, and only while still on the bill.

## What's in the Excel

- **Summary** — the same as the page.
- **Daily by session** — every session every day, a column per payment method, day totals and a period total. These figures are as the POS sent them.
- **Bills** — every bill: number, opened / paid time, table or room, guest, payment method, cashier, subtotal, discount, net, service, tax, total.
- **Items sold** — every item on every bill.
- **Menu mix** — best sellers.
- **Room & event charges** — each room / event charge from the POS against the bill in the PMS.
- **Complimentary** — each free bill (not revenue).
- **Checks** — the check per session and the sessions not sent.
