const sharp = require('sharp');
const path = require('path');

const src = path.join(__dirname, '../public/logo.png');
const out = path.join(__dirname, '../public');

async function generate() {
  const sizes = [192, 512];
  for (const size of sizes) {
    await sharp(src)
      .resize(size, size, { fit: 'contain', background: { r: 45, g: 80, b: 22, alpha: 1 } })
      .png()
      .toFile(path.join(out, `pwa-${size}x${size}.png`));
    console.log(`✓ pwa-${size}x${size}.png`);
  }
  // Maskable icon (more padding so logo doesn't touch safe zone edges)
  await sharp(src)
    .resize(384, 384, { fit: 'contain', background: { r: 45, g: 80, b: 22, alpha: 1 } })
    .extend({ top: 64, bottom: 64, left: 64, right: 64, background: { r: 45, g: 80, b: 22, alpha: 1 } })
    .resize(512, 512)
    .png()
    .toFile(path.join(out, 'pwa-maskable-512x512.png'));
  console.log('✓ pwa-maskable-512x512.png');
  console.log('Done.');
}

generate().catch(console.error);
