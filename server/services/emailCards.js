// Summary cards for the staff emails (Smart Reports + the night-audit email).
// Two cards per row — three was too narrow on a phone (values spilled out of
// their card). Cards in one row are always the same height (table cells).
//
// Email-safe on purpose: each card is a <td> (not a <div> inside one), in a
// table with border-spacing for the gaps, and every card in an email gets
// the same fixed height — so cards line up in equal rows in Gmail, Outlook
// and phone mail apps, whatever each card's content is (a card with one
// line under the number is as tall as one with two).

const CARD_TABLE_OPEN = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
  // The 8px border-spacing also sits outside the first/last card, so the
  // table is widened by 16px and pulled 8px left to line the cards up with
  // the text (clients without calc(), e.g. Outlook desktop, just keep the
  // small inset).
  + 'style="width:100%;width:calc(100% + 16px);border-collapse:separate;border-spacing:8px;table-layout:fixed;margin:0 -8px;">';
const CARD_TABLE_CLOSE = '</table>';

// Card heights: just the number, number + 1 line under it, or + 2 lines.
const CARD_HEIGHT = { none: 52, one: 68, two: 86 };

const subLine = (text, color = '#6b7280') =>
  `<div style="font-size:12px;line-height:17px;color:${color};margin-top:2px;">${text}</div>`;

// sub: plain text (one grey line) or HTML lines built with subLine().
function card(label, value, sub = '', { height = CARD_HEIGHT.one, valueColor = '#111827' } = {}) {
  const lines = !sub ? '' : String(sub).trim().startsWith('<') ? sub : subLine(sub);
  return `
    <td class="hk-card" width="50%" height="${height}" valign="top" style="width:50%;height:${height}px;vertical-align:top;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
      <div style="font-size:10px;line-height:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${label}</div>
      <div class="hk-val" style="font-size:20px;line-height:26px;font-weight:700;color:${valueColor};word-break:break-word;">${value}</div>
      ${lines}
    </td>`;
}

// Styles for small screens. Only works from <head>, so report emails are sent
// as a full document (emailDocument). Clients that ignore it (e.g. Outlook
// desktop) keep the normal sizes.
const MOBILE_STYLE = `
  @media only screen and (max-width: 520px) {
    .hk-card { padding: 12px 12px !important; }
    .hk-val { font-size: 17px !important; line-height: 22px !important; }
    .hk-wrap { padding: 18px 12px !important; }
  }`;

// Wraps an email body in a full HTML document with the mobile styles.
function emailDocument(bodyHtml, title = '') {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${MOBILE_STYLE}</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
${bodyHtml}
</body>
</html>`;
}

module.exports = { CARD_TABLE_OPEN, CARD_TABLE_CLOSE, CARD_HEIGHT, MOBILE_STYLE, card, subLine, emailDocument };
