// The machine the demo runs on: one megabyte of real-mode memory with the unpacked program at segment 0, the VGA,
// and the timer's frame counter.
//
// Memory is addressed linearly (segment * 16 + offset). RED.EXE is unpacked and rebased to segment 0 (pklite.js),
// so the address `16b2:0200` in docs/disassembly is m.mem[0x16b20 + 0x200]. Tables, variables and self-modified
// immediates stay at their original addresses. The whole demo is one program: the memory lives from start to end.
import { Vga } from './vga.js';

const MEMORY_SIZE = 0x110000;
/** The data segment every part addresses through ds (0000:0040 `mov ax,16b2`). */
export const DATA = 0x16b20;
/** 16b2:0200, the frame counter: the timer IRQ 0000:0278 increments it at every vertical retrace. */
const FRAME_COUNTER = DATA + 0x200;
/** 16b2:01fe, the last frame counter value 0000:05a7 saw. */
const FRAME_SEEN = DATA + 0x1fe;

/** A far pointer seg:off as a linear address. */
export function linear(segment, offset) {
  return segment * 16 + offset;
}

export class Machine {
  /** @param {Uint8Array} image the unpacked program, rebased to segment 0 */
  constructor(image, vga = new Vga()) {
    this.mem = new Uint8Array(MEMORY_SIZE);
    this.view = new DataView(this.mem.buffer);
    this.mem.set(image);
    this.vga = vga;
    /** The timer IRQ 0000:0278 is installed (0000:02b7) or not (0000:0365 restores the BIOS one). */
    this.isTimerInstalled = false;
  }

  /** What the timer IRQ does at a vertical retrace; the frame loop calls it. */
  timerInterrupt() {
    if (this.isTimerInstalled) {
      this.frameCounter = (this.frameCounter + 1) & 0xffff;
    }
  }

  get frameCounter() {
    return this.u16(FRAME_COUNTER);
  }

  set frameCounter(value) {
    this.set16(FRAME_COUNTER, value);
  }

  // ---- memory, linear addresses ----

  u8(a) {
    return this.mem[a];
  }

  s8(a) {
    return (this.mem[a] << 24) >> 24;
  }

  u16(a) {
    return this.mem[a] | (this.mem[a + 1] << 8);
  }

  s16(a) {
    return (this.u16(a) << 16) >> 16;
  }

  u32(a) {
    return this.view.getUint32(a, true);
  }

  set8(a, v) {
    this.mem[a] = v;
  }

  set16(a, v) {
    this.mem[a] = v;
    this.mem[a + 1] = v >> 8;
  }

  set32(a, v) {
    this.view.setUint32(a, v >>> 0, true);
  }
}

/**
 * 0000:05a7: waits until the frame counter differs from the value seen last time, i.e. the next retrace unless
 * the caller is already late. In a part: `yield* waitFrame(m)`.
 */
export function* waitFrame(m) {
  while (m.u16(FRAME_SEEN) === m.frameCounter) {
    yield;
  }
  m.set16(FRAME_SEEN, m.frameCounter);
}

/**
 * 0000:05be: polls 3da for the start of the next vertical retrace (used once the timer IRQ is gone).
 * In a part: `yield* waitRetrace(m)`.
 */
export function* waitRetrace() {
  yield;
}
