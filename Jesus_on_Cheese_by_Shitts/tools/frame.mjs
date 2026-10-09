// Render moments of the whole demo to one PNG, left to right. No browser.
// usage: node tools/frame.mjs out.png 12.5 46 230   (seconds from the boot block)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRunner } from '../src/demo.js';
import { renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { contactSheet } from './png.mjs';

const [out, ...times] = process.argv.slice(2);
const adf = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));
const runner = createRunner(adf);
const frames = times.map(Number).sort((a, b) => a - b).map((seconds) => {
  runner.advanceTo(seconds * 1000);
  const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
  renderFrame(runner.m, pixels);
  return new Uint8Array(pixels.buffer);
});
writeFileSync(out, contactSheet(frames, VIEW_WIDTH, VIEW_HEIGHT));
