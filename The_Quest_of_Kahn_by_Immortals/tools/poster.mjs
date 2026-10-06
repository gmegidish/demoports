// Renders docs/poster.png: twenty-four moments of the demo, straight out of the port, no browser.
// Usage: node tools/poster.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { createDemo, finishLoading, seekTo } from '../src/demo.js';
import { TICKS_PER_SECOND } from '../src/machine.js';
import { demoAssets } from '../test/helpers.js';

const COLUMNS = 4;
/** Seconds from the start of the music, in order. */
const MOMENTS = [
  5, 15, 24, 31,
  44, 52, 62, 70,
  76, 81, 90, 100,
  115, 130, 136, 150,
  165, 175, 190, 205,
  260, 340, 355, 375,
];
/** Each moment is approached over this long, so feedback blurs and fades look as they do in play. */
const RUN_IN_SECONDS = 0.6;

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const demo = createDemo(demoAssets());
finishLoading(demo);
const machine = demo.machine;
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = machine.width * COLUMNS;
const height = machine.height * rows;
const poster = Buffer.alloc(width * height * 3);

MOMENTS.forEach((seconds, cell) => {
  const target = Math.round(seconds * TICKS_PER_SECOND);
  seekTo(demo, target - RUN_IN_SECONDS * TICKS_PER_SECOND);
  for (let ticks = machine.ticks + 1; ticks <= target; ticks++) {
    machine.ticks = ticks;
    demo.step();
  }
  const cellX = (cell % COLUMNS) * machine.width;
  const cellY = Math.floor(cell / COLUMNS) * machine.height;
  for (let y = 0; y < machine.height; y++) {
    for (let x = 0; x < machine.width; x++) {
      const colour = machine.front[y * machine.width + x] * 3;
      const out = ((cellY + y) * width + cellX + x) * 3;
      for (let component = 0; component < 3; component++) {
        const value = machine.dac[colour + component] & 63;
        poster[out + component] = (value << 2) | (value >> 4);
      }
    }
  }
});

writeFileSync(new URL('../docs/poster.png', import.meta.url), encodePng(width, height, poster));
process.stdout.write(`docs/poster.png: ${width}x${height}, ${MOMENTS.length} moments\n`);
