const db = require('../db');
const nodemailer = require('nodemailer');

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

async function sendAuditEmail(businessDate, data) {
  const { unitsOccupied, noShows, roomRevenue, ancillaryRevenue, pendingBalances, arrivingToday, tasksCreated } = data;

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const toAddr = (process.env.OWNER_EMAIL || '')
    .split(',').map(e => e.trim()).filter(Boolean);

  if (!gmailUser || !gmailPass || toAddr.length === 0) {
    console.log('[Night Audit] Email skipped — GMAIL_USER / GMAIL_APP_PASSWORD / OWNER_EMAIL not set');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  const fmtIDR = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const totalRevenue = Number(roomRevenue) + Number(ancillaryRevenue);

  const fmtDateLong = str => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const fmtDateShort = str => {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const tomorrow = nextDate(businessDate);

  function statCard(label, value, color) {
    return `
      <td style="width:50%;padding:6px;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 16px;">
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">${label}</div>
          <div style="font-size:20px;font-weight:700;color:${color || '#111827'};white-space:nowrap;">${value}</div>
        </div>
      </td>`;
  }

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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#2D5016;border-radius:12px 12px 0 0;padding:28px 32px;">
            <div style="color:#a3c96e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">
              Zahill Glamping · Kintamani, Bali
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

            <!-- Stat grid (2x2) -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                ${statCard('Units Occupied', unitsOccupied, '#2D5016')}
                ${statCard('Room Revenue', fmtIDR(roomRevenue), '#111827')}
              </tr>
              <tr>
                ${statCard('Other Revenue', fmtIDR(ancillaryRevenue), '#111827')}
                ${statCard('Total Revenue', fmtIDR(totalRevenue), '#2D5016')}
              </tr>
            </table>

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

            <!-- Pending balances -->
            <div style="margin-bottom:24px;">
              <div style="display:flex;align-items:center;margin-bottom:12px;">
                <span style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.05em;">
                  Payments Due Tomorrow
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
                <tbody>${listRows(pendingBalances, 'All balances settled — nothing due tomorrow.')}</tbody>
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
              Zahill PMS · Automated night audit · ${new Date().toISOString()}
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`.trim();

  await transporter.sendMail({
    from: `Zahill PMS <${gmailUser}>`,
    to: toAddr,
    subject: `[Zahill] Night Audit — ${fmtDateLong(businessDate)}`,
    html,
  });

  console.log(`[Night Audit] Email sent to ${toAddr}`);
}

async function runNightAudit(triggeredBy = 'auto') {
  console.log(`[Night Audit] Starting (triggered by: ${triggeredBy})`);

  // 1. Guard — duplicate run check (always audits yesterday)
  const businessDate = getYesterday();

  const { rows: existing } = await db.query(
    'SELECT id FROM night_audit_runs WHERE business_date = $1',
    [businessDate]
  );
  if (existing[0]) {
    console.log(`[Night Audit] Already run for ${businessDate}, skipping`);
    return { skipped: true, reason: 'already_run', business_date: businessDate };
  }

  // 2. No-show detection
  const { rows: noShows } = await db.query(
    `UPDATE bookings SET status = 'no_show', updated_at = NOW()
     WHERE status = 'confirmed' AND check_in_date = $1
     RETURNING id,
       (SELECT name FROM guests WHERE id = bookings.guest_id) AS guest_name,
       (SELECT name FROM units  WHERE id = bookings.unit_id)  AS unit_name`,
    [businessDate]
  );
  if (noShows.length) console.log(`[Night Audit] Flagged ${noShows.length} no-show(s)`);

  // 3. Room revenue tally (nightly rate × 1 night for each checked-in booking)
  const { rows: roomRows } = await db.query(
    `SELECT COALESCE(SUM(total_amount::numeric / GREATEST(nights, 1)), 0) AS room_revenue
     FROM bookings WHERE status = 'checked_in'`
  );
  const roomRevenue = parseFloat(roomRows[0].room_revenue);

  // 4. Ancillary revenue tally
  const { rows: ancillaryRows } = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS ancillary_revenue
     FROM sales WHERE DATE(created_at AT TIME ZONE 'Asia/Makassar') = $1`,
    [businessDate]
  );
  const ancillaryRevenue = parseFloat(ancillaryRows[0].ancillary_revenue);

  // 5. Pending balance alert (checkouts tomorrow)
  const tomorrow = nextDate(businessDate);
  const { rows: pendingBalances } = await db.query(
    `SELECT b.id, g.name AS guest_name, u.name AS unit_name, p.amount
     FROM bookings b
     JOIN guests g   ON g.id = b.guest_id
     JOIN units u    ON u.id = b.unit_id
     JOIN payments p ON p.booking_id = b.id AND p.type = 'balance' AND p.status = 'pending'
     WHERE b.check_out_date = $1 AND b.status IN ('confirmed','checked_in')`,
    [tomorrow]
  );

  // 6. Arriving guests (check-in = tomorrow)
  const { rows: arrivingToday } = await db.query(
    `SELECT g.name AS guest_name, u.name AS unit_name, b.num_guests
     FROM bookings b
     JOIN guests g ON g.id = b.guest_id
     JOIN units u  ON u.id = b.unit_id
     WHERE b.check_in_date = $1 AND b.status = 'confirmed'
     ORDER BY u.name`,
    [tomorrow]
  );

  // 8. Housekeeping task auto-generation for tomorrow's checkouts
  const { rows: checkouts } = await db.query(
    `SELECT b.id AS booking_id, u.id AS unit_id, u.name AS unit_name
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     WHERE b.check_out_date = $1 AND b.status IN ('confirmed','checked_in')`,
    [tomorrow]
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
        `INSERT INTO tasks (id, title, type, priority, status, unit_id, booking_id, due_time, created_at, updated_at)
         VALUES (uuid_generate_v4(), $1, 'housekeeping', 'high', 'todo', $2, $3,
                 ($4::date + INTERVAL '11 hours'), NOW(), NOW())`,
        [`Prep ${co.unit_name} for checkout`, co.unit_id, co.booking_id, tomorrow]
      );
      tasksCreated++;
    }
  }

  // 9. Record last audit time
  await db.query(
    `UPDATE property_settings SET business_date = $1, last_audit_at = NOW() WHERE id = 1`,
    [businessDate]
  );

  // Count currently occupied units
  const { rows: occRows } = await db.query(
    `SELECT COUNT(*) AS count FROM bookings WHERE status = 'checked_in'`
  );
  const unitsOccupied = parseInt(occRows[0].count);

  const summary = `${unitsOccupied} unit(s) occupied · ${noShows.length} no-show(s) · Rp ${(roomRevenue + ancillaryRevenue).toLocaleString('id-ID')} total revenue · ${arrivingToday.length} arriving today · ${pendingBalances.length} payment(s) due tomorrow`;

  // 10. Write audit log
  await db.query(
    `INSERT INTO night_audit_runs
       (id, business_date, triggered_by, units_occupied, no_shows,
        room_revenue, ancillary_revenue, pending_balances, arriving_today, tasks_created, summary)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      businessDate, triggeredBy, unitsOccupied,
      JSON.stringify(noShows), roomRevenue, ancillaryRevenue,
      JSON.stringify(pendingBalances), JSON.stringify(arrivingToday), tasksCreated, summary,
    ]
  );

  console.log(`[Night Audit] Done for ${businessDate}: ${summary}`);

  // 11. Owner email — best-effort, never blocks or fails the audit
  try {
    await sendAuditEmail(businessDate, { unitsOccupied, noShows, roomRevenue, ancillaryRevenue, pendingBalances, arrivingToday, tasksCreated });
  } catch (err) {
    console.error('[Night Audit] Email failed (audit still complete):', err.message);
  }

  return { success: true, business_date: businessDate, summary };
}

module.exports = { runNightAudit, getBusinessDate };
