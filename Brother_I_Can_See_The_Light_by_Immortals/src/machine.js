// The PC as the demo sees it: a 320x200 8-bit screen, two work buffers, a 6-bit DAC, a 100 Hz
// timer and MIDAS's play status. Addresses in comments are TEST.EXE's (the program inside BROTHER.EXE).

import { rowAt } from './xm.js';
import { createTextScreen } from './textscreen.js';

export const WIDTH = 320;
export const HEIGHT = 200;
export const SCREEN_BYTES = WIDTH * HEIGHT;
export const PALETTE_BYTES = 768;
/** MIDAS calls the demo's timer callback at this rate (registered with 100000 mHz). 0x10cd0, 0x58474. */
export const TICKS_PER_SECOND = 100;
/** The DAC keeps the low six bits of what is written: 64 comes out as 0. */
const DAC_BITS = 63;

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

  /**
   * Zero the counter as of the moment the music reached (position, row). The original zeroes it on
   * the first pass that sees that row, a fraction of a tick later; after a seek the port has to
   * place that moment itself.
   */
  zeroAtRow(position, row) {
    this.origin = Math.floor(rowTime(this.machine, position, row) * TICKS_PER_SECOND);
  }
}

/** @param {{position: number, pattern: number, row: number, time: number}[]} timeline rows of the module, from xm.js */
export function createMachine(timeline) {
  const machine = {
    width: WIDTH,
    height: HEIGHT,
    /** Mode 3 before the graphics and after them; mode 13h in between. */
    isTextMode: true,
    textScreen: createTextScreen(),
    /** What the monitor shows in mode 13h (video memory, [0x5841c]). */
    front: new Uint8Array(SCREEN_BYTES),
    /** Work buffer A ([0x58440]) and B ([0x58444]). */
    bufferA: new Uint8Array(SCREEN_BYTES),
    bufferB: new Uint8Array(SCREEN_BYTES),
    /** The VGA DAC: what was last written to ports 0x3c8/0x3c9. */
    dac: new Uint8Array(PALETTE_BYTES),
    /** Seconds since the music started; the runner sets it from the music's clock before each step. */
    time: 0,
    timeline,
    /** Set by the demo at the point where the original starts the module. */
    isMusicStarted: false,
    /** MIDAS master volume, 0..64, as set at start-up ([0x58468] = 0x20), and as it is now. */
    baseVolume: 0x20,
    volume: 0x20,
    /** Timer interrupts since the music started. */
    get ticks() {
      return Math.floor(this.time * TICKS_PER_SECOND);
    },
  };
  machine.timerA = new TickCounter(machine); // 0x5846c
  machine.timerB = new TickCounter(machine); // 0x58470
  return machine;
}

/**
 * MIDASgetPlayStatus (0x10e50): the song position and the row the player is on.
 * @returns {{position: number, row: number}}
 */
export function playStatus(machine) {
  if (!machine.isMusicStarted) {
    return { position: 0, row: 0 };
  }
  const { position, row } = rowAt(machine.timeline, machine.time);
  return { position, row };
}

/** When (position, row) starts, in seconds of music. */
export function rowTime(machine, position, row) {
  const entry = machine.timeline.find((r) => r.position === position && r.row === row);
  if (!entry) {
    throw new Error(`the song never plays position ${position} row ${row}`);
  }
  return entry.time;
}

/** True once the music has reached (position, row). */
export function hasReached(machine, position, row) {
  const status = playStatus(machine);
  return status.position > position || (status.position === position && status.row >= row);
}

/** Program the whole DAC from 256 RGB triplets. 0x1067c. */
export function setDac(machine, triplets) {
  for (let i = 0; i < PALETTE_BYTES; i++) {
    machine.dac[i] = triplets[i] & DAC_BITS;
  }
}

/** One DAC entry. 0x1866c. */
export function setDacEntry(machine, index, r, g, b) {
  machine.dac[index * 3] = r & DAC_BITS;
  machine.dac[index * 3 + 1] = g & DAC_BITS;
  machine.dac[index * 3 + 2] = b & DAC_BITS;
}

/** Zero a screen-sized buffer. 0x106c0. */
export function clearBuffer(buffer) {
  buffer.fill(0);
}

/** Copy a work buffer to the monitor. 0x106dc. */
export function showBuffer(machine, buffer) {
  machine.front.set(buffer.subarray(0, SCREEN_BYTES));
}
