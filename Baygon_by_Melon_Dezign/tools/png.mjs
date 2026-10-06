// A minimal PNG writer and contact-sheet helper for the headless tools.
import { deflateSync, crc32 } from 'node:zlib';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Lay equally sized RGBA frames out left to right. */
export function contactSheet(frames, width, height) {
  const sheet = new Uint8Array(width * frames.length * height * 4);
  frames.forEach((frame, column) => {
    for (let y = 0; y < height; y++) {
      sheet.set(frame.subarray(y * width * 4, (y + 1) * width * 4), (y * width * frames.length + column * width) * 4);
    }
  });
  return encodePng(width * frames.length, height, sheet);
}
