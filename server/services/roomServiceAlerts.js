// Room service orders on Telegram (migration 159).
//
// A room tablet order goes to the POS, where the restaurant accepts it. If the
// POS screen is asleep nobody sees it, and the guest waits. So:
//   - every new order → alert_room_service (restaurant), straight away;
//   - still waiting in the POS → a reminder every 5 minutes; from the second
//     one (10 minutes) also to alert_room_service_late (front desk / owner);
//   - stops when the POS accepts, refuses or cancels it, or after 6 reminders.
// Each recipient gets it in their own language (notification_recipients.language).
// The watcher runs every minute from cron (checkAll).
const db = require('../db');
const telegram = require('./telegramService');
const posRoomOrders = require('./posRoomOrders');

const EVERY_MIN = 5;
const MAX_REMINDERS = 6;
const KEYS_NEW = ['alert_room_service'];
const KEYS_LATE = ['alert_room_service', 'alert_room_service_late'];

const rp = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const PAY = {
  en: { room: 'charge to room', cash: 'cash on delivery', card: 'card on delivery' },
  id: { room: 'tagih ke kamar', cash: 'bayar tunai saat diantar', card: 'bayar kartu saat diantar' },
};

function itemLines(items) {
  return (items || []).map(i => {
    const extras = [(i.addons || []).map(a => a.name).join(', '), i.note].filter(Boolean).join(' · ');
    return `${i.qty}× ${i.name}${extras ? ` (${extras})` : ''}`;
  });
}

function who(o, lang) {
  return `${lang === 'id' ? 'Kamar' : 'Room'} ${o.room}${o.guest ? ` · ${o.guest}` : ''}`;
}

function newText(o, accepted, lang) {
  const id = lang === 'id';
  return [
    `🛎 ${id ? 'Pesanan room service baru' : 'New room service order'} — ${who(o, lang)}`,
    ...itemLines(o.items),
    o.note ? `${id ? 'Catatan' : 'Note'}: ${o.note}` : null,
    `${rp(o.total)} · ${PAY[lang][o.payment] || PAY[lang].room}`,
    accepted
      ? (id ? 'Sudah langsung dikirim ke dapur.' : 'Already sent straight to the kitchen.')
      : (id ? 'Buka POS dan terima pesanannya.' : 'Open the POS and accept it.'),
  ].filter(Boolean).join('\n');
}

function reminderText(o, minutes, last, lang) {
  const id = lang === 'id';
  return [
    `⏰ ${id ? 'Room service BELUM DITERIMA' : 'Room service NOT ACCEPTED yet'} — ${who(o, lang)}`,
    id ? `Dipesan ${minutes} menit lalu.` : `Ordered ${minutes} minutes ago.`,
    ...itemLines(o.items),
    `${rp(o.total)} · ${PAY[lang][o.payment] || PAY[lang].room}`,
    id ? 'Tamu menunggu. Cek POS — apakah komputernya menyala?' : 'The guest is waiting. Check the POS — is the computer on?',
    last ? (id ? 'Ini pengingat terakhir — tolong telepon kamarnya.' : 'This is the last reminder — please call the room.') : null,
  ].filter(Boolean).join('\n');
}

// Called right after the POS took a new order (not a replay). Never throws.
async function placed(propertyId, order, stay) {
  try {
    const o = {
      room: stay.room, guest: stay.guest_name, items: order.items || [], note: order.note || '',
      total: order.total, payment: order.payment || 'room',
    };
    const accepted = order.status !== 'pending';
    if (!accepted && order.id) {
      await db.query(
        `INSERT INTO room_service_watch (property_id, pos_order_id, booking_id, room, guest, items, total, payment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (property_id, pos_order_id) DO NOTHING`,
        [propertyId, String(order.id), stay.booking_id || null, o.room, o.guest || null, JSON.stringify(o.items), o.total || 0, o.payment]);
    }
    await telegram.sendAlertLocalized(propertyId, KEYS_NEW, lang => newText(o, accepted, lang));
  } catch (err) {
    console.error('[roomServiceAlerts] placed:', err.message);
  }
}

const close = (id, status) =>
  db.query('UPDATE room_service_watch SET closed_at = NOW(), final_status = $2 WHERE id = $1', [id, status]);

// Every minute: read each waiting order back from the POS (one call per stay).
async function checkAll(now = new Date()) {
  const { rows } = await db.query('SELECT * FROM room_service_watch WHERE closed_at IS NULL ORDER BY placed_at');
  if (!rows.length) return 0;
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.property_id}|${r.booking_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const cfgs = new Map();
  let sent = 0;
  for (const list of groups.values()) {
    const { property_id: propertyId, booking_id: bookingId } = list[0];
    if (!cfgs.has(propertyId)) cfgs.set(propertyId, await posRoomOrders.config(propertyId));
    const cfg = cfgs.get(propertyId);
    let orders = null;
    if (bookingId && posRoomOrders.linked(cfg)) {
      try { orders = await posRoomOrders.ordersFor(cfg, bookingId); } catch (_) { orders = null; /* POS down: remind anyway */ }
    }
    for (const r of list) {
      const minutes = Math.floor((now - new Date(r.placed_at)) / 60000);
      if (!bookingId || !posRoomOrders.linked(cfg)) { await close(r.id, 'unwatched'); continue; }
      const found = orders && orders.find(o => String(o.id) === r.pos_order_id);
      if (orders && (!found || found.status !== 'pending')) { await close(r.id, found ? found.status : 'gone'); continue; }
      if (minutes > 120) { await close(r.id, 'expired'); continue; }
      if (r.reminders_sent >= MAX_REMINDERS) { await close(r.id, 'unanswered'); continue; }
      if (minutes < EVERY_MIN * (r.reminders_sent + 1)) continue;
      // At least 5 minutes between reminders, also after a gap (server restart).
      if (r.last_reminded_at && now - new Date(r.last_reminded_at) < (EVERY_MIN * 60 - 20) * 1000) continue;
      const n = r.reminders_sent + 1;
      const last = n >= MAX_REMINDERS || minutes >= EVERY_MIN * MAX_REMINDERS;
      const o = { room: r.room, guest: r.guest, items: r.items, total: r.total, payment: r.payment };
      await telegram.sendAlertLocalized(propertyId, n >= 2 ? KEYS_LATE : KEYS_NEW, lang => reminderText(o, minutes, last, lang));
      await db.query('UPDATE room_service_watch SET reminders_sent = $2, last_reminded_at = $3 WHERE id = $1', [r.id, n, now]);
      if (last) await close(r.id, 'unanswered');
      sent++;
    }
  }
  return sent;
}

module.exports = { placed, checkAll, newText, reminderText };
