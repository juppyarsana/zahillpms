const db = require('../db');
const sse = require('../sse');
const tableSessionService = require('./tableSessionService');
const { computeFolioTotals, ymd, stayNights } = require('./folioService');

// F&B categories: the only products that go to the kitchen board and the only
// ones guest-facing menus (Room Display Dining, resto QR/staff menu) list.
// Every other category is a hotel extra sold from the PMS Sales page
// (migration 067).
const FNB_CATEGORIES = ['drinks', 'food'];

// Validates products belong to the property, computes the total and whether
// the order needs a kitchen ticket, and inserts the sale + sale_items in one
// transaction. Callers are responsible for validating booking_id (if any)
// and for supplying trustworthy unit_price per item before calling this —
// see routes/display.js's guest order endpoint for why that matters when
// the caller isn't an authenticated staff member.
//
// Stock (for products with track_stock) is decremented in the same
// transaction, row-locked via FOR UPDATE to avoid a race between two
// concurrent sales of the last unit; insufficient stock rolls the whole
// sale back rather than partially fulfilling it. tableId (dine-in only)
// resolves to the table's current name for the denormalized table_number
// column, opens/reuses that table's open session, and flips the table to
// 'occupied' — pass tableNumber instead for properties that haven't set up
// table entities yet (free-text fallback).
//
// holdForConfirmation (room-service only) lands the sale in a pre-kitchen
// "pending" bucket instead of firing straight to the kitchen board — see
// routes/resto.js's confirm/reject endpoints. orderSource just labels where
// an order came from for the resto app's UI; it's not load-bearing for any
// gate.
//
// paymentMethod may be falsy or 'unpaid' — an "open tab" order (migration
// 050): placed and fired to the kitchen, but not yet paid. It's stored as
// 'unpaid' and settled later by restoSettleService when staff close the
// table. No booking or folio posting at this point.
//
// taxDirectPay (PMS Sales page only, migration 067): item prices are before
// tax, like rooms. When the sale is paid directly (a real payment method —
// not room_charge, where the folio adds tax at checkout, and not unpaid),
// service charge + tax are computed at the property's rates and stored on
// the sale; the guest pays the gross. If the sale is also linked to a
// booking ("Pay now" for an in-house guest), it's posted to the folio as the
// NET charge (the folio adds its own tax) plus a received 'incidental'
// payment of the gross, so the folio shows it while its balance stays zero.
//
// Per-night items (products.per_night, migration 074 — e.g. an extra bed):
// the item carries `nights: ['YYYY-MM-DD', …]` (nights of the booking's stay)
// and `quantity` = units per night (beds). They need a booking. The sale line
// records units × nights, and each night becomes a booking_addons row that's
// posted to the folio night by night with the room (not now as a 'sale'
// charge) — nights already past are posted straight away. A product's
// breakfast part (meal_price = one breakfast, net × meal_pax breakfasts per
// unit, migration 075) is stored on the line as meal_amount so the reports
// count it as F&B.
//
// A per-night item can also carry, per sale (migration 075, owner's choice
// "any front desk staff"):
//   price_per_night — a bargained price instead of the item's price
//   breakfasts      — breakfasts per night (default units × the item's
//                     meal_pax; e.g. a double extra bed for one person = 1)
// Both are noted in the booking's Edit History when they differ.
//
// Open-price items (products.open_price, migration 077 — "Other charge"):
// the item carries its own `unit_price` and `description` (what it is, e.g.
// "Broken glass"), both required; stored on the sale line so Sales History,
// the folio and the receipt show what was typed.
async function createSale(propertyId, { bookingId, paymentMethod, items, orderType, tableNumber, tableId, servedBy, holdForConfirmation, orderSource, taxDirectPay }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const productIds = items.map(i => i.product_id);
    const { rows: ownedProducts } = await client.query(
      'SELECT id, category, track_stock, stock_quantity, name, price, per_night, meal_price, meal_pax, open_price FROM products WHERE id = ANY($1) AND property_id = $2 FOR UPDATE',
      [productIds, propertyId]
    );
    if (ownedProducts.length !== new Set(productIds).size) {
      await client.query('ROLLBACK');
      return { error: 'One or more products not found' };
    }
    const productById = new Map(ownedProducts.map(p => [p.id, p]));
    // Price always comes from the product row, never from the caller — the
    // staff till (routes/sales.js) forwards the browser's cart as-is, and
    // these amounts reach the folio, receipts and tax.
    items = items.map(i => {
      const p = productById.get(i.product_id);
      // Price from the product row — except a per-night item's bargained
      // price per night (validated below).
      if (p.open_price) {
        return { ...i, unit_price: Math.round(parseFloat(i.unit_price) * 100) / 100, description: String(i.description || '').trim().slice(0, 200) };
      }
      const override = p.per_night && i.price_per_night !== undefined && i.price_per_night !== null && i.price_per_night !== '';
      return { ...i, unit_price: override ? Math.round(parseFloat(i.price_per_night) * 100) / 100 : p.price, price_changed: override && parseFloat(i.price_per_night) !== parseFloat(p.price), description: null };
    });
    const badOpen = items.find(i => productById.get(i.product_id).open_price && (!i.description || !(parseFloat(i.unit_price) > 0)));
    if (badOpen) {
      await client.query('ROLLBACK');
      return { error: `${productById.get(badOpen.product_id).name}: type what it is and a price above 0`, code: 'OPEN_PRICE_MISSING' };
    }
    const badPrice = items.find(i => !Number.isFinite(parseFloat(i.unit_price)) || parseFloat(i.unit_price) < 0);
    if (badPrice) {
      await client.query('ROLLBACK');
      return { error: 'The price per night must be 0 or more', code: 'BAD_PRICE' };
    }

    // Per-night items: nights must be nights of this booking's stay.
    const perNightItems = items.filter(i => productById.get(i.product_id).per_night);
    let stay = null;
    if (perNightItems.length) {
      if (!bookingId) {
        await client.query('ROLLBACK');
        return { error: `${productById.get(perNightItems[0].product_id).name} is charged per night of a stay — choose the guest's room first`, code: 'PER_NIGHT_NEEDS_BOOKING' };
      }
      const { rows: [bk] } = await client.query(
        'SELECT id, status, check_in_date, check_out_date FROM bookings WHERE id = $1 AND property_id = $2', [bookingId, propertyId]);
      if (!bk || ['cancelled', 'no_show'].includes(bk.status)) {
        await client.query('ROLLBACK');
        return { error: 'This booking is cancelled', code: 'BOOKING_NOT_ACTIVE' };
      }
      const stayDates = new Set(stayNights(bk.check_in_date, bk.check_out_date));
      for (const i of perNightItems) {
        const nights = [...new Set((Array.isArray(i.nights) ? i.nights : []).map(d => String(d).slice(0, 10)))].sort();
        if (!nights.length || nights.some(d => !stayDates.has(d))) {
          await client.query('ROLLBACK');
          return { error: `Pick the nights for ${productById.get(i.product_id).name} — they must be nights of the stay (${ymd(bk.check_in_date)} to ${ymd(bk.check_out_date)})`, code: 'BAD_NIGHTS' };
        }
        i.nights = nights;
        const p = productById.get(i.product_id);
        const dflt = parseInt(i.quantity) * (parseInt(p.meal_pax) || 0) * (parseFloat(p.meal_price) > 0 ? 1 : 0);
        const b = i.breakfasts === undefined || i.breakfasts === null || i.breakfasts === '' ? dflt : parseInt(i.breakfasts);
        if (!Number.isInteger(b) || b < 0 || b > 50) {
          await client.query('ROLLBACK');
          return { error: 'Breakfasts per night must be a whole number, 0 or more', code: 'BAD_BREAKFASTS' };
        }
        i.breakfasts = b;
        i.breakfasts_default = dflt;
      }
      stay = bk;
    }
    const isPerNight = i => productById.get(i.product_id).per_night;
    // Units recorded on the sale line: per night = units × nights.
    const lineQty = i => parseInt(i.quantity) * (isPerNight(i) ? i.nights.length : 1);

    const outOfStock = items
      .filter(i => !isPerNight(i))
      .filter(i => productById.get(i.product_id).track_stock && productById.get(i.product_id).stock_quantity < parseInt(i.quantity))
      .map(i => ({ product_id: i.product_id, name: productById.get(i.product_id).name, available: productById.get(i.product_id).stock_quantity, requested: parseInt(i.quantity) }));
    if (outOfStock.length > 0) {
      await client.query('ROLLBACK');
      return { error: 'Insufficient stock', code: 'OUT_OF_STOCK', items: outOfStock };
    }

    // payment_method used to be a DB CHECK (cash/qris/room_charge only,
    // migration 001). Migration 048 dropped that so the resto app can accept
    // any of a property's configured payment_methods — this is now the one
    // choke point every caller (staff POS, Room Display, resto app) goes
    // through. Two sentinels that aren't real payment_methods rows:
    //   - 'room_charge' means "post to the guest's folio," requires a booking.
    //   - 'unpaid' means "open tab" — the order's placed but nobody's paid yet
    //     (migration 050). Settled later by restoSettleService when staff
    //     close the table. No folio posting, no booking required.
    const paymentMethodValue = paymentMethod || 'unpaid';
    if (paymentMethodValue === 'unpaid') {
      // nothing to validate — sentinel, resolved at settlement
    } else if (paymentMethodValue === 'room_charge') {
      if (!bookingId) {
        await client.query('ROLLBACK');
        return { error: 'room_charge requires a booking' };
      }
    } else {
      const { rows: [pm] } = await client.query(
        'SELECT id FROM payment_methods WHERE id = $1 AND property_id = $2 AND is_active = true',
        [paymentMethodValue, propertyId]
      );
      if (!pm) {
        await client.query('ROLLBACK');
        return { error: 'Invalid payment method' };
      }
    }

    let resolvedTableNumber = tableNumber || null;
    let sessionId = null;
    if (tableId) {
      const { rows: [table] } = await client.query(
        'SELECT id, name FROM restaurant_tables WHERE id = $1 AND property_id = $2 FOR UPDATE',
        [tableId, propertyId]
      );
      if (!table) {
        await client.query('ROLLBACK');
        return { error: 'Table not found' };
      }
      resolvedTableNumber = table.name;
      const session = await tableSessionService.ensureOpenSession(client, propertyId, tableId, servedBy);
      sessionId = session.id;
    }

    const needsKitchen = items.some(i => FNB_CATEGORIES.includes(productById.get(i.product_id).category));
    const pending = !!holdForConfirmation;
    const total = items.reduce((sum, i) => sum + parseFloat(i.unit_price) * lineQty(i), 0);
    const perNightTotal = items.filter(isPerNight).reduce((sum, i) => sum + parseFloat(i.unit_price) * lineQty(i), 0);
    const paidDirectly = paymentMethodValue !== 'room_charge' && paymentMethodValue !== 'unpaid';
    let taxes = null;
    if (taxDirectPay && paidDirectly) {
      const { rows: [ps] } = await client.query(
        'SELECT tax_rate, service_charge_rate FROM property_settings WHERE property_id = $1', [propertyId]
      );
      taxes = computeFolioTotals(total, ps?.tax_rate, ps?.service_charge_rate);
    }
    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (booking_id, payment_method, total_amount, served_by, property_id, order_type, table_number, table_id, kitchen_status,
                          table_session_id, confirmation_status, order_source, service_charge_amount, tax_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [bookingId || null, paymentMethodValue, total, servedBy || null, propertyId, orderType || 'takeaway', resolvedTableNumber, tableId || null, needsKitchen ? 'new' : null,
       sessionId, pending ? 'pending' : null, orderSource || null, taxes ? taxes.service_charge_amount : null, taxes ? taxes.tax_amount : null]
    );
    for (const item of items) {
      const product = productById.get(item.product_id);
      const qty = lineQty(item);
      const subtotal = parseFloat(item.unit_price) * qty;
      const oneBreakfast = parseFloat(product.meal_price) || 0;
      // Breakfast part: per night = the night's breakfasts × one breakfast
      // (never more than the night's price); one-off = units × meal_pax.
      const mealPerNight = product.per_night
        ? Math.min(parseFloat(item.unit_price) * parseInt(item.quantity), item.breakfasts * oneBreakfast)
        : 0;
      const mealAmount = product.per_night
        ? mealPerNight * item.nights.length
        : Math.min(subtotal, oneBreakfast * (parseInt(product.meal_pax) || 0) * qty);
      const { rows: [line] } = await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, meal_amount, per_night, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [sale.id, item.product_id, qty, item.unit_price, subtotal, mealAmount, !!product.per_night, item.description || null]
      );
      if (product.per_night) {
        for (const night of item.nights) {
          await client.query(
            `INSERT INTO booking_addons (property_id, booking_id, sale_id, sale_item_id, product_id, description, service_date,
                                         quantity, unit_price, meal_price, breakfasts, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [propertyId, bookingId, sale.id, line.id, product.id, product.name, night, parseInt(item.quantity),
             item.unit_price, oneBreakfast, item.breakfasts, servedBy || null]
          );
        }
        // A bargained price or a different breakfast count is noted on the booking.
        const notes = [];
        if (item.price_changed) notes.push(`Rp ${Math.round(item.unit_price).toLocaleString('id-ID')} per night instead of Rp ${Math.round(product.price).toLocaleString('id-ID')}`);
        if (item.breakfasts !== item.breakfasts_default) notes.push(`${item.breakfasts} breakfast${item.breakfasts === 1 ? '' : 's'} per night instead of ${item.breakfasts_default}`);
        if (notes.length) {
          await client.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, $3)', [
            bookingId, `${product.name} (${item.nights.join(', ')}): ${notes.join('; ')}.`.slice(0, 1000), servedBy || null]);
        }
        continue;   // an extra bed isn't taken out of stock per night
      }
      if (product.track_stock) {
        await client.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2', [item.quantity, item.product_id]);
        await client.query(
          `INSERT INTO stock_movements (property_id, product_id, change_qty, reason, reference_id, created_by)
           VALUES ($1,$2,$3,'sale',$4,$5)`,
          [propertyId, item.product_id, -item.quantity, sale.id, servedBy || null]
        );
      }
    }
    if (tableId) {
      await client.query("UPDATE restaurant_tables SET status = 'occupied' WHERE id = $1", [tableId]);
    }

    // room_charge means "post to the guest's folio" — folio_charges.type
    // has allowed 'sale' since migration 028 but nothing ever wrote one here,
    // so a room-service/POS-charged-to-room sale never showed up on the
    // guest's own Folio tab even though it was always billable. Posted
    // whether or not the order is still pending confirmation (same reasoning
    // as decrementing stock immediately — the charge is real from the moment
    // the guest orders); a rejected room-service order's charge is voided by
    // routes/resto.js's reject handler via sale_id.
    // Per-night items aren't posted here — their nights post with the room.
    const itemsText = list => list.map(i => `${i.quantity}× ${i.description || productById.get(i.product_id).name}`).join(', ');
    const folioDesc = itemsText(items.filter(i => !isPerNight(i))).slice(0, 200);
    const oneOffTotal = total - perNightTotal;
    if ((paymentMethodValue === 'room_charge' || (taxes && bookingId)) && oneOffTotal > 0) {
      await client.query(
        `INSERT INTO folio_charges (booking_id, type, description, quantity, unit_price, amount, posted_by, sale_id)
         VALUES ($1,'sale',$2,1,$3,$3,$4,$5)`,
        [bookingId, folioDesc, oneOffTotal, servedBy || null, sale.id]
      );
    }
    // Nights already past (the stay is in house or over) go on the folio now.
    if (stay && ['checked_in', 'checked_out'].includes(stay.status)) {
      const roomCharge = require('./roomChargeService');
      const end = stay.status === 'checked_out' ? stay.check_out_date : roomCharge.todayWITA();
      await roomCharge.postAddons(client, stay, end, servedBy || null);
    }
    if (taxes && bookingId) {
      await client.query(
        `INSERT INTO payments (booking_id, type, amount, status, method, received_at, received_by, notes, sale_id)
         VALUES ($1,'incidental',$2,'received',$3,NOW(),$4,$5,$6)`,
        [bookingId, taxes.total, paymentMethodValue, servedBy || null, `Paid at front desk: ${itemsText(items)}`.slice(0, 250), sale.id]
      );
    }

    await client.query('COMMIT');
    if (needsKitchen && !pending) sse.notify('kitchen:' + propertyId);
    sse.notify('resto:' + propertyId); // no-op if no clients — free for properties without the resto app
    return { sale };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createSale, FNB_CATEGORIES };
