// Render frames of the port headless, to PNG: node tools/frame.mjs out.png 4.2 [7.5 ...]
// Several times make a contact sheet, left to right.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { contactSheet } from './png.mjs';

const asset = (name) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));

const [output, ...times] = process.argv.slice(2);
const runner = createRunner(asset('baygon.adf'), {
  0xd3a68: asset('part-d3a68.bin'),
  0xc96e8: asset('part-c96e8.bin'),
});
const frames = times.map(Number).map((seconds) => {
  runner.advanceTo(seconds * 1000);
  const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
  renderFrame(runner.m, pixels);
  return new Uint8Array(pixels.buffer);
});
writeFileSync(output, contactSheet(frames, VIEW_WIDTH, VIEW_HEIGHT));
