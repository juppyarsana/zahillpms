# Stay vouchers

A voucher is **one stay, already paid for** — for example 2 nights, Deluxe Pool View, with breakfast, for Rp X. The buyer gets a PDF with the code, what it covers, how long it is valid and the terms & conditions. The guest uses it **once**, whenever they like within its rules, by quoting the code when booking.

The page is **[Sales → Vouchers](/vouchers)**. It needs the **Vouchers** permission (owners always have it).

> **Selling a voucher is not revenue.** The money is received, but the hotel still owes a stay. Revenue is recorded night by night when the guest stays, like any booking.

## 1. Making a voucher type (owner or staff with the *Voucher types* permission)

1. **Vouchers → Voucher types → New voucher type**.
2. Fill in the name, nights, room type, meal plan, maximum guests, price and how many months it is valid.
3. Paste the **Terms & conditions** from the old voucher document — this text is printed on the PDF.
4. **Rules** (optional): **blackout** periods (nights it can't be used), the check-in days allowed, minimum notice, whether a no-show uses the voucher up.
5. **Extra fee on the sale** (optional), e.g. a card / QRIS fee: the buyer pays it on top of the price, and it never reduces the stay.

A voucher carries **no service charge or tax**: the guest pays the price, and the room and meal plan are fully covered. Extras the guest buys are paid as usual.

Changing a voucher type **doesn't change vouchers already sold** — their rules and terms are saved when sold.

## 2. Selling a voucher

1. **Vouchers → Sell voucher**.
2. Choose the type, the buyer (search a guest or type a new name), who it is for (if not the buyer), how it was paid, the day paid and a reference.
3. **Sell voucher** → the code appears. Press **⬇ Voucher PDF** and give it to the buyer.

The money shows in that day's **Cashier Closing** (under the method chosen) and in the Daily Close.

## Several vouchers, or charged to a room

- **How many:** in the Sell window, *How many* makes up to 20 vouchers of the same type at once, each with its own code and PDF.
- **Charge to a room (paid with the bill):** choose *Payment → Charge to a room*, then search the reservation (booked or in house). The vouchers are issued at once and **one line per voucher goes on the guest's folio**, with no service charge or tax. Nothing is received that day: the guest pays it with the rest of the bill (Record Payment, or at check-out), like any extra. In the books it is money the hotel owes (a liability), never revenue.
- You can mix: for a guest who wants 8, sell 5 as *Paid now* and 3 as *Charge to a room*.
- A voucher charged to a room is **cancelled on the Vouchers page** (owner or Corrections permission): its line comes off the bill. If the guest already paid the bill, give the money back with ⋮ → Refund on the reservation. The line can't be voided or moved from the Folio tab.
- Not possible for a stay billed to an agent, a stay that is complimentary for everything, or a room on a group bill that covers everything. The window says so and you take the payment now instead.
- A voucher charged to a room can be used before the guest has paid the bill, so check that the bill is paid before check-out.

## 3. Booking with a voucher code

1. **New Booking** (one room): choose the dates, the room and the number of guests **first**.
2. In the **🎟 Voucher** box type the code and press **Check**.
3. If it fits, it says what the voucher pays. The price, meal plan and payment are **set by the voucher** — nothing to type or collect for the stay.
4. **Review booking** → create. The booking is **Confirmed** at once and the booking page shows **Paid by voucher**.

Check-in doesn't wait for a payment. At check-out the voucher becomes **Used**.

### If the code is refused

The message says why:

- **Code not found** — check the typing (the code is 12 letters / digits).
- **Already used / already booked** — a voucher is used once. If that booking is cancelled the voucher becomes active again.
- **Nights, room type or number of guests don't match** — the voucher is for exactly the stay that was sold.
- **A night falls in a blackout period, check-in day not allowed, too little notice, or past its last day** — only a **manager** (owner or the Corrections permission) can make an exception: they type a reason, and it is written to the voucher and the booking.

## 4. After the booking is made

- A voucher booking's **dates, room type, number of guests and price can't be changed**. If needed, **cancel the booking** — the voucher goes back to active — and book again with the same code. Moving to another room **of the same room type** is fine.
- **Booking cancelled:** the voucher is **Active** again.
- **No-show:** depending on its type, the voucher is **used up** or goes back to active. A no-show fee doesn't apply to a voucher booking.
- **Guest leaves early:** the price stays, nothing is refunded.

## 5. A voucher not used by its last day

After its **last valid day** has passed, the voucher becomes **Expired** by itself (every night at 03:40) and its value becomes **breakage income** in the books. A voucher that is booked never expires.

## 6. Exceptions (owner / Corrections permission)

Open the voucher (click its row):

- **Extend…** — move the last day, with a reason. Only for a voucher that has not expired.
- **Cancel voucher…** — sold by mistake. Give a reason; if the money goes back to the buyer, type the amount and how (the money out shows in Cashier Closing); if not, the hotel keeps it as income. A voucher that is booked must be released first (cancel its booking).

## 7. Free (complimentary) vouchers

Any voucher type can be **given away free** — for a travel agent's site inspection, a famtrip, or a gift from the hotel. No new type is needed.

1. **Vouchers → Sell voucher**, choose the voucher type, then tick **🎁 Give it free (complimentary)**.
2. Choose **what it covers**: *Room only* (meals and extras are paid by the guest), *Room + meals* (extras are paid by the guest), or *Everything* (room, meals and extras).
3. Type the **reason** and **who it is given to**.
4. The button depends on your permissions:
   - **Owner or the Complimentary permission:** *Give free voucher* — it is issued at once and the owner is told.
   - **Without it:** *Ask for approval* — the approvers (those ticked for *Approve complimentary stays & free vouchers* in Settings → Notifications) get a Telegram message with **Approve / Decline** buttons. This window waits; once approved, the code appears. Requests still waiting are listed at the top of the Vouchers page (you can **Withdraw** one), and declined ones stay there for a day. A request is valid for 24 hours.

No money is received and nothing is held — a free voucher doesn't show in Cashier Closing or in the voucher liability.

**Using it:** like any voucher (the code on New Booking, the same rules). The difference: **enter the room's normal price** (use the suggestion). The booking is made and then turned **complimentary** for what the voucher covers, and that price is recorded as the **value given away** in the reports, like any complimentary stay. A free voucher not used by its last day just expires — no breakage income.

## 8. Reports and the books

The **Report** tab: vouchers sold and not booked yet (the money held), booked ones, sold / used / expired in the period, and vouchers about to expire. With Accounting on there is a **check line**: the balance of the account *Deferred Income (vouchers)* must equal the vouchers sold and not booked yet.

For the accountant: sale → money in, voucher liability; booking with a voucher → the liability moves to Advance deposits / Guest ledger (not money in); room and meal revenue is posted per night without service charge or tax; expiry → breakage income.
