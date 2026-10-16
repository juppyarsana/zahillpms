# The To check list

Bookings with incomplete data are marked **To check** — for example reservations moved over from VHP: room picked automatically, agent not in the PMS yet, guest name unknown, price 0, deposit not recorded. Front desk's job: look, fix, then mark **✓ Checked**.

> A To check booking already holds its room, so the room can't be sold again. It stays **Pending** until a payment is recorded. Nothing is sent to the guest or agent.

## How it works

1. Open [Reservations](/reservations?view=tocheck) → the **⚠ To check** button. The number = reservations still to check (a group counts once).
2. One line = one reservation. A group shows as one line with all its rooms.
3. Click a line to open the booking (or the group page). The yellow **To check** box lists what to look at.
4. Find the reservation in VHP (its ResNo is in **Edit Details → Internal Notes** and in **Edit History**), then fix each point — how is below.
5. A point you fix is **crossed off by itself**.
6. When everything is done, press **✓ Checked** (a group: **✓ Checked whole group**, on the list or on the group page).

Start with the **nearest arrival date**.

## Three tabs

| Tab | What's in it |
| --- | --- |
| **To check** | Reservations still to work on |
| **Waiting for guest names** | Checked, only the guest names from the agent are missing. Leaves the list by itself once the names are in |
| **Done** | Finished. **Put back** returns one to the To check list |

Guest names can wait: press Checked once the rest is done, and the reservation moves to **Waiting for guest names**.

## What each point means and how to fix it

**Room picked automatically**

- The room is fine: nothing to change (just press Checked).
- Another room is needed: **⋮ → Change Room**. A room of the **same type**: the price doesn't change, the reason can stay empty.

**Agent not in the PMS**

1. Open [Agent Billing](/agents) → **+ New agent** → name, type, contact. Once per agent.
2. Back on the booking → **⋮ → Edit Details** → **Agent** → pick it → save. A group: on each room.

**Agent … was created by the import**

- For the owner: complete the agent's contact and credit terms in [Agent Billing](/agents). The point is crossed off once the agent has a contact.

**Guest name not known yet**

- One room: **⋮ → Change Guest** → find the guest or add a new one.
- A group: group page → **Assign Guests** → fill in every room at once.

**No rate in VHP (Rp 0)**

Until it's set, the price is only the breakfasts (e.g. Rp 200.000 for 2 people).

- One room: **⋮ → Edit Price** → the whole stay's price (incl. service & tax and breakfast).
- A group: group page → **⋮ → Set Prices** → tick the rooms, type the **price per night**, **Apply** to all rooms at once (or one room type) → reason → save.
- Needs the **Edit Price** permission (owner, or a role given it).

**Complimentary in VHP**

- **⋮ → Make Complimentary** → choose what is free (room only / room + meals / everything) → reason. If approval is needed, the request goes to the approvers on Telegram.

**Number of guests guessed** (2 per room)

- Check the real number → **⋮ → Edit Details** → **Number of Guests**.
- 3 people in a room for 2: **Extras for this stay** card → **+ Add item** → Extra Bed → pick the nights.

**Check in VHP whether a deposit was paid**

- Check in VHP: how much, which date, which method. Nothing paid → nothing to do.
- Paid → record it with **the date it was really paid, not today**. For agent reservations see the chapter [Payments from agents](/guide/agent-payments).
- One room: **Room Payment** card → **Mark Received**, or the Folio tab → **💳 Record Payment**. A group: group page → **Record Group Payment**.

**VHP listed this stay night by night**

- VHP had this stay as one line per night; the PMS joined it into one booking. Compare the nights and rooms with VHP.

## Pressed Checked by mistake?

On the booking: **put back on the list**. In the **Done** tab: **Put back**. Who pressed Checked is in the **Edit History**.
