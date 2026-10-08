// Tables the program builds at start-up (0x1b27d load_data and what it calls). Notes: docs/disassembly/C1_core.md §3.
import {
  TEXTURE_BUFFER_POINTER,
  BUFFER_A_POINTER,
  ROTOZOOM_BUFFER_POINTER,
  ROW_TABLE,
  AVI_ITEMS,
  FLI_ITEMS,
  SINE_DWORDS,
  GRAIN_NOISE_POINTER,
  LERP64_POINTER,
} from './addresses.js';
import { workBuffer } from './helpers.js';
import { LERP4 } from './morph.js';

/** 0x1b27d: the data files into memory, offset tables relocated, the work tables built. */
export function loadData(m, avi, fli) {
  const w = workBuffer(m);
  m.mem.fill(0, w, w + 64000);
  const aviBase = m.alloc(avi.length);
  m.mem.set(avi, aviBase);
  m.relocate(AVI_ITEMS, 30, aviBase);
  const fliBase = m.alloc(fli.length);
  m.mem.set(fli, fliBase);
  m.relocate(FLI_ITEMS, 20, fliBase);
  m.set32(LERP64_POINTER, m.alloc(0x40000));
  buildLerp64(m);
  m.set32(GRAIN_NOISE_POINTER, m.alloc(0x4e200));
  buildNoise(m);
  for (let y = 0; y < 200; y++) {
    m.set32(ROW_TABLE + 4 * y, w + 320 * y);
  }
  const tex = m.alloc(0x10000);
  m.set32(TEXTURE_BUFFER_POINTER, tex);
  m.set32(BUFFER_A_POINTER, m.alloc(0xfa00));
  m.set32(ROTOZOOM_BUFFER_POINTER, m.alloc(0xfa00));
  m.mem.fill(0, tex, tex + 0xbd00 * 4);
  buildLerp4(m);
}

/** AVI item i (0x1b170 + 4i), as a pointer. */
export function aviItem(m, i) {
  return m.u32(AVI_ITEMS + 4 * i);
}

/** FLI item i (0x1b0f8 + 4i), as a pointer. */
export function fliItem(m, i) {
  return m.u32(FLI_ITEMS + 4 * i);
}

/** An 8.8 accumulation from a to b in `steps` steps of int8(b-a)*256/steps, as 0x52a0a and 0x286ce do it. */
function lerpSteps(a, b, steps) {
  const step = (((b - a) << 24) >> 24) * (256 / steps);
  const out = [];
  let acc = a << 8;
  for (let i = 0; i < steps; i++) {
    acc = (acc + step) & 0xffff;
    out.push((acc >> 8) & 0xff);
  }
  return out;
}

/** 0x52a0a: L[a*4096 + b*64 + i] = a + floor((i+1)*(b-a)/64), 64x64x64 bytes at [0x529f4]. */
function buildLerp64(m) {
  const L = m.u32(LERP64_POINTER);
  for (let a = 0; a < 64; a++) {
    for (let b = 0; b < 64; b++) {
      m.mem.set(lerpSteps(a, b, 64), L + a * 4096 + b * 64);
    }
  }
}

/** 0x286ce: T4[a*256 + b*4 + k], 64x64x4 bytes at 0x1c602. */
function buildLerp4(m) {
  for (let a = 0; a < 64; a++) {
    for (let b = 0; b < 64; b++) {
      m.mem.set(lerpSteps(a, b, 4), LERP4 + a * 256 + b * 4);
    }
  }
}

/** The grain's random bytes, seeded: every run (and every replay after a seek) gets the same grain. */
const NOISE_SEED = 0x1996;

/** mulberry32, a small seeded generator; returns bytes. */
function seededBytes(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 0xff;
  };
}

/**
 * 0x538a8: five 320x200 frames of grain, values 0..31. The original reads the PIT counter as its random
 * source; the port uses a seeded generator with the same table lookups, running sum and per-row attenuation.
 */
function buildNoise(m, random = seededBytes(NOISE_SEED)) {
  const noise = m.u32(GRAIN_NOISE_POINTER);
  let sum = 0;
  for (let f = 0; f < 5; f++) {
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 320; x++) {
        const r = random();
        let al = (r + m.u8(SINE_DWORDS + 4 * r)) & 0xff;
        al = (al + m.u8(0x52a80 + al)) & 0xff;
        sum = (sum + al) & 0xff;
        const r2 = random();
        al = (r2 + m.u8(0x52a80 + r2)) & 0xff;
        al = (al + sum) & 0xff;
        al >>= 2;
        al = (al - m.u8(0x52b80 + y + 200 * f)) & 0xff;
        if (al & 0x80) {
          al = 0;
        }
        m.set8(noise + f * 64000 + y * 320 + x, al >> 1);
      }
    }
  }
}
