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

## Bills in number order (Bills tab)

For ticking off the printed bills and finding out why a number is missing.

1. Go to **Restaurant → Bills** ([open](/restaurant?tab=bills)). It opens on **yesterday**; use ‹ › to move a day, or pick dates.
2. Bills are listed **by bill number**. A missing number shows as a red line with the reason.
3. Click a bill to see its items and totals, and open its session, reservation or event.
4. **⬇ Download Excel** gives the same list.

Every bill gets its number when it is paid, counted per month. These bills have a number too:

| Shown as | Meaning |
|---|---|
| 🛏 Room charge | Charged to a guest's room; the guest signs the printed bill |
| 🗓 Event charge | Charged to a meeting / event |
| Included breakfast | Breakfast in the room rate, no payment |
| 🎁 Complimentary | Given away, charged to a department |
| Reopened | Front desk voided the room charge; the POS reopened the bill and it isn't settled again yet |
| Deleted | Deleted in the POS — the line says who deleted it, when and why |
| Missing | No record in the POS: deleted before the POS kept deleted bills (5 Nov 2026) |

> **Session not sent yet** on a bill means the cashier hasn't pressed *Send to hotel* for that session. The bill is real; it counts once the session is sent.

In the POS, a bill that already has a number can only be deleted by an Owner or Manager, and they must say why.
