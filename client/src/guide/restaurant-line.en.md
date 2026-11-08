# Restaurant phone line

Guests can call the **restaurant** straight from the room tablet, with the **Call Restaurant** button under **Call Front Desk**. The call rings on the **POS screens**, not in the PMS. Calls to the front desk are unchanged.

## Switching it on (owner)

**Settings → Property Details → POS Integration → Restaurant phone line** → tick **Rooms can call the restaurant**. The **Calling** and **POS Integration** modules must be on, and the POS must be linked to the PMS (POS: Setup → Hotel PMS).

## In the POS

- **A room calls:** every POS screen rings and shows the room number and guest name. Press **Answer**. The first screen to answer gets the call; the others stop ringing.
- **Not now** silences this screen only. The other screens keep ringing.
- During the call: a small box at the bottom left with **Mute** and **Hang up**. The cashier can keep using the POS.
- **Calling a room:** the **📞 Call a room** button at the top → pick the room (rooms with a guest are highlighted).
- A screen that shouldn't ring (in the kitchen, say): open **Call a room** → untick **Ring on this screen**.
- The first time, the browser asks for the **microphone** → choose **Allow**. The POS computer needs speakers and a microphone (or a headset).

## Front desk ↔ restaurant

The front desk and the restaurant can call each other, like an internal extension.

- **Front desk → restaurant:** the 📞 button (PMS) or the front desk phone → **Call the restaurant** at the top of *Call a Room*. Every restaurant screen with *Ring on this screen* on rings, showing **Front desk calling** and who is calling.
- **Restaurant → front desk:** **📞 Call a room** in the POS (or the waiter tablet) → **Call the front desk**. The front desk PCs and the front desk phone ring, showing **Restaurant calling**.
- The first screen to answer gets the call; the others stop ringing. Mute and Hang up as usual.
- Nobody answers within 45 seconds → it goes on the other side's **Missed calls** list as *Restaurant* or *Front Desk*, with **Call back**. No Telegram message for these.

## Missed calls

A call nobody answers within 45 seconds goes on a **Missed calls** list, one for front desk and one for the restaurant:

- **Front desk (PMS):** the 📞 button at the bottom right shows a red number. Open it → **Missed calls** above the rooms: room, guest name, time and how long ago.
- **Today:** each front desk missed call not called back yet is also in **Needs you now**, with **Call back** and **Done**.
- **Restaurant (POS):** **📞 Call a room** at the top shows "1 missed". Open it → the same list.
- **Call back** calls that room. As soon as someone talks to that room again (you call back, or the room calls again and is answered), the call leaves the list by itself.
- **Done** when it was handled another way (the guest came to the desk, say).
- **Show handled** lists the finished ones: who called back and when. The list keeps the last 24 hours.
- Telegram also sends a "Missed call" message (front desk: **Guest requests**, restaurant: **Room service orders**).
