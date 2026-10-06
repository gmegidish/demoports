// The "Amiga": 2 MB of chip RAM, the custom-chip registers the demo touches, and the beam.
// No DOM in here, so the whole demo also runs under node.
//
// The demo's code is ported by hand, part by part. Its data is not: every part reads and writes this
// memory at the addresses the original used, so pictures, tables and copper lists stay where the disk put them.

export const CHIP_BYTES = 0x200000;
/** PAL, non-interlaced: 312 lines of 227.5 colour clocks at 3,546,895 Hz. */
export const LINES_PER_FRAME = 312;
export const FRAME_MS = (LINES_PER_FRAME * 227.5 * 1000) / 3546895;
export const LINE_MS = FRAME_MS / LINES_PER_FRAME;

export function createMachine() {
  const mem = new Uint8Array(CHIP_BYTES);
  return {
    mem,
    view: new DataView(mem.buffer),
    /** COP1LC: where the copper starts every frame. */
    cop1lc: 0,
    cop2lc: 0,
    /** Blitter registers. They keep their values between blits, and the demo relies on that. */
    blt: {
      con0: 0, con1: 0, afwm: 0xffff, alwm: 0xffff,
      apt: 0, bpt: 0, cpt: 0, dpt: 0,
      amod: 0, bmod: 0, cmod: 0, dmod: 0,
      adat: 0, bdat: 0, cdat: 0,
    },
    /** Beam line (VPOS) the CPU last waited for. */
    beamLine: 0,
    /** Demo time in ms, maintained by the runner. */
    time: 0,
    /** Demo times at which the main tune starts and stops. Null until reached. */
    musicStartMs: null,
    musicStopMs: null,
    /** AUDxVOL of the main tune, 0..1. The loader fades it before the end part. */
    musicVolume: 1,
    /** The end part's own tune. */
    endMusicStartMs: null,
    endMusicStopMs: null,
  };
}

export const r8 = (m, a) => m.mem[a];
export const r16 = (m, a) => m.view.getUint16(a);
export const r16s = (m, a) => m.view.getInt16(a);
export const r32 = (m, a) => m.view.getUint32(a);
export const w8 = (m, a, v) => { m.mem[a] = v; };
export const w16 = (m, a, v) => m.view.setUint16(a, v);
export const w32 = (m, a, v) => m.view.setUint32(a, v);

/** 68000 `ext.w`: sign-extend a byte. */
export const s8 = (v) => (v << 24) >> 24;
/** Sign-extend a word. */
export const s16 = (v) => (v << 16) >> 16;

/**
 * `cmpi.b #line,$dff006` busy-wait pair: wait until the beam is on `line`, a full frame if it already is.
 * The CPU work between two waits is treated as instantaneous.
 */
export function* waitLine(m, line) {
  const lines = ((line - m.beamLine + LINES_PER_FRAME - 1) % LINES_PER_FRAME) + 1;
  m.beamLine = line;
  yield lines * LINE_MS;
}

export function* waitFrames(m, line, count) {
  for (let i = 0; i < count; i++) {
    yield* waitLine(m, line);
  }
}

/** Store a 32-bit pointer into a copper list's BPLxPTH/BPLxPTL pair. `at` is the address of the PTH value word. */
export function pokeCopperPointer(m, at, pointer) {
  w16(m, at, pointer >>> 16);
  w16(m, at + 4, pointer & 0xffff);
}
