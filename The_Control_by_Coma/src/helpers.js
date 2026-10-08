// Small per-pixel and palette routines shared by the effects. Notes: docs/disassembly/C1_core.md §9.
// Self-modified immediates (0x53822, 0x53840 ...) are read from memory, where the code keeps them.

import {
  WORK_BUFFER_POINTER,
  BACK_BUFFER_POINTER,
  TEXTURE_BUFFER_POINTER,
  BUFFER_A_POINTER,
  ROTOZOOM_BUFFER_POINTER,
  AVI_ITEMS,
  SINE_BYTES,
  COSINE_BYTES,
  TEXTURE_POINTER,
  GRAIN_LEVEL,
  GRAIN_COUNT,
  GRAIN_ADD,
  GRAIN_NOISE_POINTER,
  GRAIN_PHASE,
  TEXTURE_SCROLL_U,
  TEXTURE_SCROLL_V,
  LERP64_POINTER,
  LERP_T,
  UPSCALE_2X_ADD,
} from './addresses.js';

const PIXELS = 64000;
const BLIT_BYTES = 63680;
/** The rays image is AVI item 5. */
const RAYS_ITEM = 5;

/** W, the 320x200 work buffer [0x5606e]: most effects draw here, then blit it. */
export function workBuffer(m) {
  return m.u32(WORK_BUFFER_POINTER);
}

/** B2, the second 320x200 buffer [0x56072]: the starburst feedback, the text of the mode-X scenes. */
export function backBuffer(m) {
  return m.u32(BACK_BUFFER_POINTER);
}

/** A one-shot "first call" flag byte: true (and set to `value`) the first time. */
export function isFirstCall(m, flag, value = 1) {
  if (m.u8(flag) !== 0) {
    return false;
  }
  m.set8(flag, value);
  return true;
}

/** 0x5238e: DAC 0xc0..0xff = table 0x52189 minus the fade level [0x522f5], floored at 0. */
export function setPaletteFade(m) {
  const level = m.u8(0x522f5);
  for (let k = 0; k < 192; k++) {
    const v = (m.u8(0x52189 + k) - level) & 0xff;
    m.dac[0xc0 * 3 + k] = v & 0x80 ? 0 : v & 63;
  }
}

/** 0x53929: DAC 0..191 from the palette of the current RIX texture ([0x2d708] - 0x300). */
export function setPaletteFromTexture(m) {
  m.dacLoad(0, m.u32(TEXTURE_POINTER) - 0x300, 0x240);
}

/** 0x53ed8 (part-2 timer): colours 0xc0..0xff swing between the sepia ramp 0x53e08 and one of three tints. */
export function palettePulse(m) {
  if (m.addByte(0x53ed0, 2)) {
    let tint = m.u32(0x53ed4) + 0xc0;
    if (tint >= 0x240) {
      tint = 0;
    }
    m.set32(0x53ed4, tint);
  }
  const t = m.u8(SINE_BYTES + m.u8(0x53ed0)) >> 1;
  const L = m.u32(LERP64_POINTER);
  const tint = 0x53bc8 + m.u32(0x53ed4);
  for (let k = 0; k < 192; k++) {
    m.dac[0xc0 * 3 + k] = m.u8(L + m.u8(0x53e08 + k) * 4096 + m.u8(tint + k) * 64 + t) & 63;
  }
}

/** 0x522b5: the 256x256 texture scrolled through the starburst, values 0..31. */
export function buildStarburstTexture(m) {
  const tex = m.u32(TEXTURE_BUFFER_POINTER);
  for (let idx = 0; idx < 65536; idx++) {
    const x = idx & 0xff;
    const y = idx >> 8;
    let v = m.u8(SINE_BYTES + (((2 * x) & 0xff) ^ y)) + m.u8(COSINE_BYTES + (((2 * y) & 0xff) ^ x));
    v = ((v >> 1) - 0x60) & 0xff;
    m.set8(tex + idx, v & 0x80 ? 0 : v);
  }
}

/** 0x5224c: the starburst painter, added with saturation into `dest`; the ray image is read backwards. */
export function feedbackAdd(m, dest) {
  m.set8(0x52249, m.u8(SINE_BYTES + m.u8(0x56077)) >> 1);
  const tex = m.u32(TEXTURE_BUFFER_POINTER);
  const rays = m.u32(AVI_ITEMS + 4 * RAYS_ITEM);
  const u = m.u8(TEXTURE_SCROLL_U);
  const v = m.u8(TEXTURE_SCROLL_V);
  const bias = m.u8(0x52249);
  const mem = m.mem;
  for (let i = 0; i < PIXELS; i++) {
    const j = PIXELS - 1 - i;
    const p = mem[rays + j];
    const a = mem[tex + ((p + v) & 0xff) * 256 + ((p + u) & 0xff)];
    const b = (mem[rays + 0x1f400 + j] - mem[rays + 0xfa00 + j] + bias) & 0xff;
    let value = (a - b) & 0xff;
    if (value & 0x80) {
      value = 0;
    }
    mem[dest + i] = Math.min(255, mem[dest + i] + value);
  }
}

