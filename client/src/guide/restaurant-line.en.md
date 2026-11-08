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

## Missed calls

A call nobody answers within 45 seconds goes on a **Missed calls** list, one for front desk and one for the restaurant:

- **Front desk (PMS):** the 📞 button at the bottom right shows a red number. Open it → **Missed calls** above the rooms: room, guest name, time and how long ago.
- **Today:** each front desk missed call not called back yet is also in **Needs you now**, with **Call back** and **Done**.
- **Restaurant (POS):** **📞 Call a room** at the top shows "1 missed". Open it → the same list.
- **Call back** calls that room. As soon as someone talks to that room again (you call back, or the room calls again and is answered), the call leaves the list by itself.
- **Done** when it was handled another way (the guest came to the desk, say).
- **Show handled** lists the finished ones: who called back and when. The list keeps the last 24 hours.
- Telegram also sends a "Missed call" message (front desk: **Guest requests**, restaurant: **Room service orders**).
