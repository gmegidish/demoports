// main (0x5607b): two parts, each a main loop calling the current effect as fast as it can while a 30 Hz
// timer runs the scene functions from a timeline table. Notes: docs/disassembly/C1_core.md §2, §4, §5.
import { Machine, TICKS_PER_SECOND } from './machine.js';
import { loadData } from './tables.js';
import { palettePulse } from './helpers.js';
import { SCENES } from './scenes.js';
import { EFFECTS } from './effects/index.js';
import { unpackWwpack } from './wwpack.js';
import { ATTRIBUTE_TO_DAC, TEXT_COLOURS } from './textscreen.js';
import { GRAIN_PHASE, PALETTE_PULSE_OFF } from './addresses.js';

/** The 32-bit segment starts here in the unpacked image (the PMODE stub's code32 segment 0x10fc - 0x1010). */
const CODE32_OFFSET = 0xec0;
const PART1_TABLE = 0x17ce0;
const PART1_TABLE_LENGTH = 0xc15;
const PART1_END_TICK = 0xa7c;
const PART2_TABLE = 0xf2d0;
const PART2_TABLE_LENGTH = 0x2260;
const PART2_END_TICK = 0x21fc;
/** Part 2 starts after the second module is read and uploaded: tick 0 is at 90.50 s in the recording. */
const PART2_START_SECONDS = 90.5;
const NOISE_PHASE_STEP = 0xc1c;
const NOISE_PHASE_LIMIT = 0x3e800;
const DEFAULT_PASSES_PER_SECOND = 35;
/** Light grey on black, what DOS prints with. */
const TEXT_ATTRIBUTE = 0x07;

/** The timer interrupt (0x1b800 part 1, 0x1b7a4 part 2). */
function timerTick(m, part) {
  const tick = m.u32(0x1b707) + 1;
  m.set32(0x1b707, tick);
  const [table, length] = part === 1 ? [PART1_TABLE, PART1_TABLE_LENGTH] : [PART2_TABLE, PART2_TABLE_LENGTH];
  if (tick < length) {
    const scene = SCENES[m.u32(table + 4 * tick)];
    if (scene) {
      scene(m);
    }
  }
  if (part === 2 && m.u8(PALETTE_PULSE_OFF) === 0) {
    palettePulse(m);
  }
  let phase = m.u32(GRAIN_PHASE) + NOISE_PHASE_STEP;
  if (phase >= NOISE_PHASE_LIMIT) {
    phase = 0;
  }
  m.set32(GRAIN_PHASE, phase);
}

/** One part: the main loop, with the timer's ticks fired at their times between the frames. */
function* runPart(m, part, startSeconds, endTick) {
  m.set32(0x1b707, 0);
  let ticksFired = 0;
  for (;;) {
    const due = Math.floor((m.time - startSeconds) * TICKS_PER_SECOND + 1e-9);
    while (ticksFired < due) {
      timerTick(m, part);
      ticksFired++;
    }
    const effect = EFFECTS[m.u32(0x52185)];
    if (effect) {
      effect.draw(m);
    }
    yield m.time + 1 / (effect?.passesPerSecond ?? DEFAULT_PASSES_PER_SECOND);
    if (m.u32(0x1b707) >= endTick) {
      return;
    }
  }
}

function* runMain(m) {
  m.setMode13();
  m.dacGreyRamp(0x80);
  m.screen.fill(0xc0, 0xf8c0, 0xf8c0 + 320);
  m.borderColor = 0xc0;
  yield* runPart(m, 1, 0, PART1_END_TICK);
  m.set32(0x52185, 0x53fb0);
  m.dacGreyRamp(0xc0);
  yield PART2_START_SECONDS;
  yield* runPart(m, 2, PART2_START_SECONDS, PART2_END_TICK);
  showExitText(m);
  m.isOver = true;
}

/** int 10h ax=3, then DOS prints the '$'-terminated line at 0x5617c: 16 spaces and the copyright. */
function showExitText(m) {
  m.isTextMode = true;
  m.textScreen = new Uint8Array(4000);
  for (let i = 0; i < 2000; i++) {
    m.textScreen[i * 2] = 0x20;
    m.textScreen[i * 2 + 1] = TEXT_ATTRIBUTE;
  }
  let column = 0;
  for (let a = 0x5617c; m.u8(a) !== 0x24 && m.u8(a) !== 0x0d; a++) {
    m.textScreen[column * 2] = m.u8(a);
    column++;
  }
  for (let i = 0; i < 16; i++) {
    m.dac.set(TEXT_COLOURS[i], ATTRIBUTE_TO_DAC[i] * 3);
  }
}

/** The demo on virtual time, from the original files. */
export function createDemo({ exe, avi, fli }) {
  const image = unpackWwpack(exe).subarray(CODE32_OFFSET);
  const m = new Machine(image);
  loadData(m, avi, fli);
  const main = runMain(m);
  return {
    machine: m,
    runUntil(seconds, isOutOfTime = () => false) {
      while (!m.isOver && m.time < seconds && !isOutOfTime()) {
        const next = main.next();
        if (next.done) {
          m.isOver = true;
          break;
        }
        if (!(next.value > m.time)) {
          throw new Error(`time must move forward (${next.value} at ${m.time})`);
        }
        m.time = next.value;
      }
    },
  };
}
