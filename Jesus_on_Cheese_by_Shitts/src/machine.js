// The "Amiga 500": 512 KB of chip RAM, the custom-chip registers the demo touches, and the frame clock.
// No DOM in here, so the whole demo also runs under node.
//
// The demo's code is ported by hand, part by part. Its data is not: every part reads and writes this
// memory at the addresses the original used, so pictures, tables and copper lists stay where the disk put them.

export const CHIP_BYTES = 0x80000;
export const CHIP_MASK = CHIP_BYTES - 1;
/** PAL, non-interlaced: 312 lines of 227 colour clocks at 3,546,895 Hz (long and short lines alternate). */
export const PAL_CLOCK = 3546895;
export const LINES_PER_FRAME = 312;
export const FRAME_MS = (LINES_PER_FRAME * 227.5 * 1000) / PAL_CLOCK;
export const LINE_MS = FRAME_MS / LINES_PER_FRAME;

export function createMachine() {
  const mem = new Uint8Array(CHIP_BYTES);
  return {
    mem,
    view: new DataView(mem.buffer),
    /** COP1LC: where the copper starts every frame. */
    cop1lc: 0,
    cop2lc: 0,
    /** Blitter registers. They keep their values between blits. */
    blt: {
      con0: 0, con1: 0, afwm: 0xffff, alwm: 0xffff,
      apt: 0, bpt: 0, cpt: 0, dpt: 0,
      amod: 0, bmod: 0, cmod: 0, dmod: 0,
      adat: 0, bdat: 0, cdat: 0,
    },
    /** Frames since power-on; the vertical blank counts them. */
    frame: 0,
    /** Demo time in ms, maintained by the runner. */
    time: 0,
    /** Set when only the music is wanted: parts then skip their drawing. */
    isAudioOnly: false,
  };
}

export const r8 = (m, a) => m.mem[a & CHIP_MASK];
export const r16 = (m, a) => m.view.getUint16(a & CHIP_MASK);
export const r16s = (m, a) => m.view.getInt16(a & CHIP_MASK);
export const r32 = (m, a) => m.view.getUint32(a & CHIP_MASK);
export const w8 = (m, a, v) => { m.mem[a & CHIP_MASK] = v; };
export const w16 = (m, a, v) => m.view.setUint16(a & CHIP_MASK, v);
export const w32 = (m, a, v) => m.view.setUint32(a & CHIP_MASK, v);

/** 68000 `ext.w`: sign-extend a byte. */
export const s8 = (v) => (v << 24) >> 24;
/** Sign-extend a word. */
export const s16 = (v) => (v << 16) >> 16;

/** One vertical blank. Everything this demo does happens in its vertical-blank interrupt, once a frame. */
export function* nextFrame(m) {
  m.frame++;
  yield FRAME_MS;
}

export function* waitFrames(m, count) {
  for (let i = 0; i < count; i++) {
    yield* nextFrame(m);
  }
}

/** Store a 32-bit pointer into a copper list's xxxPTH/xxxPTL pair. `at` is the address of the PTH value word. */
export function pokeCopperPointer(m, at, pointer) {
  w16(m, at, pointer >>> 16);
  w16(m, at + 4, pointer & 0xffff);
}

/** How long a click holds the button down, in frames: a tenth of a second. */
const CLICK_FRAMES = 5;

/**
 * `btst #6,$bfe001`: CIA-A port A, bit 6 low while the left mouse button is down. `m.clicks` holds the frames at
 * which the viewer pressed it.
 */
export function isLeftButtonDown(m) {
  return m.clicks.some((frame) => m.frame >= frame && m.frame < frame + CLICK_FRAMES);
}
