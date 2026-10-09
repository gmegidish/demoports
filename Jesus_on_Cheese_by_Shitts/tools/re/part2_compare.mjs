// Diff the JS port of part 2's handler against the original's memory, frame by frame.
// usage: node tools/re/part2_compare.mjs dump.bin frames [every]   (dump.bin from part2_handler.py, same args)
import { readFileSync } from 'node:fs';
import { enterPart2, part2Interrupt, flushLateCopperWrites } from '../../src/parts/part2.js';
import { machineWithPart2, snapshot, SNAPSHOT_BYTES, WATCHED } from './part2-watched.mjs';

const [dumpPath, frameArg, everyArg = '1'] = process.argv.slice(2);
const frames = Number(frameArg);
const every = Number(everyArg);
const dump = readFileSync(dumpPath);
const adf = new Uint8Array(readFileSync(new URL('../../assets/jesus-on-cheese.adf', import.meta.url)));
const m = machineWithPart2(adf);
enterPart2(m, 0x7f18a);

function whereIs(offset) {
  let at = 0;
  for (const [address, length] of WATCHED) {
    if (offset < at + length) {
      return `$${(address + offset - at).toString(16)}`;
    }
    at += length;
  }
  return 'COP1LC';
}

let mismatches = 0;
let compared = 0;
for (let frame = 1; frame <= frames; frame++) {
  part2Interrupt(m);
  flushLateCopperWrites(m);
  if ((frame - 1) % every !== 0) {
    continue;
  }
  const record = (frame - 1) / every;
  const expected = dump.subarray(record * SNAPSHOT_BYTES, (record + 1) * SNAPSHOT_BYTES);
  const actual = snapshot(m);
  compared++;
  const bad = [...actual].findIndex((byte, i) => byte !== expected[i]);
  if (bad >= 0) {
    mismatches++;
    if (mismatches <= 10) {
      process.stdout.write(`frame ${frame}: first difference at ${whereIs(bad)}: ${actual[bad]} vs ${expected[bad]}\n`);
    }
  }
}
process.stdout.write(`${compared} frames compared, ${mismatches} differ\n`);
