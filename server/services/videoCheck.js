// Checks an uploaded video before the lobby TV gets it (migration 116):
// MP4 with H.264 video, and how long it is. Reads only the file's box headers
// and its 'moov' index (a few hundred KB), never the whole video — the server
// has 1 GB of memory and does no converting.
const fs = require('fs');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

// Top-level boxes: [{ type, start, size, header }]
function topBoxes(fd, fileSize) {
  const boxes = [];
  let pos = 0;
  while (pos + 8 <= fileSize && boxes.length < 64) {
    const h = readAt(fd, pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let header = 8;
    if (size === 1) { size = Number(h.readBigUInt64BE(8)); header = 16; }
    else if (size === 0) size = fileSize - pos;
    if (size < header) break;
    boxes.push({ type, start: pos, size, header });
    pos += size;
  }
  return boxes;
}

// { ok, error?, seconds?, codec?, hasAudio? }
function checkMp4(filePath) {
  const fileSize = fs.statSync(filePath).size;
  const fd = fs.openSync(filePath, 'r');
  try {
    const boxes = topBoxes(fd, fileSize);
    if (boxes[0]?.type !== 'ftyp') return { ok: false, error: 'This is not an MP4 video. Export it as MP4 (H.264).' };
    const moov = boxes.find((b) => b.type === 'moov');
    if (!moov) return { ok: false, error: 'This video file is incomplete or damaged (no index). Export it again as MP4.' };
    if (moov.size > 20 * 1024 * 1024) return { ok: false, error: 'This video file has an unusual index. Export it again as MP4 (H.264).' };
    const m = readAt(fd, moov.start + moov.header, moov.size - moov.header);

    let seconds = null;
    const mv = m.indexOf('mvhd', 0, 'latin1');
    if (mv >= 0) {
      const v = m[mv + 4];
      const p = mv + 8; // after version + flags
      if (v === 1) {
        const timescale = m.readUInt32BE(p + 16);
        const duration = Number(m.readBigUInt64BE(p + 20));
        if (timescale) seconds = duration / timescale;
      } else {
        const timescale = m.readUInt32BE(p + 8);
        const duration = m.readUInt32BE(p + 12);
        if (timescale) seconds = duration / timescale;
      }
    }
    const has = (s) => m.indexOf(s, 0, 'latin1') >= 0;
    const codec = has('avc1') || has('avc3') ? 'h264'
      : has('hvc1') || has('hev1') ? 'hevc'
      : has('av01') ? 'av1' : has('vp09') ? 'vp9' : 'unknown';
    if (codec !== 'h264') {
      return { ok: false, codec, error: codec === 'hevc'
        ? 'This video is HEVC (H.265, e.g. from an iPhone) — the TV may not play it. Export it as MP4 H.264 ("Most compatible") and upload again.'
        : 'This video is not H.264 — the TV may not play it. Export it as MP4 H.264 and upload again.' };
    }
    return { ok: true, seconds, codec, hasAudio: has('mp4a') || has('ac-3') || has('ec-3') };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { checkMp4 };
