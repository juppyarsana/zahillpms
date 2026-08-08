const nodemailer = require('nodemailer');
const db = require('../db');

// Replace {{placeholders}} in a template with booking data
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// Prepends a logo header to the rendered body at send time — templates
// themselves stay logo-free so this applies uniformly without editing
// every seeded row. Needs an absolute URL since email clients fetch
// images from the open internet, not relative paths.
function wrapEmailBody(html, { logo_url, property_name }) {
  if (!logo_url || !process.env.SERVER_PUBLIC_URL) return html;
  const logoSrc = `${process.env.SERVER_PUBLIC_URL}${logo_url}`;
  return `<div style="margin-bottom:16px"><img src="${logoSrc}" alt="${property_name || ''}" style="max-height:60px"></div>${html}`;
}

async function sendBookingEmail(propertyId, bookingId, trigger) {
  const { rows: [tmpl] } = await db.query(
    'SELECT * FROM email_templates WHERE property_id = $1 AND trigger = $2 AND is_active = true',
    [propertyId, trigger]
  );
  if (!tmpl) return { skipped: true, reason: 'no_template' };

  const { rows: [booking] } = await db.query(`
    SELECT b.id, b.property_id, b.check_in_date, b.check_out_date, b.nights,
           g.name AS guest_name, g.email AS guest_email,
           u.name AS unit_name,
           ps.property_name, ps.logo_url, ps.smtp_host, ps.smtp_port,
           ps.smtp_user, ps.smtp_password, ps.smtp_from
    FROM bookings b
    JOIN guests g ON g.id = b.guest_id
    JOIN units u ON u.id = b.unit_id
    JOIN property_settings ps ON ps.property_id = b.property_id
    WHERE b.id = $1
  `, [bookingId]);

  if (!booking) return { skipped: true, reason: 'booking_not_found' };
  if (!booking.guest_email) return { skipped: true, reason: 'no_guest_email' };

  const vars = {
    guest_name:     booking.guest_name,
    check_in_date:  booking.check_in_date,
    check_out_date: booking.check_out_date,
    nights:         booking.nights,
    unit_name:      booking.unit_name,
    property_name:  booking.property_name || 'The Property',
  };
  const subject = renderTemplate(tmpl.subject, vars);
  const html    = wrapEmailBody(renderTemplate(tmpl.body_html, vars), booking);

  const transportConfig = booking.smtp_host ? {
    host: booking.smtp_host,
    port: booking.smtp_port || 587,
    secure: false,
    auth: { user: booking.smtp_user, pass: booking.smtp_password },
  } : {
    host: process.env.PLATFORM_SMTP_HOST,
    port: parseInt(process.env.PLATFORM_SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.PLATFORM_SMTP_USER,
      pass: process.env.PLATFORM_SMTP_PASSWORD,
    },
  };

  const from = booking.smtp_from || process.env.PLATFORM_SMTP_FROM || 'noreply@platform.com';
  const transporter = nodemailer.createTransport(transportConfig);

  try {
    await transporter.sendMail({ from, to: booking.guest_email, subject, html });
    await db.query(
      `INSERT INTO communication_log (property_id, booking_id, trigger, channel, recipient, status)
       VALUES ($1, $2, $3, 'email', $4, 'sent')`,
      [booking.property_id, bookingId, trigger, booking.guest_email]
    );
    return { sent: true };
  } catch (err) {
    await db.query(
      `INSERT INTO communication_log (property_id, booking_id, trigger, channel, recipient, status, error)
       VALUES ($1, $2, $3, 'email', $4, 'failed', $5)`,
      [booking.property_id, bookingId, trigger, booking.guest_email, err.message]
    );
    return { sent: false, error: err.message };
  }
}

module.exports = { sendBookingEmail, renderTemplate };
