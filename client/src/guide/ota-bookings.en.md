# Bookings from the OTAs

When the hotel is connected to the channel manager, bookings made on Agoda, Booking.com, Traveloka and the other OTAs come into the PMS **by themselves**, usually within seconds (at most a minute). Changes and cancellations made on the OTA come in the same way. You don't type them in.

## How you see them

- A **pop-up** at the top right of every page: *New Agoda booking*, *booking changed*, *booking cancelled* or *needs you*, with the guest, room and dates, and a short sound. **Open** goes to the booking, **OK** clears it — for everyone at the desk, so one person presses it. **All seen** clears them all.
- **Reservations → OTA bookings** tab (the red number shows on Reservations in the menu and on the tab while something is new or needs you): everything that needs you first, then today's, then earlier ones. **↻ Check now** reads the channel manager at once.
- The **Today** page box *From the OTAs — today*: how many new / changed / cancelled today and what needs you.

## A new OTA booking

The PMS:

- picks the **first free room** of the booked room type,
- finds the guest (same e-mail and name) or adds a new guest,
- sets the OTA as the **source**, the price the OTA sent, the meal plan, adults and children,
- puts the OTA's notes in **Special requests**,
- sends the **New booking** alert on Telegram.

Each one appears on **Reservations → ⚠ To check** with these points:

- **Room picked automatically** — move it with **Change Room** if another room suits better (the point then clears itself), or press **✓ Checked**.
- **Guest pays at the hotel** — on some Booking.com / Expedia bookings the hotel collects, not the OTA. **Collect the room price** at check-in or check-out like a direct booking; the PMS asks for it.

On a normal OTA booking the guest has paid the OTA, so the booking is **Confirmed** straight away and the room is not collected at the desk (the PMS shows "Room — paid by Agoda"). **Don't mark the room payment as received** at check-in or check-out: the room line that stays open is what the OTA owes the hotel. At check-out the PMS moves it onto **that OTA's account in Receivables**, and front desk records the OTA's weekly withdrawal there (OTA payouts in the menu). Extras are still paid by the guest. If the OTA pays with a **virtual card**, see [Payments from the OTAs](/guide/ota-payments).

A *Guest pays at the hotel* booking stays **Pending** until the guest pays, like a direct booking. If the OTA later switches a booking between the two, the pop-up says *needs you* and the status follows.

## Changed or cancelled on the OTA

- **Changed** (dates, room type, guests, price): the booking is changed to match. If its room isn't free on the new dates, the PMS moves it to another free room of the type. Edit History says what changed.
- **Cancelled**: the booking is cancelled. If money was received on it, the To check list says so — refund it or keep it by the OTA's cancellation terms.
- **Cancelled, for a booking typed in by hand or from the old system**: if the OTA reservation number is in the booking's notes, the PMS cancels it. If only the guest's name and arrival date match, it is **not** cancelled: a *needs you* item and a To check point name the booking, so you check it and cancel it yourself. With no match you also get a *needs you* item.
- **Changed, for a booking typed in by hand or from the old system**: if the OTA reservation number is in its notes, the booking moves to the new dates. If only the guest's name matches an arrival within 60 days, the PMS books the new dates as well, so the room is held, and a *needs you* item names both bookings. **If it is the same stay, cancel the old one**, otherwise its room stays blocked. If no room is free on the new dates, nothing is booked and the *needs you* item says so.

## Bookings already in the PMS

When an OTA is first connected, the channel manager may send bookings the hotel already has in the PMS (typed in, or from the old system). The PMS recognises them — same room type, same dates, and the OTA reservation number in the notes or the same guest name — and **links** them instead of booking them twice. One shared word such as *Made* or *Putu* is not enough: the PMS then books the room as well and a *needs you* item names both bookings, so cancel one if it is the same stay. They show on **To check** ("…was matched to this booking"), with the OTA's price when it differs from the PMS. From then on, changes on the OTA change that booking.

## When the PMS needs you

Some things the PMS doesn't do by itself:

- **no free room** for a new booking (overbooked),
- a change or cancellation for a guest **already checked in**,
- a room type that isn't linked,
- a change to a booking that was entered by hand.

These appear as a *needs you* pop-up, at the top of **Reservations → OTA bookings**, on Today and on Telegram. Deal with them (move a guest, call the OTA, enter or change the booking by hand), then press **Done — handled**.

> Don't type an OTA booking in by hand when the hotel is connected — it would be in twice. Enter it by hand only when the PMS says so.

## A different price for one meal plan on the OTAs (owner)

Normally the OTAs get the PMS price: the room rate plus the meal plan, service & tax included. To give the OTAs another price for one meal plan, e.g. a Bed & Breakfast promotion:

1. **Pricing** → **🌐 OTA prices**.
2. Per line pick the **room type**, the **meal plan**, the **first** and **last night** (both included) and the **price** per room per night, service & tax included.
3. Need several? **+ Add line**, then **Save … — send together**. They reach the OTAs together within about 20 seconds.

> This price is for the OTAs only. New Booking and the guest's bill keep the PMS price.

A price can run up to 5 years ahead: the OTAs see about 16 months, and each later night is sent as it comes into view. Where two OTA prices cover the same night, the one saved last wins. **✕** on a saved price removes it; those nights go back to the normal price.

## OTA price ladder — the price follows rooms sold (owner)

The OTA price can go up as the hotel fills. Per meal plan, type a price for each room type at each tier of **rooms sold in the whole hotel** that night:

1. **Pricing** → **My rules** → **📈 OTA price ladder**.
2. Pick the **meal plan** (e.g. Breakfast Non Refund).
3. Each row: **Sold up to** (16, 20, 23, …) and the price per room type, per room per night, service & tax included. Easiest: copy the block from Excel (the "sold up to" column + the prices, with the room types in the **same order** as the columns here) and paste it into the first **Sold up to** box.
4. **Save ladder for …**. Do the same for each meal plan.

Each night the OTAs get the price of the tier the **next** room falls in: with 16 rooms sold, the next is the 17th, so the "up to 20" row. Every booking or cancellation is counted again and the price reaches the OTAs within about 20 seconds — a cancellation can bring it back down.

> Counted as sold: every booking except cancelled and no-show, unpaid ones too, in every room type.

- A room type whose column is left empty keeps the normal price.
- A fixed **🌐 OTA price** wins over the ladder on its nights (for a special date). Remove old fixed prices for that meal plan, or the ladder won't show on those nights.
- **Remove ladder** puts the meal plan back on the normal price.
- Each send is in **Settings → Channel Manager → Last sends**, with its tier ("sold up to 20").
