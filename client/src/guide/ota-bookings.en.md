# Bookings from the OTAs

When the hotel is connected to the channel manager (Channex), bookings made on Agoda, Booking.com, Traveloka and the other OTAs come into the PMS **by themselves**, usually within seconds (at most a minute). Changes and cancellations made on the OTA come in the same way. You don't type them in.

## How you see them

- A **pop-up** at the top right of every page: *New Agoda booking*, *booking changed*, *booking cancelled* or *needs you*, with the guest, room and dates, and a short sound. **Open** goes to the booking, **OK** clears it — for everyone at the desk, so one person presses it. **All seen** clears them all.
- **🌐 OTA bookings** in the menu (Front Desk), with a red number while something is new or needs you: everything that needs you first, then today's, then earlier ones. **↻ Check now** reads Channex at once.
- The **Dashboard** box *From the OTAs — today*: how many new / changed / cancelled today and what needs you.

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

On a normal OTA booking the guest has paid the OTA, so the booking is **Confirmed** straight away and the room is not collected at the desk (the PMS shows "Room — paid by Agoda"). **Don't mark the room payment as received** at check-in or check-out: the room line that stays open is what the OTA owes the hotel, and it is marked received when the OTA's money reaches the bank. Extras are still paid by the guest.

A *Guest pays at the hotel* booking stays **Pending** until the guest pays, like a direct booking. If the OTA later switches a booking between the two, the pop-up says *needs you* and the status follows.

## Changed or cancelled on the OTA

- **Changed** (dates, room type, guests, price): the booking is changed to match. If its room isn't free on the new dates, the PMS moves it to another free room of the type. Edit History says what changed.
- **Cancelled**: the booking is cancelled. If money was received on it, the To check list says so — refund it or keep it by the OTA's cancellation terms.

## Bookings already in the PMS

When an OTA is first connected, Channex may send bookings the hotel already has in the PMS (typed in, or from the old system). The PMS recognises them — same room type, same dates, and the guest's name or the OTA reservation number in the notes — and **links** them instead of booking them twice. They show on **To check** ("…was matched to this booking"), with the OTA's price when it differs from the PMS. From then on, changes on the OTA change that booking.

## When the PMS needs you

Some things the PMS doesn't do by itself:

- **no free room** for a new booking (overbooked),
- a change or cancellation for a guest **already checked in**,
- a room type that isn't linked,
- a change to a booking that was entered by hand.

These appear as a *needs you* pop-up, at the top of **🌐 OTA bookings**, on the Dashboard and on Telegram. Deal with them (move a guest, call the OTA, enter or change the booking by hand), then press **Done — handled**.

> Don't type an OTA booking in by hand when the hotel is connected — it would be in twice. Enter it by hand only when the PMS says so.
