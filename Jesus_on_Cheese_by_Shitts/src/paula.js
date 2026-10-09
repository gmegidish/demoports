// Paula's four audio channels, and a mixer that turns their register writes into samples.
//
// The CPU side: paulaWrite (called by display.js `custom()` for $dff0a0-$dff0df and DMACON $dff096) puts a
// time-stamped write in a queue. The time is the demo time of the frame (m.time) plus a cursor inside the
// frame: the replayer sets the cursor to the raster line it runs at and moves it on over its DMA wait loops,
// so a channel's DMA goes off, back on ~0.4 ms later, and gets its loop pointers ~0.4 ms after that, as on the
// real machine. Writes are only queued when the machine runs for audio (m.isAudioOnly), so the picture-only
// runner does not pile them up.
//
// The audio side: a mixer consumes the queue in time order and runs the channels the way the hardware does:
//  - AUDxLC/AUDxLEN/AUDxPER/AUDxVOL are latches. When a channel's DMA is switched on (DMACON bit n, with the
//    master bit 9) it starts from the latched pointer and length; at the end of the sample it reloads them from
//    the latches, which by then hold the loop (that is how ProTracker loops and stops samples).
//  - each 8-bit signed sample byte lasts AUDxPER colour clocks (3,546,895 Hz PAL); volume 0-64 (bit 6 = 64).
//  - Amiga stereo: channels 0 and 3 left, 1 and 2 right, hard panned.
//  - the A500's output filters: the fixed one-pole RC low-pass (360 ohm, 0.1 uF: 4.42 kHz), the "LED" two-pole
//    Sallen-Key low-pass (~3.09 kHz, only while the power LED is bright) and the AC coupling high-pass (5.2 Hz).
//    Every replayer here switches the LED filter off in mt_init. See docs/disassembly/replayer.md for why the
//    fixed filter is on.
// No DOM: this file runs in the AudioWorklet too.

import { PAL_CLOCK, CHIP_MASK } from './machine.js';

/** @typedef {{ time: number, reg: number, value: number }} PaulaWrite  reg: $a0-$df, $96, or LED_FILTER */
/** @typedef {{ isA500Filter?: boolean }} MixerOptions */

/** Pseudo register for the CIA-A /LED bit ($bfe001 bit 1): value 1 = filter on. */
export const LED_FILTER = 0x1000;
const DMACON = 0x96;
const AUDIO_REGS = 0xa0;
const AUDIO_REGS_END = 0xe0;
const DMA_MASTER = 0x200;
const SET_CLEAR = 0x8000;
const CHANNELS = 4;
const MAX_VOLUME = 64;
const FULL_LENGTH = 0x10000;
const FULL_PERIOD = 0x10000;
/** Compact the consumed part of the queue once this many writes are behind the mixer. */
const COMPACT_AFTER = 4096;
/** 360 ohm and 0.1 uF after the DAC. */
const A500_LOWPASS_HZ = 1 / (2 * Math.PI * 360 * 0.1e-6);
/** The LED filter: Sallen-Key, 10 kohm, 6800 pF and 3900 pF. */
const LED_R = 10000;
const LED_C1 = 6800e-12;
const LED_C2 = 3900e-12;
const LED_LOWPASS_HZ = 1 / (2 * Math.PI * LED_R * Math.sqrt(LED_C1 * LED_C2));
const LED_Q = Math.sqrt(LED_C1 * LED_C2) / (2 * LED_C2);
/** The output coupling: 1390 ohm and 22 uF. */
const HIGHPASS_HZ = 1 / (2 * Math.PI * 1390 * 22e-6);
/** Left: channels 0 and 3. Right: 1 and 2. Two channels at full volume and full swing make 1.0. */
const SIDE_SCALE = 1 / (2 * 128 * MAX_VOLUME);

function paulaOf(m) {
  if (!m.paula) {
    m.paula = { events: [], frameTime: -1, cursor: 0 };
  }
  return m.paula;
}

/** Where in the frame the CPU is, in ms after the frame started. A new frame starts at 0. */
function eventTime(p, m) {
  if (p.frameTime !== m.time) {
    p.frameTime = m.time;
    p.cursor = 0;
  }
  return m.time + p.cursor;
}

