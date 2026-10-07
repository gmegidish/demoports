// A minimal PNG writer for the headless tools: a rendered frame, as truecolour.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/**
 * @param {string} path
 * @param {{width: number, height: number, pixels: Uint32Array}} frame from renderFrame
 */
export function writeFramePng(path, { width, height, pixels }) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1) + 1;
    for (let x = 0; x < width; x++) {
      const rgba = pixels[y * width + x];
      raw[row + x * 3] = rgba & 0xff;
      raw[row + x * 3 + 1] = (rgba >> 8) & 0xff;
      raw[row + x * 3 + 2] = (rgba >> 16) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  writeFileSync(path, Buffer.concat([SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]));
}
