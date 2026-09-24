const sharp = require('sharp');

// Turns an uploaded property logo into the stored PNG: first trims the empty
// border around the artwork (transparent or plain background — sharp uses the
// top-left pixel as the background colour), then fits it inside 512×512.
// Logos are often exported with a lot of padding; untrimmed, the padding gets
// scaled along with the artwork and the logo looks tiny everywhere it's shown
// (PDF headers, the nav, Room/TV Display). Shared by the Superadmin logo
// upload (routes/admin.js) and maintenance/trimLogos.js (one-off for existing
// logos). Trimming an already-trimmed logo changes nothing.
async function processLogo(input) {
  let trimmed;
  try {
    trimmed = await sharp(input).trim({ threshold: 10 }).png().toBuffer();
  } catch (_) {
    // Nothing to trim (e.g. a single flat colour) — keep the image as-is.
    trimmed = input;
  }
  return sharp(trimmed)
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

module.exports = { processLogo };