function queue(m, reg, value) {
  if (!m.isAudioOnly) {
    return;
  }
  const p = paulaOf(m);
  p.events.push({ time: eventTime(p, m), reg, value });
}

/** A word write to $dff000 + reg: an audio register ($a0-$df) or DMACON ($96). */
export function paulaWrite(m, reg, value) {
  queue(m, reg, value & 0xffff);
}

/** The CPU is at `ms` into the current frame (the raster line a routine runs at). */
export function setPaulaCursor(m, ms) {
  const p = paulaOf(m);
  p.frameTime = m.time;
  p.cursor = ms;
}

/** The CPU spends `ms` in a delay loop. */
export function delayPaula(m, ms) {
  const p = paulaOf(m);
  eventTime(p, m);
  p.cursor += ms;
}

/** `$bfe001` bit 1: 0 lights the power LED and switches the LED filter in. */
export function setLedFilter(m, isOn) {
  queue(m, LED_FILTER, isOn ? 1 : 0);
}

function createChannel() {
  return {
    lc: 0, len: 0, per: 0, vol: 0,
    isOn: false, pointer: 0, wordsLeft: 0, isSecondByte: false, phase: 0, bytePeriod: FULL_PERIOD, out: 0,
  };
}

const signed = (byte) => (byte << 24) >> 24;

function startChannel(ch, mem) {
  ch.isOn = true;
  ch.pointer = ch.lc;
  ch.wordsLeft = ch.len || FULL_LENGTH;
  ch.isSecondByte = false;
  ch.phase = 0;
  ch.bytePeriod = ch.per || FULL_PERIOD;
  ch.out = signed(mem[ch.pointer & CHIP_MASK]);
}

/** The next sample byte; after the last word of the block, reload pointer and length from the latches. */
function nextByte(ch, mem) {
  if (!ch.isSecondByte) {
    ch.isSecondByte = true;
    ch.out = signed(mem[(ch.pointer + 1) & CHIP_MASK]);
  } else {
    ch.isSecondByte = false;
    ch.pointer += 2;
    ch.wordsLeft--;
    if (ch.wordsLeft <= 0) {
      ch.pointer = ch.lc;
      ch.wordsLeft = ch.len || FULL_LENGTH;
    }
    ch.out = signed(mem[ch.pointer & CHIP_MASK]);
  }
  ch.bytePeriod = ch.per || FULL_PERIOD;
}

/** Run a channel for `ticks` colour clocks; returns the sum of its output over that time (before volume). */
function runChannel(ch, ticks, mem) {
  if (!ch.isOn) {
    return 0;
  }
  let sum = 0;
  let left = ticks;
  while (left > 0) {
    const rest = ch.bytePeriod - ch.phase;
    if (rest > left) {
      sum += ch.out * left;
      ch.phase += left;
      break;
    }
    sum += ch.out * rest;
    left -= rest;
    ch.phase = 0;
    nextByte(ch, mem);
  }
  return sum;
}

const volumeOf = (ch) => (ch.vol & 0x40 ? MAX_VOLUME : ch.vol & 0x3f);

function onePoleLowpass(cutoff, sampleRate) {
  return { a: 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate), y: 0 };
}

/** RBJ biquad low-pass (bilinear transform), for the LED filter. */
function biquadLowpass(cutoff, q, sampleRate) {
  const w = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0, a2: (1 - alpha) / a0,
    x1: 0, x2: 0, y1: 0, y2: 0,
  };
}

