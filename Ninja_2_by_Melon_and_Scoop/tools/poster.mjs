// Renders docs/poster.png: one frame per scene, straight out of the port, no browser involved.
// Usage: node tools/poster.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { createRunner } from '../src/demo.js';

const CELL_WIDTH = 320;
const CELL_HEIGHT = 256;
const COLUMNS = 5;

/** Seconds into the music. Negative values are the silent opening logos. */
const MOMENTS = [
  -13.2, -3.6, 21, 31, 42,
  54, 57.6, 61, 64.6, 72,
  78.8, 80.6, 82.3, 87, 91.6,
  98, 103, 105.2, 112.7, 113.62,
  116.6, 119.6, 126, 134, 152,
];

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function encodePng(width, height, rgb) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const graphics = new Uint8Array(readFileSync(new URL('../assets/NINJA2.000', import.meta.url)));
const runner = createRunner(graphics);
const machine = runner.m;
while (machine.musicStartMs === null) {
  runner.advanceTo(machine.time + 1000);
}
// The logos have already gone by, so they come from a second pass.
const musicStartMs = machine.musicStartMs;

const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = CELL_WIDTH * COLUMNS;
const height = CELL_HEIGHT * rows;
const poster = Buffer.alloc(width * height * 3);

const pass = createRunner(graphics);
MOMENTS.forEach((seconds, cell) => {
  pass.advanceTo(musicStartMs + seconds * 1000);
  const m = pass.m;
  const cellX = (cell % COLUMNS) * CELL_WIDTH;
  const cellY = Math.floor(cell / COLUMNS) * CELL_HEIGHT;
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      // The credits are 640x480; every other frame is already the size of a cell.
      const sourceX = Math.floor((x * m.width) / CELL_WIDTH);
      const sourceY = Math.floor((y * m.height) / CELL_HEIGHT);
      const colour = m.front[sourceY * m.width + sourceX] * 3;
      const out = ((cellY + y) * width + cellX + x) * 3;
      for (let component = 0; component < 3; component++) {
        const value = m.palette[colour + component];
        poster[out + component] = (value << 2) | (value >> 4);
      }
    }
  }
});

writeFileSync(new URL('../docs/poster.png', import.meta.url), encodePng(width, height, poster));
