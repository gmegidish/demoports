// Renders docs/poster.png: twenty moments of the demo, straight out of the port, no browser involved.
// Usage: node tools/poster.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { encodePng } from './png.mjs';

const COLUMNS = 5;
/** Seconds of demo time, in order. */
const MOMENTS = [1, 7, 12, 15.7, 16.4, 20, 26, 33, 45, 56, 68, 79, 86, 95, 104, 116, 130, 180, 230, 257.3];

const asset = (name) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));
const runner = createRunner(asset('baygon.adf'), { 0xd3a68: asset('part-d3a68.bin'), 0xc96e8: asset('part-c96e8.bin') });
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = VIEW_WIDTH * COLUMNS;
const poster = new Uint8Array(width * VIEW_HEIGHT * rows * 4);
const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
const bytes = new Uint8Array(pixels.buffer);
MOMENTS.forEach((seconds, index) => {
  runner.advanceTo(seconds * 1000);
  renderFrame(runner.m, pixels);
  const left = (index % COLUMNS) * VIEW_WIDTH;
  const top = Math.floor(index / COLUMNS) * VIEW_HEIGHT;
  for (let y = 0; y < VIEW_HEIGHT; y++) {
    poster.set(bytes.subarray(y * VIEW_WIDTH * 4, (y + 1) * VIEW_WIDTH * 4), ((top + y) * width + left) * 4);
  }
});
writeFileSync(new URL('../docs/poster.png', import.meta.url), encodePng(width, VIEW_HEIGHT * rows, poster));
