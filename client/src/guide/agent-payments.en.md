# Payments from agents

**Money from the agent before the guest checks out → record it on the reservation. Money from the agent after check-out → record it in Receivables.**

| When the money arrives | Where to record it |
| --- | --- |
| Before check-out (usually H-7) | The reservation: **Room Payment → Mark Received** (a group: **Record Group Payment**) |
| After check-out | [Receivables](/agents) → the agent → **Record Payment** |

## Before check-out (H-7)

Agents usually transfer in full 7 days before arrival. Record that transfer on the reservation, with **the date it was really paid** and its reference.

**Single booking**

1. Open the booking → **Room Payment** card.
2. Click **Mark Received** on the unpaid line.
3. Choose the method, enter the transfer date and reference.
4. Part payment? Use **💳 Record payment** on the Folio tab and enter the amount.

**Group**

1. Group page → **Record Group Payment**.
2. Enter the amount received — the PMS spreads it over the rooms.
3. Enter the transfer date and reference.
4. Does the transfer also cover extras (e.g. an extra bed)? Tick that room under **Extras on the rooms** in the same window. Ticked extras are paid on the room's folio and stay off the agent's bill. Leave them unticked if the guest or the agent pays them later.

One transfer for several separate reservations: record it on each one with the same reference.

## At check-out

Check out as usual. The PMS bills the agent only **what is still unpaid** — nothing to choose.

| Paid by the agent before check-out | Goes on the agent's bill | Label in Receivables |
| --- | --- | --- |
| In full | Nothing | Paid before check-out |
| Part, e.g. 40% | The rest, e.g. 60% | On the bill · not invoiced |
| Nothing yet | The whole stay | On the bill · not invoiced |

The guest doesn't pay for the room — only extras they pay themselves at the desk (minibar, laundry, etc.). The reservation still counts for that agent in the reports (By agent), even when it was paid before check-out.

## A group with one bill under a billed agent

A group billed as a whole holds the room money on the group's bill, not on the rooms. When a room whose agent pays later (or an OTA that collects from the guest) checks out, the PMS switches the group to **billing room by room** by itself: what the group has paid moves onto the rooms, and the unpaid rest goes on the agent's bill. The day's closing doesn't change.

If Receivables shows a room as **On the group's bill · not the agent's**, it was left on the group:

1. Open the group → **Group Bill** card → **🧾 Bill room by room** (owner, or the Corrections permission).
2. Read **What will happen**, type a reason, confirm.
3. Rooms already checked out now show on the agent's bill.

The PMS refuses when the group has a refund, has paid more than its rooms' price, or a room is already on an agent invoice or part-paid by the agent. The window says which; put that right first. If this happens at check-out, the guest still checks out, the room stays on the group's bill, and the reason is in the room's Edit History.

> Check extras first on a group that pays **Everything**: the window's figures are the room price only, so extras charged to a room are added on top for that room (for a room the OTA pays, they stay the guest's). A group that has already paid for extras can't be switched.

## After check-out

If the agent pays after the guest has left, record it in **Receivables**, not on the reservation.

1. Open [Receivables](/agents) → click the agent.
2. Click **Record Payment**.
3. Enter the amount, method, transfer date and reference.
4. The PMS matches it to the oldest stays first — check and adjust if needed.

Once matched, those stays read **Paid by agent** and leave the overdue list (aging).

## If it was recorded in the wrong place

| Mistake | What happens | Fix |
| --- | --- | --- |
| H-7 transfer recorded in Receivables | The reservation looks unpaid; the money waits as an agent credit | Void it in Receivables (with a reason), then record it on the reservation |
| Payment after check-out recorded on the reservation | The agent's bill goes down, but the Cashier Closing "Agent ledger" figure of the check-out day changes | Tell the owner; next time record it in Receivables |

> Hints in the PMS: a booking with a billed agent shows a blue box on the **Room Payment** card (here before check-out, Receivables after). Receivables's **Record Payment** window reminds you it is only for stays already checked out.
