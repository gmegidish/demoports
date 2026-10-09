// The memory part 2's dispatcher and its non-scope effects own, in the order tools/re/part2_handler.py dumps it
// after each run of the original handler. Keep the two lists in sync.
import { createMachine } from '../../src/machine.js';
import { createChip, custom } from '../../src/display.js';
import { readDisk } from '../../src/disk.js';

export const WATCHED = [
  [0xa6bc, 2], [0xa6ee, 4], [0xce44, 4],
  [0xd072, 4],
  [0xd97e, 0x20],
  [0xd99e, 0x8c],
  [0xdaaa, 0x0a], [0xdb7e, 2], [0xdc94, 2], [0xddc6, 2], [0xde78, 2],
  [0x21e7a, 0x8c],
];
export const SNAPSHOT_BYTES = WATCHED.reduce((sum, [, length]) => sum + length, 0) + 4;
const PART2 = { offset: 0x1a200, length: 0x72000, address: 0xa500 };

/** A machine with nothing in it but part 2 (as the emulator harness has it) and the boot block's DMA on. */
export function machineWithPart2(adf) {
  const m = createMachine();
  m.chip = createChip();
  m.clicks = [];
  custom(m, 0x96, 0x8380);
  readDisk(m, adf, PART2.offset, PART2.length, PART2.address);
  return m;
}

/** The watched bytes and COP1LC, as one array. */
export function snapshot(m) {
  const out = new Uint8Array(SNAPSHOT_BYTES);
  let at = 0;
  for (const [address, length] of WATCHED) {
    out.set(m.mem.subarray(address, address + length), at);
    at += length;
  }
  new DataView(out.buffer).setUint32(at, m.cop1lc);
  return out;
}
