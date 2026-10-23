# Stock: adjust, stock opname and usage

**[Operations → Stock](/stock)** shows everything kept in stock: **stock items** (used by the hotel — rice, eggs, soap…) and **Sales items** with *Track stock* on (sold as they are — bottled water, minibar). You need the **Stock** permission (owners always have it).

Stock goes up when it is **bought** (on Purchasing), down when it is **sold**, and with **Adjust** for anything else. Click an item to see its history: every change, who and when, and what was left after it.

## Adjust — one item, something you know happened

Press **Adjust** on the item and choose why:

- **Waste / spoiled** — broken, spoiled, past its date, thrown away.
- **Used (not sold)** — welcome drinks, a staff meal, used in a room.
- **Correction** — the stock in the PMS was wrong (typed wrong, found more). Say why; it is required.

Then **how many** and save. The stock changes at once.

Record waste and use **on the day it happens**. Whatever is not recorded shows up later as an *unexplained* difference in the stock opname.

## Stock opname — every item counted on one day

Weekly or monthly.

1. **Stock opname** tab → **+ Start stock opname**. Every item is listed.
2. **Print count sheet** and walk the store with it. The sheet has empty boxes, so the count isn't steered by what the PMS expects.
3. Type what is on the shelf next to each item. It saves by itself, so you can stop and continue later. The difference shows as you type.
4. An item you don't count: leave it empty. It stays as it is.
5. **Finish…** — on the day you count, before more is used or sold.

When finished, every counted item is set to what was counted and the difference is recorded as *Stock opname*. A finished stock opname can't be changed. Only one can be open at a time; **Cancel opname** drops one that was started by mistake (the stock is not changed).

The summary goes to Telegram (value on hand, the difference, the biggest ones) and the full list by email — to whoever has *Stock opname finished* ticked in **Settings → Notifications**.

## Adjust or stock opname?

| | Adjust | Stock opname |
|---|---|---|
| What | one item | every item |
| When | when it happens | weekly or monthly |
| Why | known: waste, used, a correction | the count — what is left is **unexplained** |

On the usage report they stay apart: waste and use recorded with Adjust are normal; a big **opname difference** every period means stock is leaving without a record.

## Usage

**Usage** tab: from one finished stock opname to the next (or to now).

- **Used in total** = stock at the start + bought − stock at the end.
- Split into **Sold**, **Used (not sold)**, **Waste**, **Corrections** and **Opname difference**.
- In Rupiah at each item's average cost, by category or by item. **⬇ Excel** for the full table.

It needs at least one finished stock opname to start from.

## Stock value

**Stock value** tab: what the stock on hand is worth, by category, each item at its average cost (what it cost to buy). For the books, the accountant uses the value of a finished stock opname as the closing stock.

## Write-offs on Telegram

Waste, or a correction down, worth more than an amount (set in **Settings → Notifications → Stock written off**) sends the owner a message with the item, how much, why and who.
