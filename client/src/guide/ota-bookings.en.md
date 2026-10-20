# Bookings from the OTAs

When the hotel is connected to the channel manager (Channex), bookings made on Agoda, Booking.com, Traveloka and the other OTAs come into the PMS **by themselves**, within about a minute. Changes and cancellations made on the OTA come in the same way. You don't type them in.

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

On a normal OTA booking the guest has paid the OTA: the room is not collected at the desk (the PMS shows "Room — paid by Agoda"). Extras are still paid by the guest.

## Changed or cancelled on the OTA

- **Changed** (dates, room type, guests, price): the booking is changed to match. If its room isn't free on the new dates, the PMS moves it to another free room of the type. Edit History says what changed.
- **Cancelled**: the booking is cancelled. If money was received on it, the To check list says so — refund it or keep it by the OTA's cancellation terms.

## When the PMS needs you

Some things the PMS doesn't do by itself:

- **no free room** for a new booking (overbooked),
- a change or cancellation for a guest **already checked in**,
- a room type that isn't linked,
- a change to a booking that was entered by hand.

These appear in **Settings → Channel Manager → 4. Bookings from the OTAs** (owner) and on Telegram. Deal with them (move a guest, call the OTA, enter or change the booking by hand), then press **Done — handled**.

> Don't type an OTA booking in by hand when the hotel is connected — it would be in twice. Enter it by hand only when the PMS says so.
