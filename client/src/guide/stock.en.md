# Stock: adjust, stock opname and usage

**[Operations → Stock](/stock)** shows everything kept in stock: **stock items** (used by the hotel — rice, eggs, soap…) and **Sales items** with *Track stock* on (sold as they are — bottled water, minibar). You need the **Stock** permission (owners always have it).

Stock goes up when it is **bought** (on Purchasing), down when it is **sold**, and with **Adjust** for anything else. Click an item to see its history: every change, who and when, and what was left after it.

At the top, choose **Hotel stock** or **Restaurant stock** (when the restaurant app is linked). Everything below is about the hotel's stock; the restaurant's is described at the end.

## Stores

Hotel stock is kept per **store**: **Main Store**, **Engineering**, **Housekeeping** (owners add or rename them with the **Stores** button). **Kitchen** and **Resto** are the restaurant's stock, kept and counted in the restaurant app (POS).

- **Everything bought goes into a hotel store first**: **Main Store**, unless another hotel store is picked when you **Receive** a PO or **Buy without a PO** (*Into store*). When a PO has several lines, one line can go elsewhere with **Change** under it. Kitchen and Resto can't be picked here.
- **Restaurant goods** (kitchen ingredients, bar drinks) also go into Main Store and wait there as hotel stock until they are moved to Kitchen or Resto (see below).
- Above the list, choose **All stores** (the total, with the split per store under it) or one store (only what it holds).
- **Adjust** is always for one store — pick it in the Adjust window.
- The **stock opname** counts one store. Main Store lists every item; another store only what it holds or has held. A store has one stock opname being counted at a time.
- **Usage** runs between two stock opnames of the same store.
- *Low stock* is judged on the total of every store (that is what decides buying).

### Moving stock between stores

**Stock → Transfers → + Move stock**: choose from which store, to which store, the items and how many, then **Send**.

- The items leave the sending store at once and show as **on the way** (still counted in the stock value).
- The receiving store opens the transfer, counts what arrived and presses **Confirm what arrived**. If less came, type what came and why — the rest goes back to the sending store.
- The sender can **Cancel transfer** while it isn't confirmed; the items go back.
- Give Housekeeping / Engineering heads the **Receive transfers** permission (Roles & Permissions → Operations): they see only the Transfers tab and can confirm.
- The Telegram alert *Stock moved between stores* says when items are sent and when less arrived.

### Sending restaurant goods to Kitchen / Resto

**Stock → Transfers → + Move stock**, from Main Store to **Kitchen** or **Resto** *(restaurant app)*. Only restaurant items can go there.

- The transfer goes to the restaurant app (POS) at once. The chef or the resto counts what arrived in **POS → Inventory → Incoming** and confirms it; only then is it in the restaurant's stock.
- If less arrived, they type what came and why in the POS; the rest goes back to Main Store.
- If the POS can't be reached, the transfer is saved and marked **Not sent to the POS**: open it and press **Send to the POS**.
- **Cancel transfer** works only while the POS hasn't got the goods. After that, corrections are made when it is confirmed in the POS.

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

**Stock value** tab: what the stock on hand is worth, by category, each item at its average cost (what it cost to buy) — the hotel's and the restaurant's together, with one total. For the books, the accountant uses the value of a finished stock opname as the closing stock.

## Restaurant stock

The kitchen and bar ingredients and their supplies are kept in the **restaurant app (POS)**: its recipes take them off at each sale, and the **chef counts and adjusts them there** (Inventory → Stock Opname). Here they are shown **read-only**:

- **Stock items** — every item with what is left (in kg / L), its average cost and value. Click one for its **history**: each sale (with the bill number), purchase, stock opname, edited bill.
- **Usage** — between two of the chef's stock opnames: **by recipe** (what the dishes sold should have used) and **used** (opening + bought − closing). The **difference** is what the count found missing — waste, portions, a recipe that is wrong. Ask the chef about big red ones.
- **The breakfast buffet** has no recipe, so the kitchen types what it cooked with in the POS: **Inventory → Kitchen use → Add kitchen use**. One sheet per day per purpose; open it again to add more or change it, and the stock moves by the difference. A sheet locks once a stock opname is finished after it. The buffet sheet shows the cost per guest. **Show All / Food / Drink** narrows the list, so the resto can pick Drink and not see the kitchen's items; items marked Both show on either. The **Usage** tab has a *Kitchen use* column.
- Buying for the restaurant is done here, by purchasing (a purchase request, a PO, or Bought without a PO with kind *Restaurant (POS)*). The goods go into **Main Store** first, then to Kitchen / Resto with **Move stock**. In the POS they wait under Inventory → Incoming and go into its stock when the chef confirms them — the chef never adds purchases by hand.
- When the chef makes a **Request to buy** in the POS, items still in Main Store are shown ("The hotel has N in Main Store"), so they aren't bought again — ask for them to be sent.

## Write-offs on Telegram

Waste, or a correction down, worth more than an amount (set in **Settings → Notifications → Stock written off**) sends the owner a message with the item, how much, why and who.
