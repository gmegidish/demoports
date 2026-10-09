// Render frames of one part on its own, to PNG, without sitting through the parts before it.
// Memory is set up as the boot block leaves it: the boot block and its messages, then every earlier part's bytes
// read to $a500 in turn (a part is loaded over its predecessor's leftovers), then the part itself.
//   node tools/part.mjs 3 out.png 0.5 10 60     (seconds from the moment the boot block calls the part)
import { readFileSync, writeFileSync } from 'node:fs';
import { createMachine } from '../src/machine.js';
import { createChip, custom, renderFrame, VIEW_WIDTH, VIEW_HEIGHT } from '../src/display.js';
import { readDisk } from '../src/disk.js';
import { part1 } from '../src/parts/part1.js';
import { part2 } from '../src/parts/part2.js';
import { part3 } from '../src/parts/part3.js';
import { contactSheet } from './png.mjs';

const BOOT = { offset: 0x2e, length: 0x400, address: 0x7f000 };
const MESSAGES = { offset: 0x400, length: 0x800, address: 0x7f400 };
const BOOT_COPPER = 0x7f18a;
const PART_ADDRESS = 0xa500;
const PARTS = [
  { offset: 0xc00, length: 0x19600, run: part1 },
  { offset: 0x1a200, length: 0x72000, run: part2 },
  { offset: 0x8c200, length: 0x44a00, run: part3 },
];

const [number, output, ...times] = process.argv.slice(2);
const adf = new Uint8Array(readFileSync(new URL('../assets/jesus-on-cheese.adf', import.meta.url)));
const m = createMachine();
m.chip = createChip();
m.clicks = [];
readDisk(m, adf, BOOT.offset, BOOT.length, BOOT.address);
readDisk(m, adf, MESSAGES.offset, MESSAGES.length, MESSAGES.address);
const index = Number(number) - 1;
for (const part of PARTS.slice(0, index + 1)) {
  readDisk(m, adf, part.offset, part.length, PART_ADDRESS);
}
m.cop1lc = BOOT_COPPER;
// The boot block's DMA: copper and bitplanes on.
custom(m, 0x96, 0x8380);
const sequence = PARTS[index].run(m, BOOT_COPPER);
let consumed = 0;
let isDone = false;
const frames = times.map(Number).sort((a, b) => a - b).map((seconds) => {
  while (!isDone && consumed <= seconds * 1000) {
    m.time = consumed;
    const step = sequence.next();
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
