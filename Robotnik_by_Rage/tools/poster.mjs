// Renders docs/poster.png: twenty-four moments of the demo, straight out of the port, no browser.
// Usage: node tools/poster.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { createDemo, seekTo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { demoFiles, playTo, readDemoFile } from '../test/helpers.js';

const COLUMNS = 4;
/** Seconds on the soundtrack, in order: one or two moments of each part. */
const MOMENTS = [
  12, 20.5, 31.8, 38.5,
  45, 61, 75, 98,
  112, 133, 140, 170,
  200, 222, 239.2, 262,
  296, 318, 345, 365,
  369.5, 387.2, 396.3, 398.5,
];
/** Each moment is approached over this long, frame by frame, so state that builds up per frame is there. */
const RUN_IN_SECONDS = 2;

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

const demo = createDemo(demoFiles());
const font = readDemoFile('assets/vga8x16.bin');
const machine = demo.machine;
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = machine.width * COLUMNS;
const height = machine.height * rows;
const poster = Buffer.alloc(width * height * 3);

MOMENTS.forEach((seconds, cell) => {
  if (seconds - RUN_IN_SECONDS > machine.time) {
    seekTo(demo, seconds - RUN_IN_SECONDS);
  }
  playTo(demo, seconds);
  const frame = renderFrame(machine, font);
  const cellX = (cell % COLUMNS) * machine.width;
  const cellY = Math.floor(cell / COLUMNS) * machine.height;
  for (let y = 0; y < machine.height; y++) {
    for (let x = 0; x < machine.width; x++) {
      const rgba = frame.pixels[y * machine.width + x];
      const out = ((cellY + y) * width + cellX + x) * 3;
      poster[out] = rgba & 0xff;
      poster[out + 1] = (rgba >> 8) & 0xff;
      poster[out + 2] = (rgba >> 16) & 0xff;
    }
  }
});

writeFileSync(new URL('../docs/poster.png', import.meta.url), encodePng(width, height, poster));
process.stdout.write(`docs/poster.png: ${width}x${height}, ${MOMENTS.length} moments\n`);
