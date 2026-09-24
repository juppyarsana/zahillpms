const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Guest ID documents (passport / KTP photo or scan). Stored on disk under
// server/uploads/ (gitignored), linked from guests.id_document_url as
// '/uploads/<file>'. They are personal data, so they are NOT served as
// static files any more — only through GET /api/guests/:id/id-document,
// which checks the guest belongs to the caller's property.
const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/tiff'];

// Saves an uploaded file (multer memory storage) and returns its URL.
// Photos are resized to max 1200px JPEG like before; a PDF (scanner output)
// is kept as-is. Anything else is rejected.
async function saveIdDocument(file, prefix) {
  const mime = String(file.mimetype || '').toLowerCase();
  const stamp = `${prefix}-${Date.now()}`;
  if (mime === 'application/pdf') {
    const filename = `${stamp}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
    return `/uploads/${filename}`;
  }
  if (IMAGE_TYPES.includes(mime) || mime.startsWith('image/')) {
    const filename = `${stamp}.jpg`;
    await sharp(file.buffer)
      .rotate() // respect the phone camera's orientation
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(path.join(UPLOAD_DIR, filename));
    return `/uploads/${filename}`;
  }
  const err = new Error('ID document must be a photo (JPG/PNG) or a PDF scan');
  err.status = 400;
  throw err;
}

// Absolute path for a stored id_document_url, or null if missing. Only the
// file name is used, so a stored URL can never point outside uploads/.
function idDocumentPath(url) {
  if (!url) return null;
  const file = path.join(UPLOAD_DIR, path.basename(String(url)));
  return fs.existsSync(file) ? file : null;
}

module.exports = { saveIdDocument, idDocumentPath };
