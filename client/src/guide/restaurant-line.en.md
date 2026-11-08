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

## If nobody answers

After 45 seconds the guest sees "No one answered", and the **Room service orders** Telegram group gets a "Missed call" message so the restaurant can call the room back.
