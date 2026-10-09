// Renders docs/poster.png: twenty moments of the demo, straight out of the port, no browser involved.
// Usage: node tools/poster.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { FRAME_MS } from '../src/machine.js';
import { encodePng } from './png.mjs';

const COLUMNS = 5;
const PART1 = 326;
const PART2 = 2361;
const PART3 = 12415;
/** Frames since the boot block started, in order. */
const MOMENTS = [
  150, PART1 + 0x1c0 + 20, PART1 + 0x230 + 20, PART1 + 0x2a0 + 20, 1500,
  ...[300, 700, 1272, 2000, 2400, 2882, 2911, 3580, 4600, 5241, 5700, 7800, 8700].map((frame) => PART2 + frame),
  PART3 + 2000, PART3 + 6000,
];

const runner = createRunner(new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url))));
const rows = Math.ceil(MOMENTS.length / COLUMNS);
const width = VIEW_WIDTH * COLUMNS;
const poster = new Uint8Array(width * VIEW_HEIGHT * rows * 4);
const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
const bytes = new Uint8Array(pixels.buffer);
MOMENTS.forEach((frame, index) => {
  // Half a frame into the frame, so the runner has just run its vertical blank.
  runner.advanceTo((frame - 0.5) * FRAME_MS);
  renderFrame(runner.m, pixels);
  const left = (index % COLUMNS) * VIEW_WIDTH;
  const top = Math.floor(index / COLUMNS) * VIEW_HEIGHT;
  for (let y = 0; y < VIEW_HEIGHT; y++) {
    poster.set(bytes.subarray(y * VIEW_WIDTH * 4, (y + 1) * VIEW_WIDTH * 4), ((top + y) * width + left) * 4);
  }
});
writeFileSync(new URL('../docs/poster.png', import.meta.url), encodePng(width, VIEW_HEIGHT * rows, poster));
