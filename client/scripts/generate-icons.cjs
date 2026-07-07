const sharp = require('sharp');
const path = require('path');

const src = path.join(__dirname, '../public/logo.png');
const out = path.join(__dirname, '../public');
const maroon = { r: 92, g: 26, b: 46, alpha: 1 };

async function withMaroonBg(size, extraPad = 0) {
  const inner = size - extraPad * 2;
  const logo = await sharp(src)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: maroon },
  })
    .composite([{ input: logo, top: extraPad, left: extraPad }])
    .png()
    .toBuffer();
}

async function generate() {
  const sizes = [192, 512];
  for (const size of sizes) {
    const buf = await withMaroonBg(size);
    await sharp(buf).toFile(path.join(out, `pwa-${size}x${size}.png`));
    console.log(`✓ pwa-${size}x${size}.png`);
  }
  // Maskable icon (more padding so logo doesn't touch safe zone edges)
  const maskable = await withMaroonBg(512, 64);
  await sharp(maskable).toFile(path.join(out, 'pwa-maskable-512x512.png'));
  console.log('✓ pwa-maskable-512x512.png');
  console.log('Done.');
}

generate().catch(console.error);
