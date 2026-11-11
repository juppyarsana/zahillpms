# Cancelling a booking: what happens to the money — plan (not built)

Status: **plan only, waiting for the client's answers** (written 2026-11-12). Nothing in this document is built yet. What already exists is listed at the end.

## The problem

A guest or an agent pays in advance, then the room is cancelled (or the guest does not come). Today the PMS cancels the booking, but **what happens to the money is not decided at that moment**. The money stays recorded on the cancelled booking, nobody is asked, and it can sit there for months. Production example: Neil Price Group (Bali Dirt Bikes), room 306, Rp 3.200.000 paid in advance, cancelled by the agent.

## The idea

When front desk cancels a booking that has money on it, the Cancel window makes them **decide there and then**.

**Step 1 — the fee the hotel keeps** (this picker already exists): no fee, first night, whole stay, or another amount.

**Step 2 — what happens to the rest** (money received minus the fee). Front desk **must choose one**:

| Choice | What it does |
|---|---|
| **Refund now** | The money goes back. Method, date and reference are filled in the same window (default method = the one the guest paid with). |
| **Hold as credit** | The money stays with the hotel as credit for later. For an agent's booking it is **credit for the agent** (any stay of that agent can use it). For a direct guest it is **credit for the guest** (any later stay of that guest can use it). |

"Non-refundable" is not a separate choice: it means choosing a fee that covers everything received (a shortcut button, *Keep everything received (non-refundable)*, will set that). Then step 2 disappears.

If no money was received, or the fee covers all of it, there is nothing to decide and the window stays as it is now.

The same two steps will appear when marking a **no-show**, because the money question is identical.

## Rules

- **An outcome is required.** The system refuses to cancel with money left and no outcome chosen. No "decide later".
- **OTA bookings** (Agoda, Booking.com…) keep today's behaviour: the OTA settles with its own guest, so there is no credit for an OTA. Only if the hotel itself took money (for example a virtual card it charged) the money goes back to the guest by refund.
- **Credit has no expiry.** It stays until it is used on another stay or refunded.
- **Using credit:** on another stay of the same agent (or the same guest), part or all of it, for what that stay still owes. The payment keeps its original date, method and reference, so no day's money changes.
- **Every refund or use of credit** needs a reason, is written in the booking's Edit History, and sends an alert to the owner.

## What the books show

- **A refund** is a negative payment on the day the money is given back (a minus line in Cashier Closing and Daily Close). The original payment stays as it was.
- **A fee** the hotel keeps is revenue (a "No-show & cancellation fees" line in Rooms).
- **Credit** leaves the money where it is. In the accounts it stays as money received in advance (a liability), until it is used or refunded. Nothing changes in the journal.

## Where the client will see it

- The **Cancel Booking** and **Mark No-Show** windows (the two steps above).
- A **Credit held** card on the agent's page in Receivables, on the guest's profile, on the group page, and on any other booking of the same agent or guest — with *Use here* and *Refund* buttons.

## Questions for the client

1. Does the hotel really hold credit for **normal guests** (not only agents)? If never, we skip guest credit.
2. **Who may refund** when cancelling? Today a refund needs the owner (or a role with the Corrections permission). With this window, any front desk staff who cancels could refund, with a reason and an owner alert. Acceptable?
3. Should the **refund method** be free to choose? (We suggest the method the guest paid with as default.)
4. Is it correct that **an OTA never holds credit**?
5. When a guest cancels and the booking has money, what is the **usual policy** — refund, keep a fee, or credit? (This decides which choice front desk should expect most.)

## Not included in the first version

- **Cancelling a whole group** at once (the money stays on its rooms; the credit card still shows it, per room).
- **Cancellation policies stored on each rate plan** (for example "non-refundable" or "free until 7 days before") so the window pre-selects the choice. Better done once we see how front desk uses the choice.
- A **list of all money held on cancelled bookings** for the owner.
- Matching one person who has **two guest profiles** (the existing *Move payment* is the way around it).

## Technical notes (for whoever builds it)

- No new table or migration. Credit = money received on a cancelled / no-show booking, less a fee kept and earlier refunds; it is worked out when needed.
- The cancel (`DELETE /api/bookings/:id`) and no-show (`PUT /api/bookings/:id/no-show`) requests take a `money` part (`outcome` = `refund` or `credit`, plus the refund's method / date / reference). The server refuses with `OUTCOME_REQUIRED` when money is left and no outcome is given. Fee, refund and credit all run in the cancel's own transaction.
- The refund code moves into one shared function used by Refund, the agent credit door and the cancel window.
- The agent credit service generalises to an owner of "agent" or "guest": `/api/credit/agent/:id` and `/api/credit/guest/:id` (the current `/api/agent-credit` paths are not deployed yet, so they can be renamed).
- Checks to run on a scratch copy of the database: direct guest and agent booking with each outcome; missing outcome refused; fee + refund; fee + credit; OTA cases; the no-show window; credit used on another stay of the same guest; Daily Close totals unchanged.

## What already exists (built 2026-11-12, on `dev`, not released)

**Agent credit** (commits `e53cb6a`, `3350e77`): the Credit held card for agents (Receivables, booking page, group page), *Use here* for part or all of it on another stay of the same agent, a refund of the credit, and the rule that an OTA never has credit. The guide chapter is *Kredit agen (kamar dibatalkan)*. The Cancel window text for an agent's booking says the money becomes credit; there is **no choice step yet** — that is what this plan adds. See CLAUDE.md, "Agent credit".
