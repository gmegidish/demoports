// Diff the JS port of part 3 against the original handler run under Unicorn (tools/re/part3_handler.py).
// Both sides set memory up the same way (part 2's bytes, part 3 over them, the "no music" guard planted) and
// hash the same regions each frame, after the stars are drawn and before the scroller moves.
//   python -I tools/re/part3_handler.py part2.bin part3.bin 2000 300 > work/p3.txt
//   node tools/re/part3_compare.mjs work/p3.txt 300
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createMachine, w32 } from '../../src/machine.js';
import { createChip, custom } from '../../src/display.js';
import { readDisk } from '../../src/disk.js';
import { part3 } from '../../src/parts/part3.js';

const REGIONS = [
  ['star planes', 0x50000, 0x5a000],
  ['scroller planes', 0x59d80, 0x64830],
  ['copper list', 0xa9a0, 0xaa22],
  ['fade and speeds', 0xaa14, 0xaa22],
  ['stars', 0xbc22, 0xbf88],
  ['projected', 0xc7da, 0xca1e],
  ['phases and buffers', 0xdb00, 0xdb14],
  ['scroll state', 0xecde, 0xece2],
  ['stopped flag', 0x112ec, 0x112ee],
];
const MODULE = 0x112ee;
const NO_MUSIC = 0xabcdef;

const [hashFile, ...clicks] = process.argv.slice(2);
const expected = readFileSync(hashFile, 'utf8').trim().split('\n');
const adf = new Uint8Array(readFileSync(new URL('../../assets/jesus-on-cheese.adf', import.meta.url)));
const m = createMachine();
m.chip = createChip();
m.clicks = clicks.map(Number);
readDisk(m, adf, 0x1a200, 0x72000, 0xa500);
readDisk(m, adf, 0x8c200, 0x44a00, 0xa500);
w32(m, MODULE, NO_MUSIC);
custom(m, 0x96, 0x8380);

const hashRegion = ([, start, end]) => createHash('sha1').update(m.mem.subarray(start, end)).digest('hex').slice(0, 12);
const sequence = part3(m, 0x7f18a);
sequence.next();
let mismatches = 0;
for (let frame = 1; frame <= expected.length; frame++) {
  sequence.next();
  const actual = REGIONS.map(hashRegion);
  const wanted = expected[frame - 1].split(' ');
  const differing = REGIONS.filter((_, i) => actual[i] !== wanted[i]).map(([name]) => name);
  if (differing.length > 0) {
    mismatches++;
    if (mismatches <= 10) {
      console.log(`frame ${frame}: ${differing.join(', ')}`);
    }
  }
}
console.log(`${expected.length} frames, ${mismatches} differ`);
