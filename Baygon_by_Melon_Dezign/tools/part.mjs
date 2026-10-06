// Render frames of one part on its own, to PNG. Times are seconds from the moment the loader calls the part.
//   node tools/part.mjs src/parts/mushrooms.js Mushrooms out.png 0.5 3 8 [--decrunch=d3a68]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createMachine } from '../src/machine.js';
import { createChip, renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { loadDisk, decrunch } from '../src/disk.js';
import { contactSheet } from './png.mjs';

const BLANK_COPPER = 0x21aa;
const asset = (name) => new Uint8Array(readFileSync(new URL(`../assets/${name}`, import.meta.url)));

const options = process.argv.slice(2).filter((argument) => argument.startsWith('--'));
const [modulePath, exportName, output, ...times] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const m = createMachine();
m.chip = createChip();
m.unpacked = { 0xd3a68: asset('part-d3a68.bin'), 0xc96e8: asset('part-c96e8.bin') };
loadDisk(m, asset('baygon.adf'));
for (const option of options) {
  const entry = option.match(/^--decrunch=([0-9a-f]+)$/);
  if (entry) {
    decrunch(m, parseInt(entry[1], 16));
  }
}
m.cop1lc = BLANK_COPPER;
const part = (await import(pathToFileURL(modulePath).href))[exportName](m);
let consumed = 0;
let isDone = false;
const frames = times.map(Number).map((seconds) => {
  while (!isDone && consumed <= seconds * 1000) {
    m.time = consumed;
    const step = part.next();
    isDone = step.done;
    consumed += step.value ?? 0;
  }
  const pixels = new Uint32Array(VIEW_WIDTH * VIEW_HEIGHT);
  renderFrame(m, pixels);
  return new Uint8Array(pixels.buffer);
});
if (isDone) {
  console.log(`part returned after ${(consumed / 1000).toFixed(2)}s`);
}
writeFileSync(output, contactSheet(frames, VIEW_WIDTH, VIEW_HEIGHT));
