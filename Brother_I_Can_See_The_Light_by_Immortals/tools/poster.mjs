// Renders docs/poster.png: twenty-four moments of the demo, straight out of the port, no browser.
// Usage: node tools/poster.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { createDemo, finishLoading, seekTo } from '../src/demo.js';
import { renderFrame } from '../src/screen.js';
import { demoAssets, demoMusic, readDemoFile } from '../test/helpers.js';

const COLUMNS = 4;
/** Seconds from the start of the music, in order. */
const MOMENTS = [
  4, 13.6, 20, 28.5,
  34, 37.9, 40.5, 45.2,
  55, 60.5, 66, 73,
  80, 86.5, 93, 99.5,
  105.5, 112.5, 118, 126,
  133, 150, 160, 168,
];
/** Each moment is approached over this long, at 70 frames a second, so fades look as they do in play. */
const RUN_IN_SECONDS = 0.5;
const FRAME_SECONDS = 1 / 70;

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

const demo = createDemo(demoAssets(), demoMusic());
finishLoading(demo);
const font = readDemoFile('assets/vga8x16.bin');
const machine = demo.machine;
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = machine.width * COLUMNS;
const height = machine.height * rows;
const poster = Buffer.alloc(width * height * 3);

MOMENTS.forEach((seconds, cell) => {
  seekTo(demo, Math.max(machine.time, seconds - RUN_IN_SECONDS));
  while (machine.time + FRAME_SECONDS <= seconds) {
    machine.time += FRAME_SECONDS;
    demo.step();
  }
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