/** 0x1c2a7 / 0x1c2c2 / 0x1c2f8: buf[i] = DECAY[buf[i]] (table 0x1c1a7). */
export function decay(m, buffer, count = PIXELS) {
  const mem = m.mem;
  for (let i = 0; i < count; i++) {
    mem[buffer + i] = mem[0x1c1a7 + mem[buffer + i]];
  }
}

/**
 * 0x523b2 (W -> B2) and 0x523d2 (B2 -> W): intensity to the 0xc0 ramp, (v >> 2) + 0xc0. `into` is the memory
 * written (m.screen for a pass straight to A000), `count` the bytes.
 */
export function toRamp(m, from, to, count = PIXELS, into = m.mem) {
  const mem = m.mem;
  for (let i = 0; i < count; i++) {
    into[to + i] = (mem[from + i] >> 2) + 0xc0;
  }
}

/** 0x1c314: the 160x100 buffer [0x1b262] doubled into `dest`, plus the byte at 0x1c313. */
export function upscale2x(m, dest) {
  const src = m.u32(ROTOZOOM_BUFFER_POINTER);
  const add = m.u8(UPSCALE_2X_ADD);
  const mem = m.mem;
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 160; x++) {
      const v = (mem[src + y * 160 + x] + add) & 0xff;
      const d = dest + 2 * y * 320 + 2 * x;
      mem[d] = v;
      mem[d + 1] = v;
      mem[d + 320] = v;
      mem[d + 321] = v;
    }
  }
}

/** 0x52982: W[i] = LERP64[src[i]][W[i]][t] + 0xc0, src = [0x1b25e], t = [0x529f8]. */
export function lerpIntoW(m) {
  const L = m.u32(LERP64_POINTER);
  const src = m.u32(BUFFER_A_POINTER);
  const t = m.u32(LERP_T);
  const w = workBuffer(m);
  const mem = m.mem;
  for (let i = 0; i < PIXELS; i++) {
    mem[w + i] = (mem[L + mem[src + i] * 4096 + mem[w + i] * 64 + t] + 0xc0) & 0xff;
  }
}

/** 0x53815: grain over a 0..63 image; the byte count (imm 0x53822) and the added base (imm 0x53840) are patched by code. */
export function grain(m, dest) {
  const src = m.u32(GRAIN_NOISE_POINTER) + m.u32(GRAIN_PHASE);
  const level = m.u8(GRAIN_LEVEL);
  const count = m.u32(GRAIN_COUNT);
  const base = m.u8(GRAIN_ADD);
  const mem = m.mem;
  for (let i = 0; i < count; i++) {
    let v = (mem[src + i] - level) & 0xff;
    if (v & 0x80) {
      v = 0;
    }
    let d = (mem[dest + i] + v) & 0xff;
    if (d >= 0x3f) {
      d = 0x3f;
    }
    mem[dest + i] = (d + base) & 0xff;
  }
}

/** 0x53847: grain added with saturation at 255. */
export function grainSaturate(m, dest) {
  const src = m.u32(GRAIN_NOISE_POINTER) + m.u32(GRAIN_PHASE);
  const level = m.u8(GRAIN_LEVEL);
  const mem = m.mem;
  for (let i = 0; i < PIXELS; i++) {
    let v = (mem[src + i] - level) & 0xff;
    if (v & 0x80) {
      v = 0;
    }
    mem[dest + i] = Math.min(255, mem[dest + i] + v);
  }
}

/** 0x528dd: W = 0xc0. */
export function fillWithRampBase(m) {
  m.mem.fill(0xc0, workBuffer(m), workBuffer(m) + PIXELS);
}

/** 0x528f6: W = 0. */
export function clearW(m) {
  m.mem.fill(0, workBuffer(m), workBuffer(m) + PIXELS);
}

/** 0x52918 (W) and 0x5293b (B2): rows 0..198 to A000; row 199 keeps the 0xc0 main wrote once. */
export function blit(m, from) {
  m.screen.set(m.mem.subarray(from, from + BLIT_BYTES), 0);
}
