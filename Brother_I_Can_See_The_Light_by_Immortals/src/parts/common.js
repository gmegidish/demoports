// What several parts do the same way: palette fades and the busy-wait on the music.

import { setDacEntry, playStatus } from '../machine.js';

const COLOURS = 256;
/** dac_whiten aims at 64, not 63: at t = 1 every channel is 64, which the 6-bit DAC keeps as 0 (black). */
const WHITEN_TARGET = 64;

/** 0x10fb8: DAC = trunc(p + (64 - p) * t), t = 0 is the palette, t near 1 is white. */
export function whitenDac(machine, palette, t) {
  const weight = Math.fround(t);
  for (let i = 0; i < COLOURS; i++) {
    const channel = (k) => Math.trunc((WHITEN_TARGET - palette[i * 3 + k]) * weight + palette[i * 3 + k]);
    setDacEntry(machine, i, channel(0), channel(1), channel(2));
  }
}

/** 0x11079 and its inline copies: DAC = trunc(p * t). */
export function scaleDac(machine, palette, t) {
  const weight = Math.fround(t);
  for (let i = 0; i < COLOURS; i++) {
    const channel = (k) => Math.trunc(palette[i * 3 + k] * weight);
    setDacEntry(machine, i, channel(0), channel(1), channel(2));
  }
}

/** Grey ramp: entry i is (i >> 2) on all three channels. */
export function greyRamp() {
  const palette = new Uint8Array(COLOURS * 3);
  for (let i = 0; i < COLOURS; i++) {
    palette.fill(i >> 2, i * 3, i * 3 + 3);
  }
  return palette;
}

/** Spin on the play status, as the original does, until the condition holds. */
export function* waitFor(machine, isDone) {
  while (!isDone(playStatus(machine))) {
    yield;
  }
}