function runBiquad(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

function createSide(sampleRate) {
  return {
    lowpass: onePoleLowpass(A500_LOWPASS_HZ, sampleRate),
    led: biquadLowpass(LED_LOWPASS_HZ, LED_Q, sampleRate),
    highpass: onePoleLowpass(HIGHPASS_HZ, sampleRate),
  };
}

function filterSide(side, x, isA500Filter, isLedOn) {
  let y = x;
  if (isA500Filter) {
    side.lowpass.y += side.lowpass.a * (y - side.lowpass.y);
    y = side.lowpass.y;
  }
  if (isLedOn) {
    y = runBiquad(side.led, y);
  }
  side.highpass.y += side.highpass.a * (y - side.highpass.y);
  return y - side.highpass.y;
}

/**
 * A mixer for machine `m`, starting at demo time 0. It reads sample bytes from m.mem when it plays them.
 * @param {object} m
 * @param {number} sampleRate
 * @param {MixerOptions} [options]
 */
export function createMixer(m, sampleRate, { isA500Filter = true } = {}) {
  const p = paulaOf(m);
  const channels = Array.from({ length: CHANNELS }, createChannel);
  const ticksPerSample = PAL_CLOCK / sampleRate;
  const left = createSide(sampleRate);
  const right = createSide(sampleRate);
  let dmacon = 0;
  let isLedOn = false;
  let tick = 0;
  let next = 0;

  function apply(event) {
    const { reg, value } = event;
    if (reg === LED_FILTER) {
      isLedOn = value !== 0;
      return;
    }
    if (reg === DMACON) {
      const before = dmacon;
      dmacon = value & SET_CLEAR ? dmacon | (value & 0x7fff) : dmacon & ~value;
      for (let n = 0; n < CHANNELS; n++) {
        const wasOn = (before & DMA_MASTER) !== 0 && (before & (1 << n)) !== 0;
        const isOn = (dmacon & DMA_MASTER) !== 0 && (dmacon & (1 << n)) !== 0;
        if (isOn && !wasOn) {
          startChannel(channels[n], m.mem);
        } else if (wasOn && !isOn) {
          channels[n].isOn = false;
          channels[n].out = 0;
        }
      }
      return;
    }
    if (reg < AUDIO_REGS || reg >= AUDIO_REGS_END) {
      return;
    }
    const ch = channels[(reg - AUDIO_REGS) >> 4];
    switch (reg & 0xf) {
      case 0x0: ch.lc = ((value & 7) << 16) | (ch.lc & 0xffff); break;
      case 0x2: ch.lc = (ch.lc & 0x70000) | (value & 0xfffe); break;
      case 0x4: ch.len = value; break;
      case 0x6: ch.per = value; break;
      case 0x8: ch.vol = value; break;
      default: break;
    }
  }

  /** Apply every queued write that is due by colour clock `until`. */
  function applyDue(until) {
    const events = p.events;
    while (next < events.length && (events[next].time * PAL_CLOCK) / 1000 <= until) {
      apply(events[next]);
      next++;
    }
    if (next >= COMPACT_AFTER) {
      events.splice(0, next);
      next = 0;
    }
  }

  return {
    /** Demo time of the next sample, ms. */
    get ms() {
      return (tick * 1000) / PAL_CLOCK;
    },
    /** Mix `count` samples into left/right (Float32Arrays) from index `start`. */
    render(leftOut, rightOut, start, count) {
      const mem = m.mem;
      for (let i = start; i < start + count; i++) {
        applyDue(tick);
        let l = 0;
        let r = 0;
        for (let n = 0; n < CHANNELS; n++) {
          const ch = channels[n];
          const level = (runChannel(ch, ticksPerSample, mem) / ticksPerSample) * volumeOf(ch);
          if (n === 0 || n === 3) {
            l += level;
          } else {
            r += level;
          }
        }
        leftOut[i] = filterSide(left, l * SIDE_SCALE, isA500Filter, isLedOn);
        rightOut[i] = filterSide(right, r * SIDE_SCALE, isA500Filter, isLedOn);
        tick += ticksPerSample;
      }
    },
    /** Jump to demo time `ms` without output: the writes are applied and the channels run on, silently. */
    skipTo(ms) {
      const target = (ms * PAL_CLOCK) / 1000;
      const mem = m.mem;
      while (tick < target) {
        const event = p.events[next];
        const eventTick = event ? (event.time * PAL_CLOCK) / 1000 : Infinity;
        const step = Math.min(target, Math.max(eventTick, tick)) - tick;
        for (const ch of channels) {
          runChannel(ch, step, mem);
        }
        tick += step;
        applyDue(tick);
      }
    },
  };
}
