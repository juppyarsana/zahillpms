# Room service orders on Telegram

Guests order food from the **room tablet**. The order goes to the **POS**, where the restaurant has to **accept** it. If the POS computer is asleep, nobody sees it and the guest waits. So every order is also sent to Telegram.

## What is sent

| When | What | To |
| --- | --- | --- |
| As soon as the guest orders | 🛎 room, guest, items, total, how they pay | **Room service orders** |
| Still not accepted after 5 minutes | ⏰ reminder | **Room service orders** |
| After 10 minutes, then every 5 minutes | ⏰ reminder | **Room service orders** + **Room service not accepted** |

Reminders stop as soon as the order is **accepted**, **refused** or **cancelled** in the POS, or after 30 minutes (the last message says to call the room).

## When a reminder comes

1. Open the POS and accept the order. If the screen is dark, wake the computer.
2. If the order can't be made, refuse it in the POS with the reason. The guest sees the reason on the tablet.
3. After 10 minutes, front desk can call the room to apologise and say how long it will be.

## Who gets it

**Settings → Notifications** → tick **Room service orders** for the restaurant / kitchen group, and **Room service not accepted** for front desk and the manager. Each recipient gets the messages in their own **Language**.
