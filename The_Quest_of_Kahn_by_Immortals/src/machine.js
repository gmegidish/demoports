// The PC as the demo sees it: a 320x200 8-bit screen, two work buffers, a 6-bit DAC and a 100 Hz timer.
// Addresses in comments are KAHN.EXE's data segment.

export const WIDTH = 320;
export const HEIGHT = 200;
export const SCREEN_BYTES = WIDTH * HEIGHT;
export const PALETTE_BYTES = 768;
/** MIDAS calls the demo's timer callback at this rate (registered with 100000, in 1/1000 Hz). 0x10c8c. */
export const TICKS_PER_SECOND = 100;

/**
 * One of the two tick counters. Both count the same interrupt; parts zero one or the other and
 * compare against it, so each is a view of the master tick count with its own origin.
 */
class TickCounter {
  constructor(machine) {
    this.machine = machine;
    this.origin = 0;
  }

  get value() {
    return this.machine.ticks - this.origin;
  }

  set value(ticks) {
    this.origin = this.machine.ticks - ticks;
  }
}

export function createMachine() {
  const machine = {
    width: WIDTH,
    height: HEIGHT,
    /** What the monitor shows (0x5937c points at it). */
    front: new Uint8Array(SCREEN_BYTES),
    /** Work buffer A (0x593a0) and B (0x593a4). */
    bufferA: new Uint8Array(SCREEN_BYTES),
    bufferB: new Uint8Array(SCREEN_BYTES),
    /** The VGA DAC: what was last written to ports 0x3c8/0x3c9. */
    dac: new Uint8Array(PALETTE_BYTES),
    /** The demo's own copy of the current palette (0x5c9b0), the input of every mixing table. */
    palette: new Uint8Array(PALETTE_BYTES),
    /** Timer interrupts since the music started; the runner advances it from the clock. */
    ticks: 0,
    /** Set by the demo at the point where the original starts the module. */
    isMusicStarted: false,
  };
  machine.timerA = new TickCounter(machine); // 0x593cc
  machine.timerB = new TickCounter(machine); // 0x593d0
  return machine;
}

/** Program the DAC from 256 RGB triplets. 0x1061c. */
export function setDac(machine, triplets) {
  machine.dac.set(triplets.subarray(0, PALETTE_BYTES));
}

/** Zero a screen-sized buffer. 0x10660. */
export function clearBuffer(buffer) {
  buffer.fill(0);
}

/** Copy a work buffer to the monitor. 0x1067c. Every loop of the demo ends a frame with this. */
export function showBuffer(machine, buffer) {
  machine.front.set(buffer);
}
