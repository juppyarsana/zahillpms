# Payments from the OTAs

The room money of an OTA booking comes one of three ways. The PMS keeps which one on each booking: **Edit Details → Room paid by**.

| Room paid by | What it means | Who handles it |
|---|---|---|
| **The OTA — paid to the hotel by its payout** | The guest paid the OTA (e.g. Agoda, Traveloka). Front desk withdraws the money from the OTA weekly — net of the OTA's commission. | Front desk, in **OTA payouts** |
| **The OTA — with a virtual card the hotel charges** | The OTA gives a virtual card (VCC). The hotel charges it itself on the card machine (EDC). | Front desk |
| **The guest, at the hotel** | The guest pays at the hotel, like a direct booking. The OTA then sends a commission bill. | Front desk (the room), the accountant (the commission bill) |

The channel manager fills this in from the OTA. When the OTA doesn't say, the PMS assumes **the guest pays at the hotel** and puts a point on **To check** — look on the OTA's extranet and change it in Edit Details if the OTA collects. OTA bookings typed in by hand follow their source (an OTA source = paid by the OTA) until changed.

> One OTA can use both ways (e.g. Booking.com: some bookings paid to Booking.com, some at the hotel). **The booking** decides, not the OTA.

## Front desk: paid by the OTA (payout)

- The booking is **Confirmed** straight away; the guest checks in without paying the room.
- **Don't charge the room to the guest** and don't mark the room received. Charge only the extras (minibar, extra bed, laundry…).
- At **check-out**, what is still owed for the room goes onto **that OTA's account in Agent Billing** by itself (the PMS makes the account if there is none). Nothing to press.

## Front desk: virtual card (VCC)

1. Find the date the card can be charged on the OTA's extranet and enter it in **Edit Details → Card can be charged from** (may be left empty).
2. On that date (or at check-in / check-out), **charge the card on the card machine**.
3. On the booking: **Room Payment → Record payment on the folio**. The room line is already ticked and the method is already **OTA virtual card** — enter the amount **actually charged**, then **Receive**.
4. If the card holds less than the room price (usually because the OTA's commission was taken off), the rest goes onto the OTA's account in Agent Billing at check-out. The accountant closes it as commission.

Virtual card money shows on **Cashier Closing** as *OTA virtual card*, like any card payment.

## Front desk: the weekly withdrawal

After withdrawing the money on the OTA's extranet:

1. Open **OTA payouts** in the Front Desk menu (owner / accountant: **Agent Billing**) → the OTA (e.g. *Agoda*). **Open Items** = stays checked out and not paid by the OTA yet.
2. Press **Record payout**.
3. **Tick the bookings** listed on the OTA's withdrawal (or **Tick all**).
4. Enter **Amount received in the bank** = the net amount withdrawn (after the OTA's commission), the date, and the withdrawal number under **Reference**.
5. **Commission kept back** fills itself in = the stays ticked − the money received (with its percentage). Change it if needed.
6. **Record payout**. The stays ticked become *Paid by agent*.

What follows:

- **Money received** (Daily Close, Cashier Closing, Reports) counts only the money that reached the bank.
- The commission goes to the cost **5120 Rooms — OTA commission** in the journal and on the **Profit & Loss**.
- What a virtual card didn't cover: **Record payout** with *Amount received* **0** and the commission = the rest.

A payout recorded by mistake: ask the owner / accountant to **Void** it (with a reason) — its stays are open again — then record it again.

## Accountant: commission bills (guest paid at the hotel)

For bookings the guest paid at the hotel, the OTA sends a commission bill (e.g. Booking.com monthly). Record it in **Back Office → Expenses** with the category **OTA Commission**. It goes to the same cost (**5120 Rooms — OTA commission**) on the Profit & Loss.

## Reports

**Reports → Money → Still owed**: the room money of OTA bookings not checked out yet shows as owed by the **OTAs**, not by guests. After check-out it is on that OTA's row in the agents table.

## Who can do it

- **OTA payouts** (Roles & Permissions → Front Desk): front desk sees the OTA accounts only and records the withdrawals. No voids, invoices or other agents.
- **Accounting** (Roles & Permissions → Finance): all of **Agent Billing** — for the accountant.
