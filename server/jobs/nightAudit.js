const db = require('../db');
const nodemailer = require('nodemailer');
const { CARD_TABLE_OPEN, CARD_TABLE_CLOSE, CARD_HEIGHT, MOBILE_STYLE, card } = require('../services/emailCards');
const roomChargeService = require('../services/roomChargeService');
const { resolveSmtp } = require('../services/mailer');

function nextDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getYesterday() {
  // Current time shifted to WITA (UTC+8), minus 1 day
  const wita = new Date(Date.now() + 8 * 60 * 60 * 1000);
  wita.setUTCDate(wita.getUTCDate() - 1);
  const y = wita.getUTCFullYear();
  const m = String(wita.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wita.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// kept for external callers (e.g. /api/night-audit/latest)
async function getBusinessDate() {
  return getYesterday();
}

// Per-property, using the exact same two-tier SMTP fail-over as guest emails
// (services/mailer.js's resolveSmtp — see its comment for the full rule). Recipient is
// that property's own owner-role user(s), not a single hardcoded global inbox, which is
// what this function did before multi-tenancy (every property's audit used to land in
// one inbox under a "[Zahill]" subject regardless of which property it was actually for).
async function sendAuditEmail(propertyId, businessDate, data) {
  const { unitsOccupied, noShows, roomRevenue, fnbRevenue = 0, ancillaryRevenue, pendingBalances, arrivingToday, tasksCreated, overdueCheckouts = [] } = data;

  const { rows: [ps] } = await db.query(
    `SELECT property_name, property_address, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from
     FROM property_settings WHERE property_id = $1`,
    [propertyId]
  );
  const propertyName = ps?.property_name || 'The Property';

  const { rows: owners } = await db.query(
    `SELECT email FROM users WHERE property_id = $1 AND role = 'owner' AND email IS NOT NULL`,
    [propertyId]
  );
  const toAddr = owners.map(o => o.email).filter(Boolean);
  if (toAddr.length === 0) {
    console.log(`[Night Audit] Email skipped for ${propertyName} — no owner account with an email on file`);
    return;
  }

  const smtp = resolveSmtp(ps);
  if (!smtp) {
    console.log(`[Night Audit] Email skipped for ${propertyName} — no property SMTP configured and PLATFORM_SMTP_* not set`);
    return;
  }
  const { transportConfig, from } = smtp;

  const transporter = nodemailer.createTransport(transportConfig);

  const fmtIDR = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const totalRevenue = Number(roomRevenue) + Number(fnbRevenue) + Number(ancillaryRevenue);

  const fmtDateLong = str => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const fmtDateShort = str => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const tomorrow = nextDate(businessDate);

  // Equal-size summary cards, shared with the Smart Reports emails.
  const statCard = (label, value, color) => card(label, value, '', { height: CARD_HEIGHT.none, valueColor: color || '#111827' });

  function listRows(items, emptyMsg) {
    if (!items.length) return `<tr><td colspan="3" style="padding:12px;color:#9ca3af;font-size:13px;">${emptyMsg}</td></tr>`;
    return items.map(item => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#111827;">${item.guest_name}</td>
        <td style="padding:10px 12px;font-size:13px;color:#6b7280;">${item.unit_name}</td>
        ${item.amount != null
          ? `<td style="padding:10px 12px;font-size:13px;font-weight:700;color:#d97706;text-align:right;">${fmtIDR(item.amount)}</td>`
          : `<td style="padding:10px 12px;font-size:13px;color:#ef4444;">No-show</td>`
        }
      </tr>`).join('');
  }

  function arrivalRows(items) {
    if (!items.length) return `<tr><td colspan="3" style="padding:12px;color:#9ca3af;font-size:13px;">No arrivals scheduled for today.</td></tr>`;
    return items.map(item => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#111827;">${item.guest_name}</td>
        <td style="padding:10px 12px;font-size:13px;color:#6b7280;">${item.unit_name}</td>
        <td style="padding:10px 12px;font-size:13px;color:#6b7280;text-align:right;">${item.num_guests} guest${item.num_guests !== 1 ? 's' : ''}</td>
      </tr>`).join('');
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${MOBILE_STYLE}</style></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#2D5016;border-radius:12px 12px 0 0;padding:28px 32px;">
            <div style="color:#a3c96e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">
              ${propertyName}${ps?.property_address ? ` · ${ps.property_address}` : ''}
            </div>
            <div style="color:#ffffff;font-size:22px;font-weight:700;margin-bottom:4px;">
              Night Audit Report
            </div>
            <div style="color:#a3c96e;font-size:13px;">${fmtDateLong(businessDate)}</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px;">

            <!-- Stat grid (3x2, equal cards) -->
            <div style="margin-bottom:20px;">
            ${CARD_TABLE_OPEN}
            <tr>
              ${statCard('Rooms Occupied', unitsOccupied, '#2D5016')}
              ${statCard('Room Revenue (net)', fmtIDR(roomRevenue), '#111827')}
            </tr>
            <tr>
              ${statCard('F&B Revenue (net)', fmtIDR(fnbRevenue), '#111827')}
              ${statCard('Extras &amp; Activities', fmtIDR(ancillaryRevenue), '#111827')}
            </tr>
            <tr>
              ${statCard('Total Revenue', fmtIDR(totalRevenue), '#2D5016')}
              ${statCard('Arriving Today', arrivingToday.length, '#111827')}
            </tr>
            ${CARD_TABLE_CLOSE}
            </div>

            <!-- No-shows -->
            <div style="margin-bottom:24px;">
              <div style="display:flex;align-items:center;margin-bottom:12px;">
                <span style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.05em;">
                  No-shows Flagged
                </span>
                <span style="margin-left:8px;background:${noShows.length ? '#fee2e2' : '#d1fae5'};color:${noShows.length ? '#991b1b' : '#065f46'};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">
                  ${noShows.length}
                </span>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Guest</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Unit</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
                  </tr>
                </thead>
                <tbody>${listRows(noShows, 'No no-shows tonight — great!')}</tbody>
              </table>
            </div>

            <!-- Arriving tomorrow -->
            <div style="margin-bottom:24px;">
              <div style="display:flex;align-items:center;margin-bottom:12px;">
                <span style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.05em;">
                  Arriving Tomorrow
                </span>
                <span style="margin-left:8px;font-size:11px;color:#6b7280;">${fmtDateShort(tomorrow)}</span>
                <span style="margin-left:8px;background:${arrivingToday.length ? '#dbeafe' : '#d1fae5'};color:${arrivingToday.length ? '#1e40af' : '#065f46'};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">
                  ${arrivingToday.length}
                </span>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Guest</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Unit</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.05em;">Guests</th>
                  </tr>
                </thead>
                <tbody>${arrivalRows(arrivingToday)}</tbody>
              </table>
            </div>

            <!-- Still checked in past check-out: staff forgot to check them out,
                 or the stay was extended without amending the dates. -->
            ${overdueCheckouts.length ? `
            <div style="margin-bottom:24px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;">
              <div style="font-size:13px;font-weight:700;color:#991b1b;margin-bottom:8px;">
                ⚠ Still checked in past check-out (${overdueCheckouts.length})
              </div>
              ${overdueCheckouts.map(o => `
                <div style="font-size:13px;color:#7f1d1d;padding:3px 0;">
                  <b>${o.unit_name}</b> · ${o.guest_name} — was due out ${fmtDateShort(String(o.check_out_date).slice(0, 10))}
                </div>`).join('')}
              <div style="font-size:12px;color:#991b1b;margin-top:8px;">
                Their rooms stay blocked for new bookings until front desk checks them out or amends the dates.
              </div>
            </div>` : ''}

            <!-- Pending balances -->
            <div style="margin-bottom:24px;">
              <div style="display:flex;align-items:center;margin-bottom:12px;">
                <span style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.05em;">
                  To Collect — Guests Leaving
                </span>
                <span style="margin-left:8px;font-size:11px;color:#6b7280;">${fmtDateShort(tomorrow)}</span>
                <span style="margin-left:8px;background:${pendingBalances.length ? '#fef3c7' : '#d1fae5'};color:${pendingBalances.length ? '#92400e' : '#065f46'};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">
                  ${pendingBalances.length}
                </span>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Guest</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Unit</th>
                    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.05em;">Balance Due</th>
                  </tr>
                </thead>
                <tbody>${listRows(pendingBalances, 'Nothing to collect from guests leaving.')}</tbody>
              </table>
            </div>

            <!-- Tasks note -->
            ${tasksCreated > 0 ? `
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;font-size:13px;color:#166534;">
              ✅ ${tasksCreated} housekeeping task${tasksCreated !== 1 ? 's' : ''} auto-created for tomorrow's checkouts.
            </div>` : ''}

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-radius:0 0 12px 12px;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <div style="font-size:11px;color:#9ca3af;text-align:center;">
              ${propertyName} · Automated night audit · ${new Date().toISOString()}
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`.trim();

  await transporter.sendMail({
    from,
    to: toAddr,
    subject: `[${propertyName}] Night Audit — ${fmtDateLong(businessDate)}`,
    html,
  });

  console.log(`[Night Audit] Email sent to ${toAddr} for ${propertyName}`);
}

async function runNightAudit(triggeredBy = 'auto', propertyId) {
  if (!propertyId) throw new Error('runNightAudit requires a propertyId');
  console.log(`[Night Audit] Starting for property ${propertyId} (triggered by: ${triggeredBy})`);

  // 1. Guard — duplicate run check (always audits yesterday)
  const businessDate = getYesterday();

  const { rows: existing } = await db.query(
    'SELECT id FROM night_audit_runs WHERE business_date = $1 AND property_id = $2',
    [businessDate, propertyId]
  );
  if (existing[0]) {
    console.log(`[Night Audit] Already run for ${businessDate}, skipping`);
    return { skipped: true, reason: 'already_run', business_date: businessDate };
  }

  // 2. No-show detection — every booking due in on the business date that
  // never checked in (pending, deposit paid or confirmed), like the manual
  // Mark No-Show. Arrival day only: an older one someone put back with Undo
  // No-Show is never re-flagged. Money received stays recorded; FO can undo
  // it from the booking (PUT /api/bookings/:id/undo-no-show).
  const { rows: noShows } = await db.query(
    `UPDATE bookings SET status = 'no_show', updated_at = NOW()
     WHERE status IN ('pending', 'deposit_paid', 'confirmed') AND check_in_date = $1 AND property_id = $2
     RETURNING id,
       (SELECT name FROM guests WHERE id = bookings.guest_id) AS guest_name,
       (SELECT name FROM units  WHERE id = bookings.unit_id)  AS unit_name`,
    [businessDate, propertyId]
  );
  for (const ns of noShows) {
    try {
      await roomChargeService.voidAll(db, ns.id, null);
      await db.query('INSERT INTO booking_events (booking_id, note, created_by) VALUES ($1, $2, NULL)',
        [ns.id, 'Marked no-show by the night audit (never checked in on the arrival day).']);
    } catch (e) {
      console.error(`[Night Audit] no-show follow-up failed for ${ns.id}:`, e.message);
    }
  }
  if (noShows.length) console.log(`[Night Audit] Flagged ${noShows.length} no-show(s)`);

  // 2b. Post the just-closed night's room + F&B folio charges for every
  // in-house booking. Each booking runs in its own transaction so one bad
  // row can't abort the audit; postNight is idempotent (existence check +
  // uq_folio_charges_night), so a full re-run — even after a partial crash —
  // posts nothing new.
  const { rows: inHouse } = await db.query(
    `SELECT b.id, b.check_in_date, b.check_out_date, b.room_revenue, b.total_amount, b.fnb_revenue,
            rp.code AS rate_plan_code
     FROM bookings b
     LEFT JOIN rate_plans rp ON rp.id = b.rate_plan_id
     WHERE b.property_id = $1 AND b.status = 'checked_in'
       AND b.check_in_date <= $2 AND b.check_out_date > $2`,
    [propertyId, businessDate]
  );
  let folioPosted = 0, folioFailed = 0;
  for (const bk of inHouse) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const nights = roomChargeService.stayNights(bk.check_in_date, bk.check_out_date);
      const idx = Math.max(0, nights.indexOf(businessDate));
      const r = await roomChargeService.postNight(client, {
        bookingId: bk.id,
        serviceDate: businessDate,
        roomNet: roomChargeService.nightlyAmount(bk.room_revenue ?? bk.total_amount, nights.length, idx),
        mealNet: roomChargeService.nightlyAmount(bk.fnb_revenue, nights.length, idx),
        ratePlanCode: bk.rate_plan_code || 'RO',
      });
      // Per-night extras (extra bed…) for this night — and any earlier night
      // added after the fact that isn't on the folio yet.
      const addons = await roomChargeService.postAddons(client, bk, nextDate(businessDate));
      await client.query('COMMIT');
      if (r.roomPosted || r.fnbPosted || addons) folioPosted++;
    } catch (err) {
      await client.query('ROLLBACK');
      folioFailed++;
      console.error(`[Night Audit] Folio post failed for booking ${bk.id}:`, err.message);
    } finally {
      client.release();
    }
  }
  if (inHouse.length) console.log(`[Night Audit] Folio: ${folioPosted} booking(s) posted, ${folioFailed} failed`);

  // 3+4. Rooms sold + revenue for the business date — the Reports page's
  // own getReport(), so the audit, Daily Close and /reports never disagree
  // (every booking except cancelled / no-show; night-based; extras by the
  // day they were sold). Runs after the no-show step above.
  const { getReport } = require('../routes/reports');
  const day = await getReport(propertyId, businessDate, businessDate);
  const roomRevenue = day.room_revenue;
  const fnbRevenue = day.fnb_revenue;
  // Extras + activities (migration 078) together — the audit keeps one
  // "other revenue" figure (night_audit_runs.ancillary_revenue).
  const ancillaryRevenue = day.ancillary_revenue + (day.activity_revenue || 0);

  // 5+6. The new day's balances to collect from guests leaving, and its
  // arrivals — the same lists as Balance Due / Guest Lists (and the Daily
  // Close): whole-stay balance incl. extras, agent-billed stays left out;
  // every arrival not yet checked in, paid or not.
  const tomorrow = nextDate(businessDate);
  const { loadGuestLists, loadBalanceDue } = require('../routes/bookings');
  const [gl, due] = await Promise.all([
    loadGuestLists(propertyId, tomorrow),
    loadBalanceDue(propertyId, tomorrow),
  ]);
  const pendingBalances = due.departing
    .filter(r => !r.agent_billed)
    .map(r => ({ id: r.id, guest_name: r.guest_name, unit_name: r.unit_name, amount: r.balance_due }));
  const arrivingToday = gl.arrivals
    .map(a => ({ guest_name: a.guest_name, unit_name: a.unit_name, num_guests: a.num_guests }));

  // 7. Guests still checked in on or after their check-out date. The audit
  // runs at night, so anyone due out today who hasn't been checked out by now
  // counts too. Reported to the owner; their rooms stay blocked for new
  // bookings (routes/bookings.js occupiedUntilSql) until it's sorted.
  const { rows: overdueCheckouts } = await db.query(
    `SELECT b.id, g.name AS guest_name, u.name AS unit_name, b.check_out_date
     FROM bookings b
     JOIN guests g ON g.id = b.guest_id
     JOIN units u  ON u.id = b.unit_id
     WHERE b.status = 'checked_in' AND b.check_out_date <= $1 AND b.property_id = $2
     ORDER BY b.check_out_date, u.name`,
    [businessDate, propertyId]
  );

  // 8. Housekeeping task auto-generation for tomorrow's checkouts
  const { rows: checkouts } = await db.query(
    `SELECT b.id AS booking_id, u.id AS unit_id, u.name AS unit_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     WHERE b.check_out_date = $1 AND b.status IN ('confirmed','checked_in') AND b.property_id = $2`,
    [tomorrow, propertyId]
  );

  let tasksCreated = 0;
  for (const co of checkouts) {
    const { rows: existingTask } = await db.query(
      `SELECT id FROM tasks
       WHERE booking_id = $1 AND type = 'housekeeping'
         AND due_time::date = $2`,
      [co.booking_id, tomorrow]
    );
    if (!existingTask[0]) {
      await db.query(
        `INSERT INTO tasks (id, title, type, priority, status, unit_id, booking_id, due_time, created_at, updated_at, property_id)
         VALUES (uuid_generate_v4(), $1, 'housekeeping', 'high', 'todo', $2, $3,
                 ($4::date + INTERVAL '11 hours'), NOW(), NOW(), $5)`,
        [`Prep ${co.unit_name} for checkout`, co.unit_id, co.booking_id, tomorrow, propertyId]
      );
      tasksCreated++;
    }
  }

  // 9. Record last audit time
  await db.query(
    `UPDATE property_settings SET business_date = $1, last_audit_at = NOW() WHERE property_id = $2`,
    [businessDate, propertyId]
  );

  // Rooms sold that night — same figure as the Daily Close / Reports.
  const unitsOccupied = day.total_nights;

  const folioNote = inHouse.length ? ` · ${folioPosted} folio night(s) posted${folioFailed ? ` (${folioFailed} failed)` : ''}` : '';
  const summary = `${unitsOccupied} unit(s) occupied · ${noShows.length} no-show(s) · Rp ${(roomRevenue + fnbRevenue + ancillaryRevenue).toLocaleString('id-ID')} total revenue · ${arrivingToday.length} arriving today · ${pendingBalances.length} balance(s) to collect from guests leaving today${overdueCheckouts.length ? ` · ${overdueCheckouts.length} still checked in past check-out` : ''}${folioNote}`;

  // 10. The full audit report (charges posted room by room, what the audit
  // did, the day's figures, money received) — saved with the run so a
  // reprint later shows the day as it was closed. Never fails the audit.
  let detail = null;
  try {
    detail = await require('../services/nightAuditDetail').buildAuditDetail(propertyId, businessDate, {
      no_shows: noShows, overdue: overdueCheckouts, tasks_created: tasksCreated, folio_failed: folioFailed,
    });
  } catch (err) {
    console.error('[Night Audit] Detail report failed (audit still complete):', err.message);
  }

  // 11. Write audit log
  await db.query(
    `INSERT INTO night_audit_runs
       (id, business_date, triggered_by, units_occupied, no_shows,
        room_revenue, fnb_revenue, ancillary_revenue, pending_balances, arriving_today, tasks_created, summary, property_id, detail)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      businessDate, triggeredBy, unitsOccupied,
      JSON.stringify(noShows), roomRevenue, fnbRevenue, ancillaryRevenue,
      JSON.stringify(pendingBalances), JSON.stringify(arrivingToday), tasksCreated, summary, propertyId,
      detail ? JSON.stringify(detail) : null,
    ]
  );

  console.log(`[Night Audit] Done for ${businessDate}: ${summary}`);

  // 12. Owner email — best-effort, never blocks or fails the audit. Skipped
  // when the property gets the Daily Close (Reports & Alerts), which carries
  // the same content at 00:30.
  try {
    if (await require('../services/dailyClose').dailyCloseReplacesAuditEmail(propertyId)) {
      console.log('[Night Audit] Owner email skipped — the Daily Close report replaces it');
      return { success: true, business_date: businessDate, summary };
    }
    await sendAuditEmail(propertyId, businessDate, { unitsOccupied, noShows, roomRevenue, fnbRevenue, ancillaryRevenue, pendingBalances, arrivingToday, tasksCreated, overdueCheckouts });
  } catch (err) {
    console.error('[Night Audit] Email failed (audit still complete):', err.message);
  }

  return { success: true, business_date: businessDate, summary };
}

async function runNightAuditAllProperties(triggeredBy = 'auto') {
  const { rows: properties } = await db.query('SELECT id FROM properties WHERE is_active = true');
  for (const prop of properties) {
    try {
      await runNightAudit(triggeredBy, prop.id);
    } catch (err) {
      console.error(`[Night Audit] Failed for property ${prop.id}:`, err.message);
    }
  }
}

module.exports = { runNightAudit, runNightAuditAllProperties, getBusinessDate };
