// The PC as the demo sees it: VGA mode 13h (320x200, one byte per pixel, 6-bit DAC), the 70.086 Hz
// timer callback MIDAS runs before each vertical retrace, and MIDAS's play status of the song that
// is playing. Addresses in comments are ROBOTNIK.EXE's.
//
// Timing: real hardware, not the recording. The port runs on one clock, the soundtrack's: the song
// plays at its true speed (assets/music.ogg; positions and rows from xm.js rowTimeline) and the timer
// ticks 70.086 times per second of it (ticks, frame). In the reference recording (DOSBox Staging,
// demo.avi) the song ran 0.24-0.44% fast against the 70 Hz frames, so there its sync entries land
// progressively earlier against the frame counter than they would on a PC: about 0.01 s at the start
// of a song, ~0.37 s late in the demo song. The port deliberately does not reproduce that skew; no
// part rescales the clock or shifts sync entries to follow the recording. Measured timings of the
// original program (init durations, DOSBox's pass schedules in ticks) stay, as ticks of this clock.
// Tests that compare against recording frames find them at a fitted moment (tools/re/fixtures.py).
// No constant MIDAS reporting lead is modelled: at the first entry of each song the recording saw it
// ~6 ticks early in the intro (4.5 s in) and ~1.5 ticks early in the demo (2.2 s in), not one value.

import { rowAt } from './xm.js';
import { createTextScreen } from './textscreen.js';

export const WIDTH = 320;
export const HEIGHT = 200;
export const SCREEN_BYTES = WIDTH * HEIGHT;
export const PALETTE_BYTES = 768;
/** Mode 13h refresh in DOSBox (and on a VGA): MIDAS calls timerTick 0x12280 once per retrace. */
export const TICKS_PER_SECOND = 70.086;
/** 0x121d4: frame = row * 49 / 5, 9.8 ticks per 0.14 s row. */
const FRAMES_PER_ROW_NUMERATOR = 49;
const FRAMES_PER_ROW_DENOMINATOR = 5;
const DAC_BITS = 63;

/**
 * @param {{intro: object[], demo: object[]}} timelines rowTimeline() of pullmax.xm and bergborr.xm
 * @param {{intro: number, demo: number}} songStarts where each song starts on the soundtrack, seconds
 */
export function createMachine(timelines, songStarts) {
  return {
    width: WIDTH,
    height: HEIGHT,
    isTextMode: true,
    textScreen: createTextScreen(),
    /** Video memory at 0xa0000. */
    front: new Uint8Array(SCREEN_BYTES),
    /** The VGA DAC, 6-bit triplets. */
    dac: new Uint8Array(PALETTE_BYTES),
    /** Seconds on the soundtrack; the driver sets it before each step. */
    time: 0,
    timelines,
    songStarts,
    /** 'intro', 'demo' or null: which module MIDAS is playing. */
    song: null,
    /** [0x91280] sync entries already passed, [0x91284] the table (sync.js). */
    syncIndex: 0,
    syncTable: null,
    /** [0x91260] = frameBase + ticks since frameOrigin. */
    frameBase: 0,
    frameOrigin: 0,
    isOver: false,
  };
}

/** Seconds since the playing song started (negative before it starts). */
export function songTime(machine) {
  return machine.time - machine.songStarts[machine.song];
}

/** Timer ticks since the playing song started: how many times 0x12280 has run. */
export function ticks(machine) {
  return Math.floor(songTime(machine) * TICKS_PER_SECOND);
}

/** 0x12198 getStatus: the song position and row MIDAS reports now. */
export function playStatus(machine) {
  const t = songTime(machine);
  if (t < 0) {
    return { position: 0, row: 0, time: 0 };
  }
  return rowAt(machine.timelines[machine.song], t);
}

/** 0x12204 syncAdvance: index of the first sync entry the song has not reached yet. */
export function syncAdvance(machine) {
  const { position, row } = playStatus(machine);
  const table = machine.syncTable;
  let i = machine.syncIndex;
  while (position > table[i].position || (position === table[i].position && row >= table[i].row)) {
    i++;
  }
  machine.syncIndex = i;
  return i;
}

/**
 * 0x121d4 resyncFrame: frame = row * 49 / 5. The original calls it on the first loop pass after the
 * row began, within a tick of it; the port counts on from the row's first tick. `atSongSeconds`
 * resyncs as the original did at an earlier moment of the playing song (for parts that catch up
 * after a seek).
 */
export function resyncFrame(machine, atSongSeconds) {
  const status = atSongSeconds === undefined ? playStatus(machine) : rowAt(machine.timelines[machine.song], atSongSeconds);
  machine.frameBase = Math.floor((status.row * FRAMES_PER_ROW_NUMERATOR) / FRAMES_PER_ROW_DENOMINATOR);
  machine.frameOrigin = Math.floor(status.time * TICKS_PER_SECOND);
}

/** [0x91260]: the frame counter parts animate by. */
export function frame(machine) {
  return machine.frameBase + ticks(machine) - machine.frameOrigin;
}

/**
 * [0x91260] at the moment the playing song reaches sync entry `index`: what a part's busy wait for
 * that entry reads. Parts that time an effect from its entry use this instead of the frame at which
 * the port's loop noticed the entry, so the effect is in the same place after a seek.
 */
export function entryFrame(machine, index) {
  return machine.frameBase + Math.floor(entryTime(machine, index) * TICKS_PER_SECOND) - machine.frameOrigin;
}

/** Seconds into the playing song at which it reaches sync entry `index`. */
export function entryTime(machine, index) {
  const entry = machine.syncTable[index];
  const timeline = machine.timelines[machine.song];
  const reached = timeline.find((status) => status.position > entry.position
    || (status.position === entry.position && status.row >= entry.row)) ?? timeline[timeline.length - 1];
  return reached.time;
}

/** [0x91264] = frame * 5 / 49. */
export function frameRow(machine) {
  return Math.floor((frame(machine) * FRAMES_PER_ROW_DENOMINATOR) / FRAMES_PER_ROW_NUMERATOR);
}

/** 0x11af3 setPalette: all 256 entries from 6-bit triplets. */
export function setDac(machine, triplets) {
  for (let i = 0; i < PALETTE_BYTES; i++) {
    machine.dac[i] = triplets[i] & DAC_BITS;
  }
}

export function setDacEntry(machine, index, r, g, b) {
  machine.dac[index * 3] = r & DAC_BITS;
  machine.dac[index * 3 + 1] = g & DAC_BITS;
  machine.dac[index * 3 + 2] = b & DAC_BITS;
}

/** 0x11a92 setMode(0x13): clears video memory, the BIOS default palette is never seen. */
export function setGraphicsMode(machine) {
  machine.isTextMode = false;
  machine.front.fill(0);
}
