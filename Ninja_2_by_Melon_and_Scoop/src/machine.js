// The "PC": the globals of the shipped NINJA2.EXE, plus its timer interrupt.
// No DOM in here, so the whole demo also runs under node.
//
// Timing comes from the executable, not from original_src/NINJAC.C (an earlier revision).
// MIDAS calls an interrupt routine once per vertical retrace. That routine advances the current
// animation, three ramps and a scene clock. Scene loops only draw what those counters say.

/**
 * Ticks per second: the refresh rate of the tweaked 320x256 mode.
 * Measured on the reference capture of the original (youtube W_krY1akm3s) against its own soundtrack.
 * The VGA registers say 25.175 MHz / (800 dots x 546 lines) = 57.64 Hz; the capture runs 1% under that.
 */
export const TICK_HZ = 57.1;
export const TICK_MS = 1000 / TICK_HZ;

export const XSIZE = 320;
export const YSIZE = 256;
export const SCREEN_BYTES = XSIZE * YSIZE;

const LAYER_BYTES = 400000;

/** C `float`: every store rounds to 32 bits, exactly like the original. */
export const f32 = Math.fround;
/** C `(int)` cast of a float. */
export const int = Math.trunc;

export function createMachine(pGraphics) {
  return {
    width: XSIZE,
    height: YSIZE,
    /** Work buffer the scenes draw into. */
    screen: new Uint8Array(SCREEN_BYTES),
    /** What the monitor shows: the last buffer ShowScreen() copied to the VGA. */
    front: new Uint8Array(SCREEN_BYTES),
    /** VGA DAC, 256 x RGB, 6 bits per component. */
    palette: new Uint8Array(256 * 3),
    pGraphics,
    pLayer1: new Uint8Array(LAYER_BYTES),
    pLayer2: new Uint8Array(LAYER_BYTES),
    pLayer3: new Uint8Array(LAYER_BYTES),
    pVspace: new Uint8Array(LAYER_BYTES),

    // Interrupt state. Names follow what the routine does; the executable has no symbols.
    gTick: 0,
    lastTick: 0,
    /** Current animation: frame index, done flag, and its setup. */
    aFrame: 0,
    aDone: 0,
    aCount: 0,
    aSub: 0,
    aTicksPer: 0,
    aTotal: 0,
    aWrap: 0,
    /** Three ramps that climb by `inc` per tick until they reach `lim`. */
    ramps: [0, 1, 2].map(() => ({ on: 0, inc: 0, val: 0, lim: 0 })),
    /** Scene clock: climbs by clockInc per tick, forever. */
    clock: 0,
    clockInc: 0,

    /** Demo time in ms, maintained by the runner. */
    time: 0,
    /** Demo time at which the music starts. Null until reached. */
    musicStartMs: null,
    /** Demo time at which the credits begin. Null until reached. */
    creditsStartMs: null,
  };
}

/** The interrupt routine at file offset 0xE000. */
function timerInterrupt(m) {
  m.gTick++;
  if (!m.aDone) {
    m.aSub++;
    if (m.aSub >= m.aTicksPer) {
      m.aSub = 0;
      m.aFrame++;
      m.aCount++;
      if (m.aCount >= m.aTotal) {
        m.aDone = 1;
        m.aFrame = m.aTotal - 1;
      } else if (m.aFrame >= m.aWrap) {
        m.aFrame = 0;
      }
    }
  }
  for (const ramp of m.ramps) {
    if (ramp.on) {
      ramp.val = f32(ramp.val + ramp.inc);
      if (!(ramp.val < ramp.lim)) {
        ramp.on = 0;
      }
    }
  }
  m.clock = f32(m.clock + m.clockInc);
}

/** Start an animation: `wrap` frames in the loop, `ticksPer` ticks each, done after `total` frame changes. */
export function startAnim(m, wrap, ticksPer, total) {
  m.aWrap = wrap;
  m.aTicksPer = ticksPer;
  m.aTotal = total;
  m.aFrame = 0;
  m.aCount = 0;
  m.aSub = 0;
  m.aDone = 0;
}

export function stopAnim(m) {
  m.aFrame = 0;
  m.aCount = 0;
  m.aDone = 1;
}

/** Start ramp `index` from 0: +1/period per tick, stops at `lim`. */
export function startRamp(m, index, period, lim) {
  const ramp = m.ramps[index];
  ramp.inc = f32(1 / f32(period));
  ramp.val = 0;
  ramp.on = 1;
  ramp.lim = lim;
}

/** Restart the scene clock: +1/period per tick. */
export function startClock(m, period) {
  m.clock = 0;
  m.clockInc = f32(1 / f32(period));
}

/** Ticks since the previous call. */
export function ticksElapsed(m) {
  const elapsed = m.gTick - m.lastTick;
  m.lastTick = m.gTick;
  return elapsed;
}

/** VerticalBlank(): wait for the next retrace. The timer interrupt fires there. */
export function* retrace(m) {
  yield TICK_MS;
  timerInterrupt(m);
}

/** ShowScreen(1): show the work buffer, then wait for the retrace. */
export function* show(m) {
  m.front.set(m.screen);
  yield* retrace(m);
}

export function* retraces(m, count) {
  for (let i = 0; i < count; i++) {
    yield* retrace(m);
  }
}

/** Busy-wait `ticks` ticks the way the executable does: a one-tick-per-frame animation of that length. */
export function* waitTicks(m, ticks) {
  startAnim(m, ticks, 1, ticks);
  while (!m.aDone) {
    yield* retrace(m);
  }
}

export function ResetPalette(m) {
  m.palette.fill(0);
}

export function SetCol(m, index, r, g, b) {
  m.palette[index * 3] = r;
  m.palette[index * 3 + 1] = g;
  m.palette[index * 3 + 2] = b;
}

/** Wipe the work buffer and show it. */
export function* ClearScreen(m) {
  m.screen.fill(0);
  yield* show(m);
}

/** How almost every scene begins: VerticalBlank, ResetPalette, ClearScreen. */
export function* cutToBlack(m) {
  yield* retrace(m);
  ResetPalette(m);
  yield* ClearScreen(m);
}
